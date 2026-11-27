/* Preview of meeting notes: ordinary Markdown, with every Arch line shown as the card it will become. */
import { daysBetween, fromIso, humanDue } from '../lib/dates';
import { updateProblem, UPDATE_LABEL, type Item } from '../lib/model';
import { updateNote, type Draft, type ParsedMeeting, type UpdateDraft } from '../lib/parser';
import { esc, mdInline, mdRender, type Heading } from './markdown';

export interface MeetingPreviewContext {
  today: string;
  items: Map<number, Item>;
  /** Display name of a username ("Lukas Brunner"), or undefined when unknown */
  name: (username: string) => string | undefined;
  unknown: Set<string>;
  /** Items and updates the person unticked in the Items tab */
  isOff: (d: Draft | UpdateDraft) => boolean;
}

const KIND_LABEL = { action: 'Action', decision: 'Decision', standard: 'Standard to write' } as const;
const longDate = (iso: string) => fromIso(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const due = (iso: string, today: string) => {
  const n = daysBetween(today, iso);
  return n >= -1 && n <= 1 ? humanDue(iso, today) : longDate(iso);
};

function itemCard(d: Draft, line: number, ctx: MeetingPreviewContext): string {
  const meta: string[] = [];
  if (d.type !== 'decision') {
    const who = d.assignee ? ctx.name(d.assignee) ?? `@${d.assignee}` : 'me';
    const bad = d.assignee && ctx.unknown.has(d.assignee.toLowerCase());
    meta.push(`<span class="${bad ? 'err' : ''}">→ ${esc(who)}${bad ? ' (not a GitLab user)' : ''}</span>`);
  }
  if (d.due) meta.push(`<span>due ${esc(due(d.due, ctx.today))}</span>`);
  const off = ctx.isOff(d);
  if (off) meta.push('<span class="muted">not created</span>');
  const details = d.details ? `<div class="mcard-d">${mdRender(d.details, { item: (i) => ctx.items.get(i) }).html}</div>` : '';
  return `<div class="mcard mcard-${d.type}${off ? ' off' : ''}" data-line="${line}"><div class="mcard-h"><span class="kind kind-${d.type}">${KIND_LABEL[d.type]}</span><span class="mcard-t">${mdInline(d.title || '…', { item: (i) => ctx.items.get(i) })}</span></div>${meta.length ? `<div class="mcard-m">${meta.join('<span class="dot">·</span>')}</div>` : ''}${details}</div>`;
}

function updateCard(u: UpdateDraft, line: number, ctx: MeetingPreviewContext): string {
  const it = ctx.items.get(u.iid);
  const p = updateProblem(u, it);
  const off = ctx.isOff(u);
  const meta: string[] = [];
  if (u.due) meta.push(`<span>follow-up → ${esc(due(u.due, ctx.today))}</span>`);
  if (u.assignee) meta.push(`<span>→ ${esc(ctx.name(u.assignee) ?? '@' + u.assignee)}</span>`);
  const note = updateNote(u.text, it?.title);
  if (note) meta.push(`<span class="muted">“${esc(note)}”</span>`);
  if (p) meta.push(`<span class="${p.level === 'err' ? 'err' : 'warn-txt'}">${esc(p.msg)}</span>`);
  if (off) meta.push('<span class="muted">skipped</span>');
  return `<div class="mcard mcard-update${off ? ' off' : ''}${p?.level === 'err' ? ' bad' : ''}" data-line="${line}" data-iid="${u.iid}"><div class="mcard-h"><span class="op op-${u.op}">${UPDATE_LABEL[u.op]}</span><span class="ref">#${u.iid}</span><span class="mcard-t">${it ? esc(it.title) : '<span class="muted">unknown item</span>'}</span></div>${meta.length ? `<div class="mcard-m">${meta.join('<span class="dot">·</span>')}</div>` : ''}</div>`;
}

export function renderMeetingPreview(notes: string, parsed: ParsedMeeting, ctx: MeetingPreviewContext): { html: string; headings: Heading[] } {
  const L = notes.replace(/\r\n?/g, '\n').split('\n');
  const cards = new Map<number, { html: string; end: number }>();
  const indented = (l: string | undefined) => l !== undefined && /^(\s{2,}|\t)\S/.test(l);
  for (const d of parsed.items) {
    const i = d.line - 1;
    let end = i + 1;
    while (end < L.length) {
      if (indented(L[end])) { end++; continue; }
      let k = end;
      while (k < L.length && !L[k].trim()) k++;
      if (k > end && d.details && indented(L[k])) { end = k; continue; }
      break;
    }
    cards.set(i, { html: itemCard(d, i, ctx), end });
  }
  for (const u of parsed.updates) cards.set(u.line - 1, { html: updateCard(u, u.line - 1, ctx), end: u.line });

  let html = '';
  const headings: Heading[] = [];
  let chunk: string[] = [], start = 0;
  const flush = () => {
    if (chunk.some((l) => l.trim())) {
      const r = mdRender(chunk.join('\n'), { lineOffset: start, tasks: true, item: (i) => ctx.items.get(i) });
      html += r.html;
      headings.push(...r.headings);
    }
    chunk = [];
  };
  for (let i = 0; i < L.length;) {
    const c = cards.get(i);
    if (c) { flush(); html += c.html; i = c.end; start = i; continue; }
    if (!chunk.length) start = i;
    chunk.push(L[i]);
    i++;
  }
  flush();
  return { html, headings };
}
