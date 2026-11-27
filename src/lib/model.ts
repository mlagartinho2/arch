import type { GlIssue, GlUser } from './gitlab';
import { updateNote, type UpdateDraft, type UpdateOp } from './parser';
import { addDays } from './dates';

/** GitLab label conventions. Scoped labels (with "::") are mutually exclusive on Premium/Ultimate. */
export const LABELS = {
  meeting: 'fu::meeting',
  action: 'fu::action',
  decision: 'fu::decision',
  adoption: 'fu::adoption',
} as const;

export const LABEL_DEFS: { name: string; color: string; description: string }[] = [
  { name: LABELS.meeting, color: '#6699cc', description: 'Arch: meeting notes' },
  { name: LABELS.action, color: '#d9534f', description: 'Arch: action item / follow-up' },
  { name: LABELS.decision, color: '#5cb85c', description: 'Arch: decision record' },
  { name: LABELS.adoption, color: '#8e44ad', description: 'Arch: one team adopting one version of a standard' },
];

export type Kind = 'action' | 'decision' | 'meeting' | 'adoption';

/** An adoption issue: one team adopting one version of one standard. */
export interface AdoptionRef {
  /** Standard id (file name without .md) */
  std: string;
  version: string;
  team: string;
  /** Set when the issue was closed without adopting: replaced by a newer cycle, or dropped */
  outcome?: 'superseded' | 'dropped';
}

/** A closed adoption issue counts as adopted unless it was superseded or dropped. */
export function isAdopted(it: Item) {
  return it.kind === 'adoption' && !it.open && !it.adoption?.outcome;
}

export interface Item {
  iid: number;
  projectId: number;
  kind: Kind;
  title: string;
  description: string;
  open: boolean;
  assignee?: GlUser;
  author: GlUser;
  due?: string;
  labels: string[];
  webUrl: string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  notesCount: number;
  meetingIid?: number;
  /** Set on adoption issues */
  adoption?: AdoptionRef;
  /** An action created from a "STANDARD:" line: a standard still to be written */
  newStandard?: boolean;
}

// ---------- hidden markers stored in issue descriptions ----------

export function getMarker(desc: string, key: string): string | undefined {
  const m = desc.match(new RegExp(`<!-- fu:${key}=([^ ]*?) -->`));
  return m?.[1];
}

export function setMarker(desc: string, key: string, value: string): string {
  const tag = `<!-- fu:${key}=${value} -->`;
  const re = new RegExp(`<!-- fu:${key}=[^ ]*? -->`);
  return re.test(desc) ? desc.replace(re, tag) : `${desc.trimEnd()}\n${tag}\n`;
}

// ---------- adoption issues ----------

export function adoptionTitle(title: string, version: string, team: string) {
  return `Adopt "${title}" v${version} — ${team}`;
}

/** Description of an adoption issue. Markers carry the standard, version and team (team URI-encoded). */
export function adoptionDescription(o: {
  stdId: string;
  stdTitle: string;
  version: string;
  categoryLabel: string;
  wikiUrl: string;
  team: string;
  teamHandle?: string;
  responsible: string;
  due: string;
  /** Changelog entries the team still has to take in, newest first */
  changes: { version: string; date: string; change: string }[];
  firstAdoption: boolean;
  meetingIid?: number;
}): string {
  const lines = [
    `**Standard:** [${o.stdTitle} v${o.version}](${o.wikiUrl}) · ${o.categoryLabel}  `,
    `**Team:** ${o.team}${o.teamHandle ? ` (${o.teamHandle})` : ''}  `,
    `**Responsible:** @${o.responsible} · **Adopt by:** ${o.due}`,
    '',
    o.firstAdoption ? '### What to adopt' : '### What changed since your last adopted version',
    ...(o.firstAdoption
      ? ['The whole standard (first adoption by this team).']
      : o.changes.map((c) => `- **${c.version}** (${c.date}): ${c.change}`)),
    '',
    'Close this issue once the team has adopted this version. Comment here if you need help or an exception.',
  ];
  let d = lines.join('\n');
  if (o.meetingIid) d = `From meeting #${o.meetingIid}\n\n${d}`;
  d = setMarker(d, 'std', o.stdId);
  d = setMarker(d, 'ver', o.version);
  d = setMarker(d, 'team', encodeURIComponent(o.team));
  if (o.meetingIid) d = setMarker(d, 'meeting', String(o.meetingIid));
  return d;
}

// ---------- mapping ----------

export function kindOf(labels: string[]): Kind | null {
  if (labels.includes(LABELS.meeting)) return 'meeting';
  if (labels.includes(LABELS.adoption)) return 'adoption';
  if (labels.includes(LABELS.decision)) return 'decision';
  if (labels.includes(LABELS.action)) return 'action';
  return null;
}

export function toItem(i: GlIssue): Item | null {
  const kind = kindOf(i.labels);
  if (!kind) return null;
  const desc = i.description ?? '';
  const meeting = getMarker(desc, 'meeting');
  const item: Item = {
    iid: i.iid,
    projectId: i.project_id,
    kind,
    title: i.title,
    description: desc,
    open: i.state === 'opened',
    assignee: i.assignees?.[0],
    author: i.author,
    due: i.due_date ?? undefined,
    labels: i.labels,
    webUrl: i.web_url,
    createdAt: i.created_at,
    updatedAt: i.updated_at,
    closedAt: i.closed_at ?? undefined,
    notesCount: i.user_notes_count,
    meetingIid: meeting ? Number(meeting) : undefined,
  };
  if (kind === 'adoption') {
    const std = getMarker(desc, 'std');
    const version = getMarker(desc, 'ver');
    const team = getMarker(desc, 'team');
    const outcome = getMarker(desc, 'outcome');
    if (std && version && team) {
      item.adoption = { std, version, team: decodeURIComponent(team) };
      if (outcome === 'superseded' || outcome === 'dropped') item.adoption.outcome = outcome;
    }
  }
  if (kind === 'action' && getMarker(desc, 'newstandard')) item.newStandard = true;
  return item;
}

// ---------- views ----------

export function isMine(it: Item, me: string): boolean {
  return it.assignee ? it.assignee.username === me : it.author.username === me;
}

export function isWaiting(it: Item, me: string): boolean {
  return Boolean(it.assignee && it.assignee.username !== me);
}

export function isTrackable(it: Item): boolean {
  return it.open && (it.kind === 'action' || it.kind === 'adoption');
}

export function isOverdue(it: Item, today: string) {
  return Boolean(it.due && it.due < today);
}

export function isDueSoon(it: Item, today: string, days = 7) {
  return Boolean(it.due && it.due >= today && it.due <= addDays(today, days));
}

export function byDue(a: Item, b: Item) {
  return (a.due ?? '9999') .localeCompare(b.due ?? '9999') || a.iid - b.iid;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------- validating updates against known items ----------

export const UPDATE_LABEL: Record<UpdateOp, string> = {
  done: 'Done',
  drop: 'Drop',
  note: 'Update',
  push: 'Push',
  adopted: 'Adopted',
};

/** What's wrong with an update, judged from the items already loaded. `err` updates are skipped by default. */
export function updateProblem(u: UpdateDraft, it: Item | undefined): { level: 'err' | 'warn'; msg: string } | null {
  if (!it) return { level: 'warn', msg: `#${u.iid} isn't loaded; it will be looked up in GitLab` };
  if (it.kind === 'meeting') return { level: 'err', msg: 'is a meeting' };
  if (u.op === 'adopted' && it.kind !== 'adoption') return { level: 'err', msg: 'is not an adoption issue: use DONE' };
  if (u.op === 'note' && !updateNote(u.text, it.title) && !u.due && !u.assignee) return { level: 'err', msg: 'nothing to update: add ": text"' };
  if ((u.op === 'done' || u.op === 'drop') && !it.open) return { level: 'warn', msg: 'already closed' };
  return null;
}

/** The "### Updated" list a meeting writes into its own description: "- #7 Title — summary". */
export function meetingUpdates(desc: string): { iid: number; title: string; summary: string }[] {
  const start = desc.search(/^### Updated\s*$/m);
  if (start < 0) return [];
  const out: { iid: number; title: string; summary: string }[] = [];
  for (const line of desc.slice(start).split('\n').slice(1)) {
    if (/^#{2,3} /.test(line)) break;
    const m = line.match(/^- #(\d+) (.*) — (.+)$/);
    if (m) out.push({ iid: Number(m[1]), title: m[2], summary: m[3] });
  }
  return out;
}
