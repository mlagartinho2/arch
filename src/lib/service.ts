import { GitLab, type GlProject, type GlUser } from './gitlab';
import { updateNote, type Draft, type UpdateDraft } from './parser';
import type { Settings } from './settings';
import {
  LABELS,
  LABEL_DEFS,
  STD_LABEL,
  addAdoptionCrew,
  setAdoption,
  setDocumentSection,
  setMarker,
  standardDescription,
  toItem,
  type Item,
  type StdStatus,
} from './model';
import { addDays, todayIso } from './dates';

export interface MeetingInput {
  title: string;
  date: string;
  attendees: string;
  notes: string;
}

export class Service {
  me!: GlUser;
  project!: GlProject;
  missingLabels: string[] = [];

  constructor(public gl: GitLab, public settings: Settings) {}

  async init() {
    const [me, project] = await Promise.all([this.gl.currentUser(), this.gl.project(this.settings.followupsProject)]);
    this.me = me;
    this.project = project;
    const existing = new Set((await this.gl.labels(project.id)).map((l) => l.name));
    this.missingLabels = LABEL_DEFS.filter((l) => !existing.has(l.name)).map((l) => l.name);
  }

  async ensureLabels() {
    for (const def of LABEL_DEFS) {
      if (this.missingLabels.includes(def.name)) {
        await this.gl.createLabel(this.project.id, def.name, def.color, def.description);
      }
    }
    this.missingLabels = [];
  }

  async loadItems(): Promise<Item[]> {
    const pid = this.project.id;
    const since = addDays(todayIso(), -90);
    const batches = await Promise.all([
      this.gl.issues(pid, { state: 'opened' }),
      this.gl.issues(pid, { state: 'closed', updated_after: `${since}T00:00:00Z` }),
      this.gl.issues(pid, { state: 'all', labels: LABELS.decision }),
      this.gl.issues(pid, { state: 'all', labels: LABELS.meeting }),
    ]);
    const map = new Map<number, Item>();
    for (const issue of batches.flat()) {
      const it = toItem(issue);
      if (it) map.set(it.iid, it);
    }
    return [...map.values()];
  }

  private async assigneeIds(username?: string): Promise<number[]> {
    if (!username) return [this.me.id];
    const u = await this.gl.userByUsername(username);
    if (!u) throw new Error(`GitLab user @${username} not found`);
    return [u.id];
  }

  async createItem(d: Draft, meetingIid?: number): Promise<Item> {
    const pid = this.project.id;
    const from = meetingIid ? `From meeting #${meetingIid}\n\n` : '';
    let description: string;
    let labels: string;
    let assignee_ids: number[] | undefined;
    let due_date: string | null = d.due ?? null;

    if (d.type === 'standard') {
      labels = [LABELS.standard, LABELS.stdDraft].join(',');
      description = standardDescription({ summary: d.details, crews: this.settings.crews, meetingIid });
      assignee_ids = await this.assigneeIds(d.assignee);
    } else if (d.type === 'decision') {
      labels = LABELS.decision;
      description = `${from}${d.details || ''}`.trim();
      due_date = null;
    } else {
      labels = LABELS.action;
      description = `${from}${d.details || ''}`.trim();
      assignee_ids = await this.assigneeIds(d.assignee);
    }
    if (meetingIid && d.type !== 'standard') description = setMarker(description, 'meeting', String(meetingIid));

    let issue = await this.gl.createIssue(pid, { title: d.title, description, labels, assignee_ids, due_date });
    if (d.type === 'decision') issue = await this.gl.updateIssue(pid, issue.iid, { state_event: 'close' });
    if (meetingIid) {
      await this.gl.linkIssues(pid, meetingIid, pid, issue.iid).catch(() => undefined);
    }
    return toItem(issue)!;
  }

  /**
   * Apply one update to an existing item: DONE / DROP / PUSH / UPDATE / ADOPTED.
   * Posts a comment that links back to the meeting (if any), so the history stays traceable in GitLab.
   */
  async applyUpdate(u: UpdateDraft, meetingIid?: number): Promise<{ item: Item; summary: string }> {
    const pid = this.project.id;
    let item = toItem(await this.gl.issue(pid, u.iid));
    if (!item) throw new Error(`#${u.iid} is not an Arch item`);
    if (item.kind === 'meeting') throw new Error(`#${u.iid} is a meeting`);
    const where = meetingIid ? ` in #${meetingIid}` : '';
    const note = updateNote(u.text, item.title);
    const withNote = (s: string) => (note ? `${s}: ${note}` : s);
    const body: Record<string, unknown> = {};
    if (u.assignee) body.assignee_ids = await this.assigneeIds(u.assignee === this.me.username ? undefined : u.assignee);
    let comment: string | undefined;
    let summary: string;

    switch (u.op) {
      case 'done':
        if (item.kind === 'standard') throw new Error(`#${u.iid} is a standard: use ADOPTED #${u.iid} <crew>`);
        body.state_event = 'close';
        comment = withNote(`✅ Done${where}`);
        summary = 'done';
        break;
      case 'drop':
        body.state_event = 'close';
        comment = withNote(`🚫 Dropped${where}`);
        summary = 'dropped';
        break;
      case 'push':
        body.due_date = u.due;
        comment = withNote(`⏭️ Follow-up moved to ${u.due}${where}`);
        summary = `follow-up → ${u.due}`;
        break;
      case 'note':
        if (!note && !u.due && !u.assignee) throw new Error(`UPDATE #${u.iid} has no text`);
        if (u.due) body.due_date = u.due;
        comment = note ? `📝 Update${where}: ${note}` : undefined;
        summary = u.due ? `updated, follow-up → ${u.due}` : 'updated';
        break;
      case 'adopted': {
        if (item.kind !== 'standard') throw new Error(`#${u.iid} is not a standard`);
        const names = note.split(/,|;|\s+and\s+|\s+&\s+/i).map((c) => c.trim()).filter(Boolean);
        if (!names.length) throw new Error(`ADOPTED #${u.iid} needs crew names`);
        const crews = names.map((n) => {
          const c = item!.std!.adoption.find((a) => a.name.toLowerCase() === n.toLowerCase());
          if (!c) throw new Error(`#${u.iid} has no crew "${n}"`);
          return c.name;
        });
        for (const c of crews) item = await this.toggleAdoption(item!, c, true);
        summary = `adopted by ${crews.join(', ')}`;
        break;
      }
    }
    if (u.assignee) summary += ` · → @${u.assignee}`;
    if (Object.keys(body).length) item = toItem(await this.gl.updateIssue(pid, u.iid, body));
    if (comment) await this.gl.addNote(pid, u.iid, comment);
    if (meetingIid) await this.gl.linkIssues(pid, meetingIid, pid, u.iid).catch(() => undefined);
    return { item: item!, summary };
  }

  /** Creates the meeting record and every new item in it, applies updates to existing items, and links it all together. */
  async captureMeeting(m: MeetingInput, drafts: Draft[], onProgress?: (msg: string) => void, updates: UpdateDraft[] = []) {
    const pid = this.project.id;
    onProgress?.('Creating meeting record…');
    const header = [`**Date:** ${m.date}`, m.attendees ? `**Attendees:** ${m.attendees}` : ''].filter(Boolean).join('  \n');
    const meeting = await this.gl.createIssue(pid, {
      title: `${m.title} (${m.date})`,
      description: `${header}\n\n## Notes\n\n${m.notes.trim()}\n`,
      labels: LABELS.meeting,
    });
    const created: Item[] = [];
    const updated: { iid: number; title: string; summary: string }[] = [];
    const errors: string[] = [];
    for (const [i, d] of drafts.entries()) {
      onProgress?.(`Creating ${d.type} ${i + 1}/${drafts.length}…`);
      try {
        created.push(await this.createItem(d, meeting.iid));
      } catch (e) {
        errors.push(`${d.title}: ${(e as Error).message}`);
      }
    }
    for (const [i, u] of updates.entries()) {
      onProgress?.(`Updating #${u.iid} (${i + 1}/${updates.length})…`);
      try {
        const r = await this.applyUpdate(u, meeting.iid);
        updated.push({ iid: u.iid, title: r.item.title, summary: r.summary });
      } catch (e) {
        errors.push(`#${u.iid}: ${(e as Error).message}`);
      }
    }
    const outcome = (k: string, label: string) => {
      const list = created.filter((c) => c.kind === k);
      return list.length ? [`### ${label}`, ...list.map((c) => `- #${c.iid} ${c.title}`), ''] : [];
    };
    const outcomes = [
      '## Outcomes',
      ...outcome('decision', 'Decisions'),
      ...outcome('action', 'Actions'),
      ...outcome('standard', 'Standards'),
      ...(updated.length ? ['### Updated', ...updated.map((u) => `- #${u.iid} ${u.title} — ${u.summary}`), ''] : []),
    ].join('\n');
    await this.gl.updateIssue(pid, meeting.iid, {
      description: `${meeting.description}\n${outcomes}\n`,
      state_event: 'close',
    });
    return { meetingIid: meeting.iid, created, updated, errors };
  }

  /** Post a prepared agenda as a comment on a meeting issue (usually the previous session). */
  postAgenda(meetingIid: number, markdown: string) {
    return this.gl.addNote(this.project.id, meetingIid, markdown);
  }

  close(it: Item) {
    return this.gl.updateIssue(it.projectId, it.iid, { state_event: 'close' }).then(toItem);
  }

  reopen(it: Item) {
    return this.gl.updateIssue(it.projectId, it.iid, { state_event: 'reopen' }).then(toItem);
  }

  setDue(it: Item, due: string | null) {
    return this.gl.updateIssue(it.projectId, it.iid, { due_date: due }).then(toItem);
  }

  async assign(it: Item, username?: string) {
    const ids = await this.assigneeIds(username);
    return toItem(await this.gl.updateIssue(it.projectId, it.iid, { assignee_ids: ids }));
  }

  rename(it: Item, title: string) {
    return this.gl.updateIssue(it.projectId, it.iid, { title }).then(toItem);
  }

  addNote(it: Item, body: string) {
    return this.gl.addNote(it.projectId, it.iid, body);
  }

  notes(it: Item) {
    return this.gl.notes(it.projectId, it.iid);
  }

  /** Comment that @-mentions the assignee, so GitLab notifies them, and push the follow-up date. */
  async nudge(it: Item, message: string, pushDays = 3) {
    const who = it.assignee ? `@${it.assignee.username} ` : '';
    await this.gl.addNote(it.projectId, it.iid, `${who}${message}`.trim());
    return this.setDue(it, addDays(todayIso(), pushDays));
  }

  // ---------- standards ----------

  async setStdStatus(it: Item, status: StdStatus, extra: Record<string, unknown> = {}) {
    const remove = Object.values(STD_LABEL).filter((l) => l !== STD_LABEL[status]);
    return toItem(
      await this.gl.updateIssue(it.projectId, it.iid, {
        add_labels: STD_LABEL[status],
        remove_labels: remove.join(','),
        ...extra,
      }),
    )!;
  }

  async toggleAdoption(it: Item, crew: string, done: boolean): Promise<Item> {
    let updated = toItem(
      await this.gl.updateIssue(it.projectId, it.iid, { description: setAdoption(it.description, crew, done) }),
    )!;
    await this.gl.addNote(it.projectId, it.iid, `${done ? '✅' : '↩️'} ${crew} ${done ? 'adopted' : 'not adopted yet'}`);
    const all = updated.std!.adoption;
    if (all.length && all.every((a) => a.done) && updated.std!.status !== 'adopted') {
      updated = await this.setStdStatus(updated, 'adopted', { state_event: 'close' });
    } else if (!all.every((a) => a.done) && updated.std!.status === 'adopted') {
      updated = await this.setStdStatus(updated, 'published', { state_event: 'reopen' });
    }
    return updated;
  }

  async addCrew(it: Item, crew: string, handle?: string) {
    return toItem(
      await this.gl.updateIssue(it.projectId, it.iid, { description: addAdoptionCrew(it.description, crew, handle) }),
    )!;
  }

  /** Commit the standard document on a new branch and open a merge request in the standards repo. */
  async publishStandard(it: Item, path: string, content: string) {
    const sp = await this.gl.project(this.settings.standardsProject);
    const branch = `standard/${path.split('/').pop()!.replace(/\.md$/, '')}-${Date.now().toString(36)}`;
    await this.gl.commit(sp.id, {
      branch,
      start_branch: sp.default_branch,
      commit_message: `Add standard: ${it.title}`,
      actions: [{ action: 'create', file_path: path, content }],
    });
    const mr = await this.gl.createMergeRequest(sp.id, {
      source_branch: branch,
      target_branch: sp.default_branch,
      title: `Standard: ${it.title}`,
      description: `Tracks ${this.project.path_with_namespace}#${it.iid}`,
      remove_source_branch: true,
    });
    const docUrl = `${sp.web_url}/-/blob/${sp.default_branch}/${path}`;
    let desc = setDocumentSection(it.description, `[${path}](${docUrl}) — review in ${mr.web_url}`);
    desc = setMarker(desc, 'mr', `${sp.id}:${mr.iid}`);
    desc = setMarker(desc, 'path', path);
    await this.gl.addNote(it.projectId, it.iid, `Opened merge request ${mr.web_url}`);
    return { item: await this.setStdStatus(it, 'review', { description: desc }), mr };
  }

  /** If the standard's MR got merged, move it to "published". */
  async syncStandard(it: Item): Promise<{ item: Item; mrState?: string; mrUrl?: string }> {
    if (!it.std?.mr) return { item: it };
    const mr = await this.gl.mergeRequest(it.std.mr.projectId, it.std.mr.iid);
    if (mr.state === 'merged' && it.std.status === 'review') {
      return { item: await this.setStdStatus(it, 'published'), mrState: mr.state, mrUrl: mr.web_url };
    }
    return { item: it, mrState: mr.state, mrUrl: mr.web_url };
  }

  /** Post a comment mentioning every crew that hasn't adopted yet. */
  async notifyCrews(it: Item, message: string) {
    const pending = (it.std?.adoption ?? []).filter((a) => !a.done).map((a) => a.name);
    const handles = this.settings.crews.filter((c) => pending.includes(c.name) && c.handle).map((c) => c.handle);
    await this.gl.addNote(it.projectId, it.iid, `${handles.join(' ')}\n\n${message}`.trim());
    return handles.length;
  }
}
