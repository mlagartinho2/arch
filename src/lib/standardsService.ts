// Standards: documents in a repository (reviewed in merge requests), mirrored to a wiki, with optional adoption cycles.
import type { GitLab, GlCommit, GlMergeRequest, GlProject, GlUser } from './gitlab';
import { categoryLabel, wikiTarget, type Settings } from './settings';
import { LABELS, adoptionDescription, adoptionTitle, isAdopted, setMarker, toItem, type Item } from './model';
import {
  changesSince,
  compareVersions,
  newStandardDoc,
  nextVersion,
  parseStandardFile,
  parseStandardPath,
  parseWikiMarker,
  renderStandardFile,
  renderWikiIndex,
  renderWikiPage,
  slug,
  standardFilePath,
  wikiSlug,
  type StandardDoc,
  type StandardMeta,
  type StandardStatus,
} from './standards';
import { todayIso } from './dates';

/** An open merge request that creates or changes a standard. */
export interface Proposal {
  mr: GlMergeRequest;
  id: string;
  kind: 'new' | 'change';
  /** Version the MR would publish */
  version: string;
  title: string;
}

export interface StandardEntry {
  doc: StandardDoc;
  /** File path on the default branch */
  path: string;
  wikiSlug: string;
  wikiUrl: string;
  sourceUrl: string;
  historyUrl: string;
  /** Version currently on the wiki; undefined when the page is missing */
  wikiVersion?: string;
  /** Open merge requests changing this standard */
  proposals: Proposal[];
}

export interface Catalog {
  project: GlProject;
  entries: StandardEntry[];
  /** Open merge requests for standards that don't exist on the default branch yet */
  newProposals: Proposal[];
  /** Set when the wiki couldn't be read (disabled, no access, group wiki without Premium) */
  wikiError?: string;
  loadedAt: Date;
}

export interface TeamAssignment {
  team: string;
  responsible: string;
  due: string;
}

const MR_MARKER = /<!-- arch:proposal id=(\S+) version=(\S+) kind=(new|change) -->/;

async function mapLimit<T, R>(xs: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, xs.length) }, async () => {
      while (i < xs.length) {
        const k = i++;
        out[k] = await fn(xs[k]);
      }
    }),
  );
  return out;
}

export class StandardsService {
  constructor(
    private gl: GitLab,
    private settings: Settings,
    private me: () => GlUser,
    /** Project id of the follow-ups project, where adoption issues live */
    private followupsId: () => number,
  ) {}

  get configured() {
    return Boolean(this.settings.standardsProject);
  }

  private label(key: string) {
    return categoryLabel(this.settings, key);
  }

  private entryFor(project: GlProject, doc: StandardDoc, path: string): Omit<StandardEntry, 'wikiVersion' | 'proposals'> {
    const ws = wikiSlug(this.settings.wikiPrefix, doc.meta.category, doc.meta.id);
    return {
      doc,
      path,
      wikiSlug: ws,
      wikiUrl: this.gl.wikiUrl(wikiTarget(this.settings), ws),
      sourceUrl: `${project.web_url}/-/blob/${project.default_branch}/${path}`,
      historyUrl: `${project.web_url}/-/commits/${project.default_branch}/${path}`,
    };
  }

  async loadCatalog(): Promise<Catalog> {
    const s = this.settings;
    const project = await this.gl.project(s.standardsProject);
    const branch = project.default_branch;
    const tree = await this.gl.tree(project.id, s.standardsFolder, branch).catch((e) => {
      if (String(e.message).includes('404')) return [];
      throw e;
    });
    const files = tree.filter((t) => t.type === 'blob' && parseStandardPath(s.standardsFolder, t.path));
    const docs = await mapLimit(files, 6, async (f) => {
      const p = parseStandardPath(s.standardsFolder, f.path)!;
      const doc = parseStandardFile(await this.gl.rawFile(project.id, f.path, branch), { id: p.id, category: p.category });
      return this.entryFor(project, doc, f.path);
    });

    let wikiError: string | undefined;
    const wikiVersions = new Map<string, string>();
    try {
      for (const page of await this.gl.wikiPages(wikiTarget(s))) {
        const m = page.content ? parseWikiMarker(page.content) : null;
        if (m) wikiVersions.set(page.slug, m.version);
      }
    } catch (e) {
      wikiError = (e as Error).message;
    }

    const proposals: Proposal[] = [];
    for (const mr of await this.gl.mergeRequests(project.id, 'opened')) {
      const m = (mr.description ?? '').match(MR_MARKER);
      if (m) proposals.push({ mr, id: m[1], version: m[2], kind: m[3] as 'new' | 'change', title: mr.title });
    }
    const ids = new Set(docs.map((d) => d.doc.meta.id));
    const entries: StandardEntry[] = docs
      .map((d) => ({ ...d, wikiVersion: wikiVersions.get(d.wikiSlug), proposals: proposals.filter((p) => p.id === d.doc.meta.id) }))
      .sort((a, b) => a.doc.meta.title.localeCompare(b.doc.meta.title));
    return { project, entries, newProposals: proposals.filter((p) => !ids.has(p.id)), wikiError, loadedAt: new Date() };
  }

  private async openProposal(
    project: GlProject,
    doc: StandardDoc,
    kind: 'new' | 'change',
    actions: Parameters<GitLab['commit']>[1]['actions'],
    note: string,
  ) {
    const branch = `standard/${doc.meta.id}-${doc.meta.version.replace('.', '-')}-${Date.now().toString(36)}`;
    const verb = kind === 'new' ? 'Add' : 'Update';
    await this.gl.commit(project.id, {
      branch,
      start_branch: project.default_branch,
      commit_message: `${verb} standard ${doc.meta.title} v${doc.meta.version}\n\n${note}`,
      actions,
    });
    return this.gl.createMergeRequest(project.id, {
      source_branch: branch,
      target_branch: project.default_branch,
      title: `Standard: ${doc.meta.title} v${doc.meta.version}${kind === 'new' ? ' (new)' : ''}`,
      description: [
        `**${kind === 'new' ? 'New standard' : 'Change'}:** ${note}`,
        '',
        `Category: ${this.label(doc.meta.category)} · Version ${doc.meta.version}`,
        '',
        'Proposed with Arch. Once merged, Arch publishes this version to the wiki and you can start an adoption cycle.',
        '',
        `<!-- arch:proposal id=${doc.meta.id} version=${doc.meta.version} kind=${kind} -->`,
      ].join('\n'),
      remove_source_branch: true,
    });
  }

  /** Open a merge request that adds a new standard at version 1.0. */
  async proposeNew(
    catalog: Catalog,
    input: { title: string; category: string; tags: string[]; owner?: string; body: string; note?: string },
    fromIssueIid?: number,
  ) {
    const id = slug(input.title);
    if (!id) throw new Error('Give the standard a title');
    if (catalog.entries.some((e) => e.doc.meta.id === id) || catalog.newProposals.some((p) => p.id === id)) {
      throw new Error(`A standard with the id "${id}" already exists or is proposed`);
    }
    const doc = newStandardDoc(
      { id, title: input.title.trim(), category: slug(input.category), tags: input.tags, owner: input.owner || this.me().username },
      input.body,
      todayIso(),
      input.note || 'Initial version',
    );
    const path = standardFilePath(this.settings.standardsFolder, doc.meta.category, id);
    const mr = await this.openProposal(catalog.project, doc, 'new', [{ action: 'create', file_path: path, content: renderStandardFile(doc) }], input.note || 'Initial version');
    if (fromIssueIid) {
      await this.gl.addNote(this.followupsId(), fromIssueIid, `📝 Draft opened for review: ${mr.web_url}`).catch(() => undefined);
    }
    return mr;
  }

  /** Open a merge request with a new version of an existing standard (re-read from the default branch first). */
  async proposeChange(
    catalog: Catalog,
    entry: StandardEntry,
    change: {
      kind: 'major' | 'minor';
      note: string;
      body: string;
      meta: Partial<Pick<StandardMeta, 'title' | 'category' | 'tags' | 'owner' | 'status'>>;
    },
  ) {
    if (!change.note.trim()) throw new Error('Describe the change: it goes in the changelog');
    const project = catalog.project;
    const current = parseStandardFile(await this.gl.rawFile(project.id, entry.path, project.default_branch), {
      id: entry.doc.meta.id,
      category: entry.doc.meta.category,
    });
    if (current.meta.version !== entry.doc.meta.version) {
      throw new Error(`The standard changed to v${current.meta.version} since you opened it. Reload and try again.`);
    }
    const meta = { ...change.meta, ...(change.meta.category ? { category: slug(change.meta.category) } : {}) };
    const doc = nextVersion(current, { kind: change.kind, note: change.note.trim(), date: todayIso() }, { body: change.body, meta });
    const path = standardFilePath(this.settings.standardsFolder, doc.meta.category, doc.meta.id);
    const content = renderStandardFile(doc);
    const actions =
      path === entry.path
        ? [{ action: 'update' as const, file_path: path, content }]
        : [{ action: 'move' as const, file_path: path, previous_path: entry.path, content }];
    return this.openProposal(project, doc, 'change', actions, change.note.trim());
  }

  /** Publish the default-branch version of a standard to the wiki (and refresh the index page). */
  async publish(catalog: Catalog, entries: StandardEntry[]) {
    const t = wikiTarget(this.settings);
    const existing = new Map((await this.gl.wikiPages(t)).map((p) => [p.slug, p]));
    for (const e of entries) {
      const content = renderWikiPage(e.doc, { categoryLabel: this.label(e.doc.meta.category), sourceUrl: e.sourceUrl, historyUrl: e.historyUrl });
      if (existing.has(e.wikiSlug)) await this.gl.updateWikiPage(t, e.wikiSlug, { title: e.wikiSlug, content });
      else await this.gl.createWikiPage(t, { title: e.wikiSlug, content });
      // A category change moves the page: remove the copy under the old category.
      for (const [slugKey, page] of existing) {
        const m = page.content ? parseWikiMarker(page.content) : null;
        if (m && m.id === e.doc.meta.id && slugKey !== e.wikiSlug) await this.gl.deleteWikiPage(t, slugKey);
      }
      e.wikiVersion = e.doc.meta.version;
    }
    const index = renderWikiIndex(
      catalog.entries.map((e) => e.doc),
      this.settings.wikiPrefix,
      (k) => this.label(k),
    );
    const prefix = this.settings.wikiPrefix.replace(/^\/+|\/+$/g, '');
    if (existing.has(prefix)) await this.gl.updateWikiPage(t, prefix, { title: prefix, content: index });
    else await this.gl.createWikiPage(t, { title: prefix, content: index });
  }

  /** Delete mirrored wiki pages whose standard no longer exists in the repository (used by the CI sync). */
  async prune(catalog: Catalog) {
    const t = wikiTarget(this.settings);
    const ids = new Set(catalog.entries.map((e) => e.doc.meta.id));
    const removed: string[] = [];
    for (const page of await this.gl.wikiPages(t)) {
      const m = page.content ? parseWikiMarker(page.content) : null;
      if (m && !ids.has(m.id)) {
        await this.gl.deleteWikiPage(t, page.slug);
        removed.push(page.slug);
      }
    }
    return removed;
  }

  history(catalog: Catalog, entry: StandardEntry): Promise<GlCommit[]> {
    return this.gl.fileCommits(catalog.project.id, entry.path, catalog.project.default_branch);
  }

  /** Read an earlier version of the file, by commit. */
  async versionAt(catalog: Catalog, entry: StandardEntry, sha: string) {
    return parseStandardFile(await this.gl.rawFile(catalog.project.id, entry.path, sha), { id: entry.doc.meta.id, category: entry.doc.meta.category });
  }

  /**
   * Start an adoption cycle for the current version: one issue per team, assigned to its responsible person, due by its deadline.
   * Each issue lists the changes the team hasn't adopted yet. Open issues of the same team for older versions are superseded (closed with a link).
   */
  async startCycle(entry: StandardEntry, teams: TeamAssignment[], items: Item[], opts: { supersede: boolean; meetingIid?: number }) {
    const pid = this.followupsId();
    const doc = entry.doc;
    const version = doc.meta.version;
    const created: Item[] = [];
    const errors: string[] = [];
    for (const t of teams) {
      try {
        const mine = items.filter((i) => i.kind === 'adoption' && i.adoption?.std === doc.meta.id && i.adoption.team === t.team);
        if (mine.some((i) => i.adoption!.version === version && i.open)) throw new Error(`already has an open adoption issue for v${version}`);
        const adopted = mine
          .filter(isAdopted)
          .map((i) => i.adoption!.version)
          .sort(compareVersions)
          .pop();
        const user = await this.gl.userByUsername(t.responsible);
        if (!user) throw new Error(`GitLab user @${t.responsible} not found`);
        const crew = this.settings.crews.find((c) => c.name === t.team);
        const issue = await this.gl.createIssue(pid, {
          title: adoptionTitle(doc.meta.title, version, t.team),
          description: adoptionDescription({
            stdId: doc.meta.id,
            stdTitle: doc.meta.title,
            version,
            categoryLabel: this.label(doc.meta.category),
            wikiUrl: entry.wikiUrl,
            team: t.team,
            teamHandle: crew?.handle,
            responsible: user.username,
            due: t.due,
            changes: changesSince(doc, adopted, version),
            firstAdoption: !adopted,
            meetingIid: opts.meetingIid,
          }),
          labels: LABELS.adoption,
          assignee_ids: [user.id],
          due_date: t.due,
        });
        const item = toItem(issue)!;
        created.push(item);
        if (opts.supersede) {
          for (const old of mine.filter((i) => i.open && compareVersions(i.adoption!.version, version) < 0)) {
            await this.gl.addNote(pid, old.iid, `⏭️ Superseded by v${version}: #${item.iid}`);
            await this.gl.updateIssue(pid, old.iid, { state_event: 'close', description: setMarker(old.description, 'outcome', 'superseded') });
          }
        }
      } catch (e) {
        errors.push(`${t.team}: ${(e as Error).message}`);
      }
    }
    return { created, errors };
  }
}

/** Adoption issues of one standard grouped by version, newest version first. */
export function adoptionCycles(items: Item[], stdId: string) {
  const map = new Map<string, Item[]>();
  for (const i of items.filter((x) => x.kind === 'adoption' && x.adoption?.std === stdId)) {
    map.set(i.adoption!.version, [...(map.get(i.adoption!.version) ?? []), i]);
  }
  return [...map.entries()]
    .sort((a, b) => compareVersions(b[0], a[0]))
    .map(([version, issues]) => ({
      version,
      issues: issues.sort((a, b) => a.adoption!.team.localeCompare(b.adoption!.team)),
      adopted: issues.filter(isAdopted).length,
      /** Issues that still count: open or adopted (not superseded or dropped) */
      active: issues.filter((i) => !i.adoption!.outcome).length,
    }));
}

export type { StandardStatus };
