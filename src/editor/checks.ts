/* Checks run while editing: Markdown that renders badly (ported from GitLab Everything) plus Arch's own rules. */
import { resolveDate } from '../lib/dates';
import { updateProblem, type Item } from '../lib/model';
import { parseMeeting, type ParsedMeeting } from '../lib/parser';
import { headingId, splitRow, stripMd } from './markdown';

export type Severity = 'error' | 'warning' | 'info';
export interface Check { severity: Severity; line: number; message: string }

const byLine = (a: Check, b: Check) => a.line - b.line || 'ewi'.indexOf(a.severity[0]) - 'ewi'.indexOf(b.severity[0]);

export function checkMarkdown(src: string): Check[] {
  const L = src.split('\n');
  const out: Check[] = [];
  const seen = new Map<string, number>();
  let fence: number | null = null;
  let lastH = 0;
  let cols: number | null = null;
  L.forEach((l, i) => {
    if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) { fence = fence === null ? i : null; return; }
    if (fence !== null) return;
    const h = l.match(/^\s{0,3}(#{1,6})\s+(.*)$/);
    if (h) {
      const lv = h[1].length, id = headingId(stripMd(h[2]));
      if (lastH && lv > lastH + 1) out.push({ severity: 'warning', line: i, message: `Heading jumps from level ${lastH} to ${lv}` });
      lastH = lv;
      if (seen.has(id)) out.push({ severity: 'info', line: i, message: `Duplicate heading, also on line ${seen.get(id)! + 1}` });
      else seen.set(id, i);
    } else if (/^\s{0,3}#{1,6}[^\s#\d]/.test(l)) {
      out.push({ severity: 'info', line: i, message: 'Missing space after # — this will not render as a heading' });
    }
    const code = l.replace(/`[^`]*`/g, '');
    for (const m of code.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g)) {
      const [, bang, txt, href] = m;
      if (!href) out.push({ severity: 'error', line: i, message: `${bang ? 'Image' : 'Link'} has no target` });
      else if (bang && !txt.trim()) out.push({ severity: 'warning', line: i, message: 'Image has no alt text for screen readers' });
      else if (!bang && !txt.trim()) out.push({ severity: 'warning', line: i, message: 'Link has no text' });
      if (/^javascript:/i.test(href)) out.push({ severity: 'error', line: i, message: 'GitLab removes javascript: links' });
    }
    if (/<script\b/i.test(l)) out.push({ severity: 'error', line: i, message: 'GitLab strips script tags' });
    if (/^\s*\|/.test(l)) {
      const cells = splitRow(l).length;
      if (i + 1 < L.length && /^\s*\|?\s*:?-+:?\s*\|/.test(L[i + 1])) cols = cells;
      else if (cols !== null && !/^\s*\|?\s*:?-+/.test(l) && cells !== cols) out.push({ severity: 'warning', line: i, message: `Table row has ${cells} cells, the header has ${cols}` });
    } else cols = null;
  });
  if (fence !== null) out.push({ severity: 'error', line: fence, message: 'Code block is never closed' });
  return out.sort(byLine);
}

export interface PeopleCheck {
  /** Usernames known not to exist in GitLab */
  unknown: Set<string>;
}

/** Arch-specific problems in meeting notes: unknown people, unreadable dates, updates that can't apply. */
export function checkMeeting(src: string, parsed: ParsedMeeting, items: Map<number, Item>, people: PeopleCheck, today: string): Check[] {
  const out: Check[] = [];
  const L = src.split('\n');
  for (const d of parsed.items) {
    const i = d.line - 1;
    if (d.assignee && people.unknown.has(d.assignee.toLowerCase())) out.push({ severity: 'error', line: i, message: `@${d.assignee} is not a GitLab user — the item would be assigned to nobody` });
    if (!d.title.trim()) out.push({ severity: 'error', line: i, message: `${d.type === 'decision' ? 'Decision' : 'Item'} has no text` });
    if (d.type === 'decision' && d.due) out.push({ severity: 'info', line: i, message: 'Decisions have no follow-up date; the due: is ignored' });
  }
  for (const u of parsed.updates) {
    const p = updateProblem(u, items.get(u.iid));
    if (p) out.push({ severity: p.level === 'err' ? 'error' : 'warning', line: u.line - 1, message: `#${u.iid}: ${p.msg}` });
    if (u.assignee && people.unknown.has(u.assignee.toLowerCase())) out.push({ severity: 'error', line: u.line - 1, message: `@${u.assignee} is not a GitLab user` });
  }
  L.forEach((l, i) => {
    for (const m of l.matchAll(/(?:^|\s)(?:due|by|fu):\s*(\S+)/gi)) {
      if (!resolveDate(m[1], today)) out.push({ severity: 'warning', line: i, message: `“${m[1]}” is not a date Arch understands (try fri, +3d, 2w, eow, 15.12)` });
    }
    if (/^\s*(?:[-*+]\s+)?(?:DONE|UPDATE|PUSH|DROP|ADOPTED)\b(?!\s*:?\s*#\d)/.test(l)) {
      out.push({ severity: 'warning', line: i, message: 'Updates need an item number, like DONE #7' });
    }
  });
  return out.sort(byLine);
}

export function meetingChecks(src: string, items: Map<number, Item>, people: PeopleCheck, today: string, me: string, defaultFollowUpDays: number): Check[] {
  const parsed = parseMeeting(src, { today, me, defaultFollowUpDays });
  return [...checkMarkdown(src), ...checkMeeting(src, parsed, items, people, today)].sort(byLine);
}

/** Problems in a standard's body: the sections Arch's template expects, and rule keywords written in lower case. */
export function checkStandard(src: string): Check[] {
  const out = checkMarkdown(src);
  const L = src.split('\n');
  if (!L.some((l) => /^##\s+The standard\s*$/i.test(l))) out.push({ severity: 'warning', line: 0, message: 'No “## The standard” section: readers look there for the rules' });
  if (!L.some((l) => /^##\s+How to adopt\s*$/i.test(l))) out.push({ severity: 'info', line: 0, message: 'No “## How to adopt” section: adoption issues link to it' });
  L.forEach((l, i) => {
    if (/^\s*[-*+]\s+/.test(l) && /\*\*(must|should|may)( not)?\*\*/.test(l)) out.push({ severity: 'info', line: i, message: 'Rule keywords are written in capitals (MUST, SHOULD, MAY)' });
    if (/…\s*$/.test(l) && /\*\*(MUST|SHOULD)/.test(l)) out.push({ severity: 'warning', line: i, message: 'Template placeholder still here' });
  });
  return out.sort(byLine);
}
