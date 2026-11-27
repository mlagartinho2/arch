/* Suggestions while typing: / blocks and Arch lines, @ people, # items, ! merge requests, due: dates. Built on GitLab Everything's completion source. */
import { startCompletion, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import { addDays, fromIso, resolveDate } from '../lib/dates';
import { COMMANDS, type CommandId } from './commands';

export interface Person { username: string; name: string; hint?: string }
export interface ItemRef { iid: number; title: string; kind: string; open: boolean }

export type EditorMode = 'meeting' | 'description' | 'comment' | 'standard';

export interface CompletionData {
  mode: EditorMode;
  today: string;
  /** People in the order to suggest them (attendees first). The query is what follows the @. */
  people: (query: string) => Promise<Person[]>;
  items: () => ItemRef[];
  /** Open merge requests in the standards repository, for "!" (standard editor only) */
  mergeRequests?: () => { iid: number; title: string }[];
  /** Standards, for "Link a standard" */
  standards?: () => { title: string; version: string; url: string }[];
  /** Commands that need the app (for example a date picker). Return true when handled. */
  run?: (id: string, view: EditorView) => boolean;
}

interface Slash { id: CommandId | 'linkStandard'; label: string; detail: string; group: string; modes?: EditorMode[] }

const MEETING: EditorMode[] = ['meeting'];
export const SLASH: Slash[] = [
  { id: 'action', label: 'Action', detail: 'ACTION @owner: …', group: 'Arch', modes: MEETING },
  { id: 'todo', label: 'My action', detail: 'TODO: …', group: 'Arch', modes: MEETING },
  { id: 'decision', label: 'Decision', detail: 'DECISION: …', group: 'Arch', modes: MEETING },
  { id: 'standard', label: 'Standard to write', detail: 'STANDARD: …', group: 'Arch', modes: MEETING },
  { id: 'done', label: 'Mark an item done', detail: 'DONE #7', group: 'Arch', modes: MEETING },
  { id: 'update', label: 'Add a note to an item', detail: 'UPDATE #7: …', group: 'Arch', modes: MEETING },
  { id: 'push', label: 'Push a follow-up', detail: 'PUSH #7 due:fri', group: 'Arch', modes: MEETING },
  { id: 'drop', label: 'Drop an item', detail: 'DROP #7', group: 'Arch', modes: MEETING },
  { id: 'adopted', label: 'Team adopted a standard', detail: 'ADOPTED #14', group: 'Arch', modes: MEETING },
  { id: 'due', label: 'Due date', detail: 'due:fri', group: 'Arch', modes: MEETING },
  { id: 'must', label: 'MUST rule', detail: 'Teams **MUST** …', group: 'Standard', modes: ['standard'] },
  { id: 'should', label: 'SHOULD rule', detail: 'Teams **SHOULD** …', group: 'Standard', modes: ['standard'] },
  { id: 'may', label: 'MAY rule', detail: 'Teams **MAY** …', group: 'Standard', modes: ['standard'] },
  { id: 'example', label: 'Do / don’t example', detail: 'Two code blocks', group: 'Standard', modes: ['standard'] },
  { id: 'issue', label: 'Link an item or decision', detail: '#123', group: 'Links' },
  { id: 'linkStandard', label: 'Link a standard', detail: 'Wiki page', group: 'Links', modes: ['description', 'comment', 'standard'] },
  { id: 'mention', label: 'Mention someone', detail: '@username', group: 'Links' },
  { id: 'h2', label: 'Heading', detail: 'Section heading', group: 'Text' }, { id: 'h3', label: 'Small heading', detail: 'Sub-section', group: 'Text' },
  { id: 'ul', label: 'Bulleted list', detail: 'Simple list', group: 'Text' }, { id: 'ol', label: 'Numbered list', detail: 'Ordered steps', group: 'Text' },
  { id: 'task', label: 'Task list', detail: 'Checkboxes', group: 'Text' }, { id: 'quote', label: 'Quote', detail: 'Quoted text', group: 'Text' },
  { id: 'codeblock', label: 'Code block', detail: 'Fenced code', group: 'Blocks' }, { id: 'table3', label: 'Table', detail: '3 columns, 2 rows', group: 'Blocks' },
  { id: 'hr', label: 'Divider', detail: 'Horizontal rule', group: 'Blocks' }, { id: 'details', label: 'Collapsible section', detail: 'Hidden until expanded', group: 'Blocks' },
  { id: 'note', label: 'Note', detail: 'Blue callout', group: 'Blocks' }, { id: 'warning', label: 'Warning', detail: 'Amber callout', group: 'Blocks' },
  { id: 'tip', label: 'Tip', detail: 'Green callout', group: 'Blocks' }, { id: 'caution', label: 'Caution', detail: 'Red callout', group: 'Blocks' },
  { id: 'mermaid', label: 'Flowchart', detail: 'Mermaid diagram (rendered by GitLab)', group: 'Blocks', modes: ['description', 'standard'] },
  { id: 'date', label: "Today's date", detail: 'YYYY-MM-DD', group: 'Text' },
];
export const slashFor = (mode: EditorMode) => SLASH.filter((s) => !s.modes || s.modes.includes(mode));

/** Date tokens offered after "due:", resolved against today. */
export function dueTokens(today: string): { token: string; label: string; date: string }[] {
  const list: [string, string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['fri', 'Friday'], ['mon', 'Monday'], ['+3d', 'In 3 days'], ['1w', 'In a week'], ['2w', 'In two weeks'], ['eow', 'End of week'], ['nw', 'Next week (Monday)'], ['eom', 'End of month']];
  return list.map(([token, label]) => ({ token, label, date: resolveDate(token, today) ?? addDays(today, 7) }));
}

const inCode = (ctx: CompletionContext) => {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(ctx.state).resolveInner(ctx.pos, -1); n; n = n.parent) {
    if (/^(FencedCode|CodeBlock|InlineCode|CodeText)$/.test(n.name)) return true;
  }
  return false;
};
const replace = (view: EditorView, from: number, to: number, text: string) =>
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: 'input.complete' });

const OPEN = { name: 'Open', rank: 0 }, CLOSED = { name: 'Closed', rank: 1 };
const ATTENDEES = { name: 'In the room', rank: 0 }, PEOPLE = { name: 'People', rank: 1 };
const GROUPS = ['Arch', 'Standard', 'Links', 'Text', 'Blocks'];
const KIND_ICON: Record<string, string> = { action: '☐', decision: '◆', meeting: '☰', adoption: '▤' };

export function archCompletions(data: CompletionData): CompletionSource {
  return async (ctx): Promise<CompletionResult | null> => {
    if (inCode(ctx)) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    let m: RegExpMatchArray | null;

    if ((m = before.match(/(^|\s)\/([\w-]{0,24})$/))) {
      const from = ctx.pos - m[2].length;
      return {
        from,
        validFor: /^[\w-]*$/,
        options: slashFor(data.mode).map((s, k): Completion => ({
          label: s.label, detail: s.detail, type: 'keyword', section: { name: s.group, rank: GROUPS.indexOf(s.group) }, boost: -k / 100,
          apply: (view, _c, f, t) => {
            replace(view, f - 1, t, '');
            if (!data.run?.(s.id, view)) {
              if (s.id === 'linkStandard') { replace(view, view.state.selection.main.head, view.state.selection.main.head, '§'); startCompletion(view); }
              else COMMANDS[s.id](view);
            }
          },
        })),
      };
    }
    if ((m = before.match(/(?:^|\s)(?:due|by|fu):(\S{0,12})$/i))) {
      const q = m[1];
      return {
        from: ctx.pos - q.length,
        validFor: /^\S*$/,
        filter: false,
        options: dueTokens(data.today)
          .filter((d) => !q || d.token.startsWith(q.toLowerCase()) || d.label.toLowerCase().startsWith(q.toLowerCase()))
          .map((d, k) => ({ label: d.token, detail: `${d.label} · ${fromIso(d.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}`, type: 'constant', boost: -k, apply: (view, _c, f, t) => replace(view, f, t, d.token + ' ') })),
      };
    }
    if ((m = before.match(/(^|[\s(])#(\d{0,7}|[A-Za-z][\w-]{0,30})$/))) {
      const q = m[2];
      if (!before.slice(0, before.length - q.length - 1).trim()) return null; // a heading
      const list = data.items();
      return {
        from: ctx.pos - q.length,
        validFor: /^[\w-]*$/,
        options: list.slice(0, 300).map((i) => ({
          label: `${i.iid} ${i.title}`, detail: `${i.kind}${i.open ? '' : ' · closed'}`, type: 'issue', section: i.open ? OPEN : CLOSED,
          info: KIND_ICON[i.kind],
          apply: (view, _c, f, t) => replace(view, f - 1, t, `#${i.iid} `),
        })),
      };
    }
    if (data.mergeRequests && (m = before.match(/(^|[\s(])!(\d{0,7})$/))) {
      const q = m[2];
      return {
        from: ctx.pos - q.length,
        validFor: /^\d*$/,
        options: data.mergeRequests().map((r) => ({ label: `${r.iid} ${r.title}`, type: 'mr', apply: (view, _c, f, t) => replace(view, f - 1, t, `!${r.iid} `) })),
      };
    }
    if (data.standards && (m = before.match(/(^|[\s(])§([^\n]{0,40})$/))) {
      const q = m[2];
      return {
        from: ctx.pos - q.length,
        options: data.standards().map((s) => ({ label: s.title, detail: `v${s.version}`, type: 'text', apply: (view, _c, f, t) => replace(view, f - 1, t, `[${s.title} v${s.version}](${s.url}) `) })),
      };
    }
    if ((m = before.match(/(^|[\s(])@([\w.-]{0,30})$/))) {
      const list = await data.people(m[2]);
      if (ctx.aborted) return null;
      return {
        from: ctx.pos - m[2].length,
        validFor: /^[\w.-]*$/,
        options: list.map((u, k) => ({
          label: u.username, detail: u.hint === 'you' ? `${u.name} · you` : u.name, type: 'variable', boost: -k / 1000, section: u.hint === 'in the room' ? ATTENDEES : PEOPLE,
          apply: (view, _c, f, t) => replace(view, f - 1, t, `@${u.username} `),
        })),
      };
    }
    return null;
  };
}
