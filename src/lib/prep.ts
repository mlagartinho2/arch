// Meeting preparation: gather what matters for an upcoming meeting and turn it into an agenda.
// Pure functions only: no I/O, no React.
import type { GlUser } from './gitlab';
import { byDue, type Item } from './model';
import { humanDue } from './dates';

/** "Architecture Board (2026-11-12)" → "Architecture Board" */
export function seriesName(meetingTitle: string): string {
  return meetingTitle.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, '').trim();
}

export function seriesKey(name: string): string {
  return seriesName(name).toLowerCase().replace(/\s+/g, ' ');
}

export interface Series {
  name: string;
  key: string;
  /** Newest first */
  sessions: Item[];
}

/** Group meeting items into recurring series by title. */
export function listSeries(items: Item[]): Series[] {
  const map = new Map<string, Series>();
  for (const m of items.filter((i) => i.kind === 'meeting')) {
    const key = seriesKey(m.title);
    const s = map.get(key) ?? { name: seriesName(m.title), key, sessions: [] };
    s.sessions.push(m);
    map.set(key, s);
  }
  for (const s of map.values()) s.sessions.sort((a, b) => meetingDate(b).localeCompare(meetingDate(a)) || b.iid - a.iid);
  return [...map.values()].sort((a, b) => meetingDate(b.sessions[0]).localeCompare(meetingDate(a.sessions[0])));
}

/** Date of a meeting: from its title "(YYYY-MM-DD)", else its creation date. */
export function meetingDate(m: Item): string {
  return m.title.match(/\((\d{4}-\d{2}-\d{2})\)\s*$/)?.[1] ?? m.createdAt.slice(0, 10);
}

/** The free-text "Attendees:" line of a meeting description. */
export function meetingAttendeesText(m: Item): string {
  return m.description.match(/^\*\*Attendees:\*\*\s*(.+?)\s*$/m)?.[1] ?? '';
}

/**
 * Match free-text attendee names ("Anna, Jonas Weber, @sofia.ricci") to known GitLab users:
 * exact username, exact full name, or a first name that only one known user has.
 */
export function resolveAttendees(text: string, users: GlUser[]): { usernames: string[]; unresolved: string[] } {
  const usernames: string[] = [];
  const unresolved: string[] = [];
  for (const raw of text.split(/[,;\n]|\s+and\s+|\s+&\s+/i)) {
    const tok = raw.trim().replace(/^@/, '');
    if (!tok) continue;
    const t = tok.toLowerCase();
    let u = users.find((x) => x.username.toLowerCase() === t) ?? users.find((x) => x.name.toLowerCase() === t);
    if (!u) {
      const byFirst = users.filter((x) => x.name.toLowerCase().split(/\s+/)[0] === t);
      if (byFirst.length === 1) u = byFirst[0];
    }
    if (u) {
      if (!usernames.includes(u.username)) usernames.push(u.username);
    } else unresolved.push(tok);
  }
  return { usernames, unresolved };
}

export interface PrepInput {
  /** Meeting title; if it matches an existing series, earlier sessions are used */
  title: string;
  /** Attendee usernames (excluding or including me; "me" is ignored where it matters) */
  attendees: string[];
  /** Crew names whose pending standards should be on the agenda */
  crews: string[];
  me: string;
  users: GlUser[];
}

export type PrepSectionId = 'carry' | 'theyOwe' | 'mine' | 'standards' | 'decisions';

export interface PrepSection {
  id: PrepSectionId;
  title: string;
  hint: string;
  items: Item[];
}

export interface Prep {
  series?: Series;
  lastSession?: Item;
  sections: PrepSection[];
}

const openAction = (i: Item) => i.open && i.kind === 'action';

export function buildPrep(items: Item[], input: PrepInput): Prep {
  const key = seriesKey(input.title);
  const series = key ? listSeries(items).find((s) => s.key === key) : undefined;
  const sessionIids = new Set(series?.sessions.map((s) => s.iid) ?? []);
  const lastSession = series?.sessions[0];
  const people = new Set(input.attendees.filter((a) => a !== input.me));

  // Meetings each attendee was at, from the free-text attendee lines.
  const attendedBy = new Map<number, Set<string>>();
  for (const m of items.filter((i) => i.kind === 'meeting')) {
    attendedBy.set(m.iid, new Set(resolveAttendees(meetingAttendeesText(m), input.users).usernames));
  }
  const concernsAttendee = (i: Item) => {
    const text = `${i.title}\n${i.description}`.toLowerCase();
    const met = i.meetingIid ? attendedBy.get(i.meetingIid) : undefined;
    return [...people].some(
      (p) => i.author.username === p || text.includes(`@${p.toLowerCase()}`) || Boolean(met?.has(p)),
    );
  };

  const carry = items.filter((i) => openAction(i) && i.meetingIid !== undefined && sessionIids.has(i.meetingIid)).sort(byDue);
  const used = new Set(carry.map((i) => i.iid));
  const theyOwe = items
    .filter((i) => openAction(i) && !used.has(i.iid) && i.assignee && people.has(i.assignee.username))
    .sort(byDue);
  theyOwe.forEach((i) => used.add(i.iid));
  const mine = items
    .filter(
      (i) =>
        openAction(i) &&
        !used.has(i.iid) &&
        (i.assignee ? i.assignee.username === input.me : i.author.username === input.me) &&
        concernsAttendee(i),
    )
    .sort(byDue);
  const standards = items
    .filter(
      (i) =>
        i.kind === 'adoption' &&
        i.open &&
        ((i.meetingIid !== undefined && sessionIids.has(i.meetingIid)) ||
          (i.assignee && people.has(i.assignee.username)) ||
          (i.adoption !== undefined && input.crews.includes(i.adoption.team))),
    )
    .sort(byDue);
  const decisions = lastSession
    ? items.filter((i) => i.kind === 'decision' && i.meetingIid === lastSession.iid).sort((a, b) => a.iid - b.iid)
    : [];

  return {
    series,
    lastSession,
    sections: [
      { id: 'carry', title: 'Open from previous sessions', hint: 'Actions created in earlier sessions of this meeting', items: carry },
      { id: 'theyOwe', title: 'Waiting on attendees', hint: 'Open actions assigned to people in the room', items: theyOwe },
      { id: 'mine', title: 'On my side', hint: 'Your open actions that involve these people', items: mine },
      { id: 'standards', title: 'Standard adoption', hint: 'Open adoption issues of the teams in the room or of attendees', items: standards },
      {
        id: 'decisions',
        title: lastSession ? `Decisions from ${meetingDate(lastSession)}` : 'Decisions from last session',
        hint: 'Read back to confirm',
        items: decisions,
      },
    ],
  };
}

export interface AgendaOptions {
  title: string;
  date: string;
  attendeeNames: string[];
  topics: string;
  today: string;
  projectPath: string;
  /** iids left out by the user */
  excluded: Set<number>;
}

function meta(i: Item, today: string, mention: boolean) {
  if (i.kind === 'decision') return '';
  const who = i.assignee ? (mention ? `@${i.assignee.username}` : i.assignee.username) : '';
  return [who, i.due ? humanDue(i.due, today) : ''].filter(Boolean).join(', ');
}

function topicLines(topics: string) {
  return topics
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .map((l) => `- ${l}`);
}

/** Markdown agenda to share (GitLab references and @mentions link and notify in GitLab). */
export function agendaMarkdown(prep: Prep, o: AgendaOptions): string {
  const out = [`## ${o.title} — ${o.date}`];
  if (o.attendeeNames.length) out.push(`**Attendees:** ${o.attendeeNames.join(', ')}`);
  for (const s of prep.sections) {
    const its = s.items.filter((i) => !o.excluded.has(i.iid));
    if (!its.length) continue;
    out.push('', `### ${s.title}`);
    for (const i of its) {
      const m = meta(i, o.today, true);
      const box = i.kind === 'action' || i.kind === 'adoption' ? '- [ ] ' : '- ';
      out.push(`${box}${o.projectPath}#${i.iid} ${i.title}${m ? ` — ${m}` : ''}`);
    }
  }
  const t = topicLines(o.topics);
  if (t.length) out.push('', '### Other topics', ...t);
  return out.join('\n') + '\n';
}

/** Notes to start the meeting with: the agenda in a form the capture syntax can update in place. */
export function agendaNotes(prep: Prep, o: AgendaOptions): string {
  const out = ['Agenda from Arch. Tick [x] or write DONE / UPDATE / PUSH / DROP / ADOPTED #id to update items.'];
  for (const s of prep.sections) {
    const its = s.items.filter((i) => !o.excluded.has(i.iid));
    if (!its.length) continue;
    out.push('', `### ${s.title}`);
    for (const i of its) {
      const m = meta(i, o.today, false);
      const box = i.kind === 'action' || i.kind === 'adoption' ? '- [ ] ' : '- ';
      out.push(`${box}#${i.iid} ${i.title}${m ? ` (${m})` : ''}`);
    }
  }
  const t = topicLines(o.topics);
  if (t.length) out.push('', '### Other topics', ...t);
  out.push('', '### Discussion', '');
  return out.join('\n');
}
