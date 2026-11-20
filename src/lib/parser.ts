import { addDays, resolveDate } from './dates';

export type ItemType = 'action' | 'decision' | 'standard';

export interface Draft {
  type: ItemType;
  title: string;
  /** GitLab username without "@"; undefined means "me" */
  assignee?: string;
  /** ISO date or undefined */
  due?: string;
  /** Indented lines written under the item */
  details: string;
  /** 1-based line number in the notes */
  line: number;
}

const KEYWORDS: Record<string, ItemType> = {
  action: 'action',
  ai: 'action',
  todo: 'action',
  ask: 'action',
  decision: 'decision',
  decided: 'decision',
  dec: 'decision',
  standard: 'standard',
  std: 'standard',
};

const ITEM_RE =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?(action|ai|todo|ask|decision|decided|dec|standard|std)\b\s*(?:(@[\w.\-]+)\s*)?[:\-–]?\s*(.*)$/i;
const DUE_RE = /(?:^|\s)(?:due|by|fu):\s*(\S+)/i;
const MENTION_RE = /(^|[\s(])@([\w.\-]+)/;

export interface ParseOptions {
  today: string;
  me?: string;
  defaultFollowUpDays?: number;
}

/** Parse a single line (quick-add or a notes line). Returns null if it is not an item line. */
export function parseLine(text: string, opts: ParseOptions, line = 1): Draft | null {
  const m = text.match(ITEM_RE);
  if (!m) return null;
  // Avoid false positives in prose ("AI strategy was discussed"): the keyword must be
  // written in capitals, or be followed by ":" or an @mention.
  const afterKw = text.slice(text.search(new RegExp(`\\b${m[1]}\\b`)) + m[1].length).trimStart();
  if (m[1] !== m[1].toUpperCase() && !/^[:@\-–]/.test(afterKw)) return null;
  if (m[1].toLowerCase() === 'ai' && !/^[:@]/.test(afterKw)) return null;
  const type = KEYWORDS[m[1].toLowerCase()];
  let assignee: string | undefined = m[2]?.slice(1);
  let rest = m[3].trim();

  let due: string | undefined;
  const dm = rest.match(DUE_RE);
  if (dm) {
    const resolved = resolveDate(dm[1], opts.today);
    if (resolved) {
      due = resolved;
      rest = (rest.slice(0, dm.index) + rest.slice((dm.index ?? 0) + dm[0].length)).trim();
    }
  }

  if (!assignee && type !== 'decision') {
    // "ACTION: @bob migrate X"  → strip leading mention; "ACTION: ask @bob to review" → keep text, still assign
    const lead = rest.match(/^@([\w.\-]+)[:,]?\s+/);
    if (lead) {
      assignee = lead[1];
      rest = rest.slice(lead[0].length);
    } else {
      const mm = rest.match(MENTION_RE);
      if (mm) assignee = mm[2];
    }
  }
  if (assignee && (assignee.toLowerCase() === 'me' || (opts.me && assignee.toLowerCase() === opts.me.toLowerCase()))) {
    assignee = undefined;
    rest = rest.replace(/(^|\s)@me\b/i, '$1').trim();
  }
  if (type === 'decision') assignee = undefined;

  if (!due && type === 'action' && opts.defaultFollowUpDays) {
    due = addDays(opts.today, opts.defaultFollowUpDays);
  }

  rest = rest.replace(/\s{2,}/g, ' ').replace(/[\s:;,-]+$/, '').trim();
  if (!rest) return null;
  return { type, title: rest.charAt(0).toUpperCase() + rest.slice(1), assignee, due, details: '', line };
}

// ---------- updates to existing items (in meetings and quick add) ----------

export type UpdateOp = 'done' | 'drop' | 'note' | 'push' | 'adopted';

export interface UpdateDraft {
  op: UpdateOp;
  iid: number;
  /** New follow-up date (push / note) */
  due?: string;
  /** Reassign to this username ("@user" written right after "#iid") */
  assignee?: string;
  /** Remaining free text: the note, or the crew names for "adopted" */
  text: string;
  line: number;
}

const UPDATE_KEYWORDS: Record<string, UpdateOp> = {
  done: 'done',
  closed: 'done',
  drop: 'drop',
  dropped: 'drop',
  update: 'note',
  upd: 'note',
  note: 'note',
  push: 'push',
  move: 'push',
  snooze: 'push',
  adopted: 'adopted',
};

const UPDATE_RE =
  /^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?(done|closed|dropped|drop|update|upd|note|push|move|snooze|adopted)\s*:?\s*#(\d+)\b(.*)$/i;
/** A ticked checkbox in front of an issue reference ("- [x] #7 …") means done. */
const TICKED_RE = /^\s*[-*+]\s+\[[xX]\]\s+#(\d+)\b(.*)$/;

/** Parse an update line such as "DONE #7", "UPDATE #7: vendor late", "PUSH #7 due:fri", "ADOPTED #14 Payments". */
export function parseUpdate(text: string, opts: ParseOptions, line = 1): UpdateDraft | null {
  const t = text.match(TICKED_RE);
  if (t) return { op: 'done', iid: Number(t[1]), text: t[2].trim(), line };
  const m = text.match(UPDATE_RE);
  if (!m) return null;
  const op = UPDATE_KEYWORDS[m[1].toLowerCase()];
  let rest = m[3];
  let assignee: string | undefined;
  const lead = rest.match(/^\s*@([\w.\-]+)/);
  if (lead) {
    assignee = lead[1];
    rest = rest.slice(lead[0].length);
    if (assignee.toLowerCase() === 'me' || (opts.me && assignee.toLowerCase() === opts.me.toLowerCase())) assignee = opts.me ?? 'me';
  }
  let due: string | undefined;
  const dm = rest.match(DUE_RE);
  if (dm) {
    const resolved = resolveDate(dm[1], opts.today);
    if (resolved) {
      due = resolved;
      rest = rest.slice(0, dm.index) + rest.slice((dm.index ?? 0) + dm[0].length);
    }
  }
  if (op === 'push' && !due) due = addDays(opts.today, opts.defaultFollowUpDays || 7);
  rest = rest.replace(/^[\s:\-–—]+/, '').replace(/\s{2,}/g, ' ').trim();
  return { op, iid: Number(m[2]), due, assignee, text: rest, line };
}

/**
 * The free text of an update, without a copy of the issue's own title. Agenda lines look like
 * "#7 Share load-test results (jonas.weber, 2d overdue)", so "DONE #7 Share load-test results (…): on the wiki"
 * becomes "on the wiki".
 */
export function updateNote(text: string, title?: string): string {
  let t = text.trim();
  if (title && t.toLowerCase().startsWith(title.toLowerCase())) {
    t = t.slice(title.length).replace(/^\s*\([^)]*\)/, '').replace(/^\s*—\s*[^:]*/, '');
  }
  return t.replace(/^[\s:\-–—]+/, '').trim();
}

export interface ParsedMeeting {
  items: Draft[];
  updates: UpdateDraft[];
}

/** Parse meeting notes into new items and updates to existing ones. Indented lines directly below an item become its details. */
export function parseMeeting(notes: string, opts: ParseOptions): ParsedMeeting {
  const items: Draft[] = [];
  const updates: UpdateDraft[] = [];
  let current: Draft | null = null;
  notes.split(/\r?\n/).forEach((raw, i) => {
    const u = parseUpdate(raw, opts, i + 1);
    if (u) {
      updates.push(u);
      current = null;
      return;
    }
    const d = parseLine(raw, opts, i + 1);
    if (d) {
      items.push(d);
      current = d;
      return;
    }
    if (current && /^(\s{2,}|\t)\S/.test(raw)) {
      const c: Draft = current;
      c.details = (c.details ? c.details + '\n' : '') + raw.trim().replace(/^[-*+]\s+/, '- ');
      return;
    }
    if (raw.trim() !== '') current = null;
  });
  return { items, updates };
}

/** New items only (see parseMeeting). */
export function parseNotes(notes: string, opts: ParseOptions): Draft[] {
  return parseMeeting(notes, opts).items;
}
