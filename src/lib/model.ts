import type { GlIssue, GlUser } from './gitlab';
import { updateNote, type ItemType, type UpdateDraft, type UpdateOp } from './parser';
import { addDays } from './dates';

/** GitLab label conventions. Scoped labels (with "::") are mutually exclusive on Premium/Ultimate. */
export const LABELS = {
  meeting: 'fu::meeting',
  action: 'fu::action',
  decision: 'fu::decision',
  standard: 'fu::standard',
  stdDraft: 'fu-std::draft',
  stdReview: 'fu-std::review',
  stdPublished: 'fu-std::published',
  stdAdopted: 'fu-std::adopted',
} as const;

export const LABEL_DEFS: { name: string; color: string; description: string }[] = [
  { name: LABELS.meeting, color: '#6699cc', description: 'Arch: meeting notes' },
  { name: LABELS.action, color: '#d9534f', description: 'Arch: action item / follow-up' },
  { name: LABELS.decision, color: '#5cb85c', description: 'Arch: decision record' },
  { name: LABELS.standard, color: '#8e44ad', description: 'Arch: standard to publish and adopt' },
  { name: LABELS.stdDraft, color: '#bdc3c7', description: 'Standard: drafting' },
  { name: LABELS.stdReview, color: '#f0ad4e', description: 'Standard: merge request in review' },
  { name: LABELS.stdPublished, color: '#5bc0de', description: 'Standard: published, crews adopting' },
  { name: LABELS.stdAdopted, color: '#2ecc71', description: 'Standard: adopted by all crews' },
];

export type Kind = ItemType | 'meeting';
export type StdStatus = 'draft' | 'review' | 'published' | 'adopted';

export interface Adoption {
  name: string;
  done: boolean;
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
  std?: { status: StdStatus; adoption: Adoption[]; mr?: { projectId: number; iid: number }; path?: string };
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

// ---------- standards: adoption checklist ----------

export function parseAdoption(desc: string): Adoption[] {
  const idx = desc.search(/^## Adoption\s*$/m);
  if (idx < 0) return [];
  const section = desc.slice(idx).split('\n').slice(1);
  const out: Adoption[] = [];
  for (const line of section) {
    if (/^## /.test(line)) break;
    const m = line.match(/^\s*[-*] \[( |x|X)\] (.+?)\s*$/);
    if (m) out.push({ name: m[2].replace(/\s+—\s+@\S+$/, '').trim(), done: m[1] !== ' ' });
  }
  return out;
}

export function setAdoption(desc: string, crew: string, done: boolean): string {
  const lines = desc.split('\n');
  const start = lines.findIndex((l) => /^## Adoption\s*$/.test(l));
  if (start < 0) return desc;
  for (let i = start + 1; i < lines.length && !/^## /.test(lines[i]); i++) {
    const m = lines[i].match(/^(\s*[-*] \[)( |x|X)(\] )(.+?)\s*$/);
    if (m && m[4].replace(/\s+—\s+@\S+$/, '').trim() === crew) {
      lines[i] = `${m[1]}${done ? 'x' : ' '}${m[3]}${m[4]}`;
    }
  }
  return lines.join('\n');
}

export function addAdoptionCrew(desc: string, crew: string, handle?: string): string {
  const line = `- [ ] ${crew}${handle ? ` — ${handle}` : ''}`;
  const lines = desc.split('\n');
  const start = lines.findIndex((l) => /^## Adoption\s*$/.test(l));
  if (start < 0) return `${desc.trimEnd()}\n\n## Adoption\n${line}\n`;
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end]) && !/^<!-- fu:/.test(lines[end])) end++;
  let insertAt = end;
  while (insertAt > start + 1 && lines[insertAt - 1].trim() === '') insertAt--;
  lines.splice(insertAt, 0, line);
  return lines.join('\n');
}

export function standardDescription(opts: {
  summary: string;
  crews: { name: string; handle?: string }[];
  meetingIid?: number;
}): string {
  const parts = [
    '## Summary',
    opts.summary || '_To be written._',
    '',
    '## Document',
    '_Not published yet._',
    '',
    '## Adoption',
    ...(opts.crews.length ? opts.crews.map((c) => `- [ ] ${c.name}${c.handle ? ` — ${c.handle}` : ''}`) : ['_No crews configured._']),
    '',
  ];
  let d = parts.join('\n');
  if (opts.meetingIid) d = `From meeting #${opts.meetingIid}\n\n${d}`;
  if (opts.meetingIid) d = setMarker(d, 'meeting', String(opts.meetingIid));
  return d;
}

export function setDocumentSection(desc: string, text: string): string {
  const lines = desc.split('\n');
  const start = lines.findIndex((l) => /^## Document\s*$/.test(l));
  if (start < 0) return `${desc.trimEnd()}\n\n## Document\n${text}\n`;
  let end = start + 1;
  while (end < lines.length && !/^## /.test(lines[end]) && !/^<!-- fu:/.test(lines[end])) end++;
  lines.splice(start + 1, end - start - 1, text, '');
  return lines.join('\n');
}

// ---------- mapping ----------

export function kindOf(labels: string[]): Kind | null {
  if (labels.includes(LABELS.meeting)) return 'meeting';
  if (labels.includes(LABELS.standard)) return 'standard';
  if (labels.includes(LABELS.decision)) return 'decision';
  if (labels.includes(LABELS.action)) return 'action';
  return null;
}

export function stdStatusOf(labels: string[]): StdStatus {
  if (labels.includes(LABELS.stdAdopted)) return 'adopted';
  if (labels.includes(LABELS.stdPublished)) return 'published';
  if (labels.includes(LABELS.stdReview)) return 'review';
  return 'draft';
}

export const STD_LABEL: Record<StdStatus, string> = {
  draft: LABELS.stdDraft,
  review: LABELS.stdReview,
  published: LABELS.stdPublished,
  adopted: LABELS.stdAdopted,
};

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
  if (kind === 'standard') {
    const mr = getMarker(desc, 'mr');
    const [pid, mrIid] = mr ? mr.split(':').map(Number) : [];
    item.std = {
      status: stdStatusOf(i.labels),
      adoption: parseAdoption(desc),
      mr: mr ? { projectId: pid, iid: mrIid } : undefined,
      path: getMarker(desc, 'path'),
    };
  }
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
  return it.open && (it.kind === 'action' || it.kind === 'standard');
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
  if (u.op === 'done' && it.kind === 'standard') return { level: 'err', msg: `is a standard: use ADOPTED #${u.iid} <crew>` };
  if (u.op === 'adopted') {
    if (it.kind !== 'standard') return { level: 'err', msg: 'is not a standard' };
    const names = updateNote(u.text, it.title).split(/,|;|\s+and\s+|\s+&\s+/i).map((c) => c.trim()).filter(Boolean);
    if (!names.length) return { level: 'err', msg: 'name the crew(s) that adopted' };
    const missing = names.filter((n) => !it.std?.adoption.some((a) => a.name.toLowerCase() === n.toLowerCase()));
    if (missing.length) return { level: 'err', msg: `no crew ${missing.map((m) => `"${m}"`).join(', ')}` };
  }
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
