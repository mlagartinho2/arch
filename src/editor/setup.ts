/* CodeMirror 6 configuration, ported from GitLab Everything's wiki editor (src/wiki/editor/setup.ts), with Arch's keyword highlighting. */
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, completionStatus, type CompletionSource } from '@codemirror/autocomplete';
import { copyLineDown, defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, linter, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import {
  Decoration, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, placeholder, ViewPlugin,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { resolveDate } from '../lib/dates';
import type { Check } from './checks';
import { COMMANDS, indentList, isListLine, tableStep, type CommandId } from './commands';

export const wrapCompartment = new Compartment();
export const numbersCompartment = new Compartment();

const theme = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'var(--panel)', color: 'var(--ink)', fontSize: '13.5px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7' },
  '.cm-content': { padding: '14px 0 30vh', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0 18px 0 12px' },
  '.cm-gutters': { backgroundColor: 'var(--panel)', borderRight: '1px solid var(--line)', color: 'var(--ink-3)' },
  '.cm-lineNumbers .cm-gutterElement': { fontSize: '11.5px', padding: '0 6px 0 8px', minWidth: '24px' },
  '.cm-activeLine': { backgroundColor: 'var(--sunken)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--sunken)', color: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--accent)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--sel) !important' },
  '.cm-selectionMatch': { backgroundColor: 'var(--hit)' },
  '.cm-searchMatch': { backgroundColor: 'var(--hit)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { outline: '2px solid var(--accent)', backgroundColor: 'var(--hit)' },
  '&.cm-focused .cm-matchingBracket': { color: 'var(--ok)', fontWeight: '700', backgroundColor: 'transparent' },
  '.cm-placeholder': { color: 'var(--ink-3)', whiteSpace: 'pre-wrap' },
  '.cm-panels': { backgroundColor: 'var(--sunken)', color: 'var(--ink)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--line)' },
  '.cm-search': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', padding: '8px 10px', fontFamily: 'inherit', fontSize: '12.5px' },
  '.cm-search br': { flexBasis: '100%', height: '0' },
  '.cm-textfield': { border: '1px solid var(--line-strong)', backgroundColor: 'var(--panel)', color: 'var(--ink)', borderRadius: '6px', padding: '5px 8px', fontFamily: 'var(--mono)', fontSize: '12.5px', margin: '0', width: 'auto' },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--panel)', border: '1px solid var(--line-strong)', borderRadius: '6px', padding: '4px 9px', color: 'var(--ink)', fontSize: '12px', margin: '0', cursor: 'pointer' },
  '.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--ink-2)', fontSize: '12px' },
  '.cm-search input[type=checkbox]': { width: 'auto' },
  '.cm-search button[name=close]': { position: 'static', marginLeft: 'auto', color: 'var(--ink-2)', fontSize: '18px', cursor: 'pointer' },
  '.cm-gutter-lint': { width: '14px' },
  '.cm-lint-marker': { width: '8px', height: '8px', borderRadius: '50%', margin: '7px 0 0 3px', content: 'none' },
  '.cm-lint-marker-error': { backgroundColor: 'var(--err)' },
  '.cm-lint-marker-warning': { backgroundColor: 'var(--warn)' },
  '.cm-lint-marker-info': { backgroundColor: 'var(--info)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--err) 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn) 1px', textUnderlineOffset: '3px' },
  '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted var(--info) 1px', textUnderlineOffset: '3px' },
  '.cm-tooltip': { backgroundColor: 'var(--panel)', border: '1px solid var(--line)', borderRadius: '9px', boxShadow: 'var(--shadow)', color: 'var(--ink)', overflow: 'hidden' },
  '.cm-diagnostic': { padding: '6px 10px', borderLeft: '3px solid var(--info)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px' },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--err)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warn)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': { fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13.5px', maxHeight: '320px', minWidth: '300px', maxWidth: '520px', padding: '4px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '6px 9px', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '10px' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--sunken)', color: 'var(--ink)' },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > completion-section': { display: 'block', padding: '6px 9px 3px', fontSize: '10.5px', fontWeight: '700', letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-3)', borderBottom: '0' },
  '.cm-completionLabel': { flex: '1', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-completionDetail': { fontFamily: 'var(--mono)', fontSize: '11.5px', color: 'var(--ink-3)', fontStyle: 'normal', marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%' },
  '.cm-completionMatchedText': { textDecoration: 'none', fontWeight: '700', color: 'var(--accent)' },
  '.cm-completionIcon': { display: 'none' },
  '.cm-completionInfo': { display: 'none' },
  /* Arch keywords */
  '.cm-arch-kw': { fontWeight: '700', borderRadius: '3px', padding: '0 2px' },
  '.cm-arch-action': { color: 'var(--action)', backgroundColor: 'color-mix(in srgb, var(--action) 12%, transparent)' },
  '.cm-arch-decision': { color: 'var(--decision)', backgroundColor: 'color-mix(in srgb, var(--decision) 12%, transparent)' },
  '.cm-arch-standard': { color: 'var(--standard)', backgroundColor: 'color-mix(in srgb, var(--standard) 12%, transparent)' },
  '.cm-arch-update': { color: 'var(--meeting)', backgroundColor: 'color-mix(in srgb, var(--meeting) 12%, transparent)' },
  '.cm-arch-mention': { color: 'var(--accent)' },
  '.cm-arch-mention-bad': { color: 'var(--err)', textDecoration: 'underline wavy var(--err) 1px', textUnderlineOffset: '3px' },
  '.cm-arch-ref': { color: 'var(--meeting)' },
  '.cm-arch-ref-closed': { color: 'var(--ink-3)', textDecoration: 'line-through' },
  '.cm-arch-ref-missing': { color: 'var(--err)' },
  '.cm-arch-due': { color: 'var(--warn)', fontWeight: '600' },
  '.cm-arch-due-bad': { color: 'var(--err)', textDecoration: 'underline wavy var(--err) 1px' },
  '.cm-arch-detail': { color: 'var(--ink-2)' },
});

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.22em' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.12em' },
  { tag: t.heading3, fontWeight: '700', fontSize: '1.04em' },
  { tag: t.heading, fontWeight: '700', color: 'var(--ink)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--info)' },
  { tag: t.url, color: 'var(--ink-3)' },
  { tag: t.processingInstruction, color: 'var(--accent)', fontWeight: '500' },
  { tag: t.monospace, color: 'var(--j-str)' },
  { tag: t.quote, color: 'var(--ink-2)', fontStyle: 'italic' },
  { tag: t.contentSeparator, color: 'var(--ink-3)' },
  { tag: t.keyword, color: 'var(--j-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--j-str)' },
  { tag: [t.number, t.integer, t.float], color: 'var(--j-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--j-com)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--ink-2)' },
  { tag: t.invalid, color: 'var(--err)' },
]);

/* ---- Arch keyword highlighting ---- */

/** What the highlighter knows about people, items and dates. Read on every redraw. */
export interface ArchKnowledge {
  today: string;
  unknownUser: (username: string) => boolean;
  item: (iid: number) => { open: boolean; kind?: string } | undefined;
  /** Highlight ACTION/DECISION/… keywords (meeting notes only) */
  keywords: boolean;
}
export const refreshDecorations = StateEffect.define<null>();

const KW_RE = /^(\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]\]\s+)?)(ACTION|TODO|AI|ask|Ask|DECISION|DECIDED|STANDARD|STD|DONE|CLOSED|UPDATE|NOTE|PUSH|MOVE|SNOOZE|DROP|DROPPED|ADOPTED)\b/;
const KW_CLASS: Record<string, string> = {
  ACTION: 'action', TODO: 'action', AI: 'action', ASK: 'action', DECISION: 'decision', DECIDED: 'decision', STANDARD: 'standard', STD: 'standard',
};

function archDecorations(know: () => ArchKnowledge | null) {
  const mk = (cls: string) => Decoration.mark({ class: cls });
  const build = (view: EditorView): DecorationSet => {
    const k = know();
    const b = new RangeSetBuilder<Decoration>();
    if (!k) return b.finish();
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const text = line.text;
        const marks: [number, number, string][] = [];
        if (k.keywords) {
          const m = text.match(KW_RE);
          if (m && (m[2] === m[2].toUpperCase() || /^\s*:?\s*[@:]/.test(text.slice(m[0].length)))) {
            marks.push([m[1].length, m[1].length + m[2].length, `cm-arch-kw cm-arch-${KW_CLASS[m[2].toUpperCase()] ?? 'update'}`]);
          }
        }
        for (const m of text.matchAll(/(^|[\s(])@([\w][\w.-]*[\w]|[\w])/g)) {
          const s = m.index! + m[1].length;
          marks.push([s, s + 1 + m[2].length, k.unknownUser(m[2].toLowerCase()) ? 'cm-arch-mention-bad' : 'cm-arch-mention']);
        }
        for (const m of text.matchAll(/(^|[\s([])#(\d+)\b/g)) {
          const s = m.index! + m[1].length;
          const it = k.item(Number(m[2]));
          marks.push([s, s + 1 + m[2].length, it ? (it.open || it.kind === 'decision' || it.kind === 'meeting' ? 'cm-arch-ref' : 'cm-arch-ref cm-arch-ref-closed') : 'cm-arch-ref-missing']);
        }
        for (const m of text.matchAll(/(^|\s)((?:due|by|fu):\s*(\S+))/gi)) {
          const s = m.index! + m[1].length;
          marks.push([s, s + m[2].length, resolveDate(m[3], k.today) ? 'cm-arch-due' : 'cm-arch-due-bad']);
        }
        marks.sort((a, c) => a[0] - c[0]);
        let last = -1;
        for (const [s, e, cls] of marks) {
          if (s < last) continue;
          b.add(line.from + s, line.from + e, mk(cls));
          last = e;
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = build(view); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDecorations)))) this.decorations = build(u.view);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export interface EditorHooks {
  save: () => void;
  togglePreview?: () => void;
  onDocChange: () => void;
  onSelection: () => void;
  checks?: (doc: string) => Check[];
  /** Ctrl/Cmd+Enter (comment composer) */
  submit?: () => void;
}

export interface EditorOptions {
  hooks: () => EditorHooks;
  completions: CompletionSource;
  wrap: boolean;
  lineNumbers: boolean;
  placeholder: string;
  label: string;
  knowledge?: () => ArchKnowledge | null;
  compact?: boolean;
}

export function editorExtensions(opts: EditorOptions): Extension[] {
  const run = (id: CommandId) => (v: EditorView) => { COMMANDS[id](v); return true; };
  const keys = [
    { key: 'Mod-b', run: run('bold') }, { key: 'Mod-i', run: run('italic') }, { key: 'Mod-Shift-x', run: run('strike') }, { key: 'Mod-e', run: run('code') },
    { key: 'Mod-k', run: run('link') }, { key: 'Mod-Shift-8', run: run('ul') }, { key: 'Mod-Shift-7', run: run('ol') }, { key: 'Mod-Shift-9', run: run('task') },
    { key: 'Mod-Shift-.', run: run('quote') }, { key: 'Mod-Alt-0', run: run('h0') },
    ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({ key: `Mod-Alt-${n}`, run: run(`h${n}` as CommandId) })),
    { key: 'Mod-s', run: () => { opts.hooks().save(); return true; }, preventDefault: true },
    { key: 'Mod-Enter', run: () => { const h = opts.hooks(); if (h.submit) h.submit(); else h.save(); return true; }, preventDefault: true },
    { key: 'Mod-Alt-p', run: () => { opts.hooks().togglePreview?.(); return true; } },
    { key: 'Mod-Shift-d', run: copyLineDown },
    { key: 'Mod-h', run: openSearchPanel },
    {
      key: 'Tab',
      run: (v: EditorView) => {
        if (completionStatus(v.state) === 'active') return acceptCompletion(v);
        if (tableStep(v, 1)) return true;
        if (isListLine(v) || !v.state.selection.main.empty) { indentList(v, 1); return true; }
        v.dispatch(v.state.replaceSelection('  '));
        return true;
      },
      shift: (v: EditorView) => { if (tableStep(v, -1)) return true; indentList(v, -1); return true; },
    },
  ];
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    search({ top: true }),
    markdown({ base: markdownLanguage }),
    syntaxHighlighting(highlight),
    autocompletion({ override: [opts.completions], icons: false, closeOnBlur: true }),
    ...(opts.compact ? [] : [
      linter((view) => (opts.hooks().checks?.(view.state.doc.toString()) ?? []).map((c): Diagnostic => {
        const line = view.state.doc.line(Math.min(c.line + 1, view.state.doc.lines));
        return { from: line.from, to: line.to, severity: c.severity, message: c.message };
      }), { delay: 400, needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDecorations))) }),
      lintGutter(),
    ]),
    numbersCompartment.of(opts.lineNumbers ? lineNumbers() : []),
    wrapCompartment.of(opts.wrap ? EditorView.lineWrapping : []),
    placeholder(opts.placeholder),
    EditorView.contentAttributes.of({ spellcheck: 'true', 'aria-label': opts.label }),
    Prec.high(keymap.of(keys)),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap]),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) opts.hooks().onDocChange();
      if (u.docChanged || u.selectionSet) opts.hooks().onSelection();
    }),
    ...(opts.knowledge ? [archDecorations(opts.knowledge)] : []),
    theme,
    ...(opts.compact ? [EditorView.theme({ '.cm-content': { padding: '10px 0 12px' }, '&': { fontSize: '13px' } })] : []),
  ];
}
