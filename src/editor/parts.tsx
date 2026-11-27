/* Shared pieces of the full-screen editors: preferences, toolbar, popovers, side panel, diff, preview, status bar. */
import { forwardRef, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { codeBlock, COMMANDS, insertTable, tableOp, type CommandId } from './commands';
import { collapseDiff, diffStats, lineDiff } from './diff';
import { findAnchor, type Heading } from './markdown';
import type { Check } from './checks';
import type { EditorHandle } from './MarkdownEditor';
import DOMPurify from 'dompurify';

/* ---------- preferences (per browser) ---------- */

export type ViewMode = 'write' | 'split' | 'preview' | 'changes';
export interface EditorPrefs { view: ViewMode; side: boolean; wrap: boolean; lineNumbers: boolean; syncScroll: boolean }
const PREFS_KEY = 'arch.editor-prefs.v1';
const defaults: EditorPrefs = { view: 'split', side: true, wrap: true, lineNumbers: true, syncScroll: true };
let prefs: EditorPrefs = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; } catch { return defaults; }
})();
const listeners = new Set<() => void>();
export const editorPrefs = {
  get: () => prefs,
  set(p: Partial<EditorPrefs>) {
    prefs = { ...prefs, ...p };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useEditorPrefs = () => useSyncExternalStore(editorPrefs.subscribe, editorPrefs.get);

export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/* ---------- small controls ---------- */

export function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" className={value === v ? 'on' : ''} aria-pressed={value === v} onClick={() => onChange(v)} data-view={v}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A menu anchored under a button. Closes on Escape and on a click outside. */
export function Popover({ anchor, onClose, children, wide }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const w = box.current?.offsetWidth ?? 240, h = box.current?.offsetHeight ?? 200;
    const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
    const top = r.bottom + 4 + h > innerHeight - 8 ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    setPos({ left, top });
  }, [anchor]);
  useEffect(() => {
    const down = (e: globalThis.MouseEvent) => { if (!box.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  return (
    <div className={`ed-pop${wide ? ' wide' : ''}`} ref={box} style={pos} role="menu">
      {children}
    </div>
  );
}

export function PopItem({ icon, label, hint, onPick }: { icon?: ReactNode; label: ReactNode; hint?: ReactNode; onPick: () => void }) {
  return (
    <button type="button" className="it" role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={onPick}>
      {icon !== undefined && <span className="ic">{icon}</span>}
      <span className="tx">{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  );
}

function TablePicker({ onPick }: { onPick: (cols: number, rows: number) => void }) {
  const [hover, setHover] = useState<[number, number]>([3, 2]);
  return (
    <div className="tpick">
      <div className="hd">Insert a table · {hover[0]} × {hover[1]}</div>
      <div className="tgrid" onMouseLeave={() => setHover([3, 2])}>
        {Array.from({ length: 6 }, (_, r) =>
          Array.from({ length: 6 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              type="button"
              className={c < hover[0] && r < hover[1] ? 'on' : ''}
              onMouseEnter={() => setHover([c + 1, r + 1])}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(c + 1, r + 1)}
              aria-label={`${c + 1} columns, ${r + 1} rows`}
            />
          )),
        )}
      </div>
    </div>
  );
}

/* ---------- toolbar ---------- */

export interface MenuDef { key: string; label: ReactNode; title: string; render: (close: () => void) => ReactNode; wide?: boolean }

export function ToolButton({ label, title, onClick, pressed, id }: { label: ReactNode; title: string; onClick: () => void; pressed?: boolean; id?: string }) {
  return (
    <button type="button" className="tb" id={id} title={title} aria-label={title} aria-pressed={pressed} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {label}
    </button>
  );
}

export function MenuButton({ menu, open, setOpen }: { menu: MenuDef; open: string | null; setOpen: (k: string | null) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="tb"
        data-menu={menu.key}
        title={menu.title}
        aria-label={menu.title}
        aria-expanded={open === menu.key}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { setAnchor(e.currentTarget); setOpen(open === menu.key ? null : menu.key); }}
      >
        {menu.label}
        <span className="caret">▾</span>
      </button>
      {open === menu.key && anchor && (
        <Popover anchor={anchor} onClose={() => setOpen(null)} wide={menu.wide}>
          {menu.render(() => setOpen(null))}
        </Popover>
      )}
    </>
  );
}

const INSERT: { id: CommandId; label: string; hint: string; icon: string }[] = [
  { id: 'note', label: 'Note', hint: 'Blue callout', icon: 'ⓘ' }, { id: 'warning', label: 'Warning', hint: 'Amber callout', icon: '⚠' },
  { id: 'tip', label: 'Tip', hint: 'Green callout', icon: '✦' }, { id: 'caution', label: 'Caution', hint: 'Red callout', icon: '⛔' },
  { id: 'details', label: 'Collapsible section', hint: 'Hidden until expanded', icon: '▸' }, { id: 'mermaid', label: 'Flowchart', hint: 'Mermaid, rendered by GitLab', icon: '⇄' },
  { id: 'footnote', label: 'Footnote', hint: 'Numbered note at the end', icon: '¹' }, { id: 'toc', label: 'Table of contents', hint: 'From the headings', icon: '☰' },
  { id: 'date', label: "Today's date", hint: 'YYYY-MM-DD', icon: '📅' }, { id: 'kbd', label: 'Keyboard key', hint: '<kbd>', icon: '⌨' },
];
const CODE_LANGS = ['plaintext', 'bash', 'json', 'yaml', 'typescript', 'java', 'python', 'sql', 'xml', 'dockerfile', 'hcl'];

/**
 * The formatting toolbar shared by every editor. `extra` adds groups (Arch lines, standard rules)
 * after the formatting ones; `right` goes at the end of the bar.
 */
export function FormatTools({
  editor, compact, extra, right, extraInsert,
}: {
  editor: RefObject<EditorHandle>;
  compact?: boolean;
  extra?: (menu: { open: string | null; setOpen: (k: string | null) => void }) => ReactNode;
  right?: ReactNode;
  extraInsert?: { id: CommandId; label: string; hint: string; icon: string }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const v = () => editor.current?.view() ?? null;
  const cmd = (id: CommandId) => { const view = v(); if (view) { COMMANDS[id](view); view.focus(); } };
  const tb = (id: CommandId, label: ReactNode, title: string) => <ToolButton key={id} label={label} title={title} onClick={() => cmd(id)} />;
  const heading: MenuDef = {
    key: 'heading', label: <b>H</b>, title: 'Heading',
    render: (close) => [0, 1, 2, 3, 4].map((n) => (
      <PopItem key={n} icon={n ? `H${n}` : '¶'} label={n ? <span style={{ fontWeight: 700, fontSize: 17 - n }}>Heading {n}</span> : 'Paragraph'} hint={`${MOD}+Alt+${n}`} onPick={() => { close(); cmd(`h${n}` as CommandId); }} />
    )),
  };
  const table: MenuDef = {
    key: 'table', label: '▦', title: 'Table',
    render: (close) => (
      <>
        <TablePicker onPick={(c, r) => { close(); const view = v(); if (view) insertTable(view, c, r); }} />
        <div className="hd">At the cursor</div>
        {([['rowBelow', 'Insert row below'], ['rowAbove', 'Insert row above'], ['colRight', 'Insert column right'], ['delRow', 'Delete row'], ['delCol', 'Delete column'], ['format', 'Tidy the table']] as const).map(([op, l]) => (
          <PopItem key={op} label={l} onPick={() => { close(); const view = v(); if (view) { const err = tableOp(view, op); if (err) alertInline(err); } }} />
        ))}
      </>
    ),
  };
  const code: MenuDef = {
    key: 'code', label: '{ }', title: 'Code block',
    render: (close) => <><div className="hd">Language</div>{CODE_LANGS.map((l) => <PopItem key={l} label={l} onPick={() => { close(); const view = v(); if (view) codeBlock(view, l === 'plaintext' ? '' : l); }} />)}</>,
  };
  const insert: MenuDef = {
    key: 'insert', label: <>+ Insert</>, title: 'Insert callouts, sections and more', wide: true,
    render: (close) => [...(extraInsert ?? []), ...INSERT].map((s) => <PopItem key={s.id} icon={s.icon} label={s.label} hint={s.hint} onPick={() => { close(); cmd(s.id); }} />),
  };
  const find = () => { const view = v(); if (!view) return; if (searchPanelOpen(view.state)) closeSearchPanel(view); else openSearchPanel(view); };
  return (
    <div className={`ed-tools${compact ? ' compact' : ''}`} role="toolbar" aria-label="Formatting">
      {!compact && <div className="tgrp">{tb('undo', '↶', `Undo (${MOD}+Z)`)}{tb('redo', '↷', `Redo (${MOD}+Shift+Z)`)}</div>}
      <div className="tgrp">
        <MenuButton menu={heading} open={open} setOpen={setOpen} />
        {tb('bold', <b>B</b>, `Bold (${MOD}+B)`)}
        {tb('italic', <i style={{ fontFamily: 'Georgia, serif' }}>I</i>, `Italic (${MOD}+I)`)}
        {!compact && tb('strike', <s>S</s>, `Strikethrough (${MOD}+Shift+X)`)}
        {tb('code', <span className="mono">&lt;/&gt;</span>, `Inline code (${MOD}+E)`)}
      </div>
      <div className="tgrp">
        {tb('ul', '•≡', `Bulleted list (${MOD}+Shift+8)`)}
        {tb('ol', '1.≡', `Numbered list (${MOD}+Shift+7)`)}
        {tb('task', '☐≡', `Task list (${MOD}+Shift+9)`)}
        {!compact && tb('quote', '❝', `Quote (${MOD}+Shift+.)`)}
      </div>
      <div className="tgrp">
        {tb('link', 'Link', `Link (${MOD}+K)`)}
        <MenuButton menu={table} open={open} setOpen={setOpen} />
        {!compact && <MenuButton menu={code} open={open} setOpen={setOpen} />}
        <MenuButton menu={insert} open={open} setOpen={setOpen} />
      </div>
      {extra?.({ open, setOpen })}
      <span className="tspacer" />
      {!compact && <div className="tgrp"><ToolButton label="Find" title={`Find and replace (${MOD}+F)`} onClick={find} /></div>}
      {right}
    </div>
  );
}

function alertInline(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast err';
  el.textContent = msg;
  (document.querySelector('.toasts') ?? document.body).appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

/* ---------- side panel ---------- */

export function SideTabs<T extends string>({ tab, setTab, tabs }: { tab: T; setTab: (t: T) => void; tabs: [T, ReactNode][] }) {
  return (
    <div className="ed-side-tabs" role="tablist">
      {tabs.map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-tab={k}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function OutlineList({ headings, cursorLine, goLine }: { headings: Heading[]; cursorLine: number; goLine: (line: number, id?: string) => void }) {
  if (!headings.length) return <p className="ed-side-empty">Headings appear here. Start a line with ## to add one.</p>;
  let current = -1;
  headings.forEach((h, k) => { if (h.line <= cursorLine) current = k; });
  const min = Math.min(...headings.map((h) => h.level));
  return (
    <div>
      {headings.map((h, k) => (
        <button key={k} type="button" className={`ol-item${k === current ? ' on' : ''}`} style={{ paddingLeft: 14 + (h.level - min) * 14 }} onClick={() => goLine(h.line, h.id)}>
          {h.text || '(empty heading)'}
        </button>
      ))}
    </div>
  );
}

export function ChecksList({ checks, goLine, empty = 'No problems found.' }: { checks: Check[]; goLine: (line: number) => void; empty?: string }) {
  if (!checks.length) return <p className="ed-side-empty ok">✓ {empty}</p>;
  return (
    <div>
      {checks.map((c, k) => (
        <button key={k} type="button" className="lint-item" onClick={() => goLine(c.line)}>
          <span className={`lint-dot ${c.severity}`} />
          <span>{c.message}</span>
          <small>Line {c.line + 1}</small>
        </button>
      ))}
    </div>
  );
}

export function KeysList({ extra = [] }: { extra?: [string, string][] }) {
  const keys: [string, string][] = [
    ...extra,
    [`${MOD}+S`, 'Save'], [`${MOD}+Alt+P`, 'Toggle preview'], ['/', 'Insert menu'], ['@', 'Mention someone'], ['#', 'Link an item'],
    [`${MOD}+B / I / E`, 'Bold, italic, code'], [`${MOD}+K`, 'Link'], [`${MOD}+Shift+8 / 7 / 9`, 'Bullets, numbers, tasks'],
    ['Tab / Shift+Tab', 'Indent, or next table cell'], [`${MOD}+F`, 'Find'], [`${MOD}+Shift+D`, 'Duplicate line'], [`${MOD}+Z`, 'Undo'],
  ];
  return (
    <ul className="keys">
      {keys.map(([k, l]) => (
        <li key={k}><span>{l}</span><kbd>{k}</kbd></li>
      ))}
    </ul>
  );
}

/* ---------- diff ---------- */

export function DiffView({ base, current, title, empty, extra }: { base: string; current: string; title: ReactNode; empty?: string; extra?: ReactNode }) {
  const lines = lineDiff(base, current);
  const { added, removed } = diffStats(lines);
  return (
    <div className="ed-diff" id="ed-diff">
      <div className="diff-h">
        <h3>{title}</h3>
        <span className="diff-add">+{added}</span>
        <span className="diff-del">−{removed}</span>
        {extra}
      </div>
      {!added && !removed ? (
        <p className="muted">{empty ?? 'No changes yet.'}</p>
      ) : (
        <div className="diff">
          {collapseDiff(lines).map((l, k) =>
            l.t === 'gap' ? (
              <div key={k} className="gap">{l.count} unchanged line{l.count === 1 ? '' : 's'}</div>
            ) : (
              <div key={k} className={l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}>
                <span>{l.a !== undefined ? l.a + 1 : ''}</span>
                <span>{l.b !== undefined ? l.b + 1 : ''}</span>
                <span>{l.t === ' ' ? '' : l.t === '-' ? '−' : '+'}</span>
                <code>{l.text || ' '}</code>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- rendered markdown ---------- */

interface ViewProps {
  html: string;
  /** Called with the 0-based source line when a task checkbox is clicked. */
  onTask?: (line: number, checked: boolean, input: HTMLInputElement) => void;
  /** Called when a #123 reference to a known item is clicked. */
  onRef?: (iid: number) => void;
  className?: string;
  id?: string;
}

export const MarkdownView = forwardRef<HTMLDivElement, ViewProps>(function MarkdownView({ html, onTask, onRef, className = '', id }, outer) {
  const inner = useRef<HTMLDivElement | null>(null);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const cp = target.closest('[data-copy]');
    if (cp) { navigator.clipboard?.writeText(cp.closest('.code')?.querySelector('pre')?.innerText || '').catch(() => undefined); cp.textContent = 'Copied'; return; }
    if (target instanceof HTMLInputElement && target.classList.contains('task')) {
      if (onTask) onTask(Number(target.dataset.srcLine), target.checked, target);
      else e.preventDefault();
      return;
    }
    const card = target.closest<HTMLElement>('[data-iid]');
    if (card && !target.closest('a[href^="http"]')) {
      e.preventDefault();
      onRef?.(Number(card.dataset.iid));
      return;
    }
    const a = target.closest('a');
    if (!a) return;
    if (a.dataset.anchor != null) {
      e.preventDefault();
      if (inner.current) findAnchor(inner.current, a.dataset.anchor)?.scrollIntoView({ block: 'start' });
      return;
    }
    if ((a.getAttribute('href') || '').startsWith('#')) e.preventDefault();
  };
  return (
    <div
      id={id}
      className={`md ${className}`}
      ref={(el) => { inner.current = el; if (typeof outer === 'function') outer(el); else if (outer) outer.current = el; }}
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: sanitize(html) }}
    />
  );
});

/**
 * Second line of defence: mdRender already escapes everything and only emits known markup, but the
 * page holds a GitLab token, so the HTML also goes through DOMPurify before it reaches the DOM.
 */
const sanitize = (html: string) =>
  DOMPurify.sanitize(html, { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'textarea', 'select', 'iframe'], FORBID_ATTR: ['onerror', 'onload'] });

/* ---------- scroll the preview with the source, and back (from GitLab Everything's editor) ---------- */

export function useScrollSync(editor: RefObject<EditorHandle>, preview: RefObject<HTMLDivElement>, active: boolean) {
  const lock = useRef({ editor: 0, preview: 0 });
  useEffect(() => {
    const v = editor.current?.view(), pv = preview.current;
    if (!active || !v || !pv) return;
    const blocks = () => [...pv.querySelectorAll<HTMLElement>('[data-line]')].filter((el) => !el.parentElement?.closest('[data-line]'));
    const yOf = (ln: number) => v.lineBlockAt(v.state.doc.line(Math.min(ln + 1, v.state.doc.lines)).from).top;
    const fromEditor = () => requestAnimationFrame(() => {
      if (!editorPrefs.get().syncScroll || Date.now() < lock.current.editor) return;
      const top = v.scrollDOM.scrollTop;
      lock.current.preview = Date.now() + 150;
      if (top <= 2) { pv.scrollTop = 0; return; }
      const els = blocks();
      if (!els.length) return;
      const line = v.state.doc.lineAt(v.lineBlockAtHeight(top).from).number - 1;
      let a: HTMLElement | null = null, b: HTMLElement | null = null;
      for (const el of els) { if (Number(el.dataset.line) <= line) a = el; else { b = el; break; } }
      const aY = yOf(a ? Number(a.dataset.line) : 0), bY = b ? yOf(Number(b.dataset.line)) : v.contentHeight;
      const aTop = a ? a.offsetTop : 0, bTop = b ? b.offsetTop : pv.scrollHeight;
      const frac = bY > aY ? Math.min(1, Math.max(0, (top - aY) / (bY - aY))) : 0;
      pv.scrollTop = aTop + frac * (bTop - aTop) - 16;
    });
    const fromPreview = () => requestAnimationFrame(() => {
      if (!editorPrefs.get().syncScroll || Date.now() < lock.current.preview) return;
      const els = blocks();
      if (!els.length) return;
      const top = pv.scrollTop + 16;
      let a: HTMLElement | null = null, b: HTMLElement | null = null;
      for (const el of els) { if (el.offsetTop <= top) a = el; else { b = el; break; } }
      const aY = yOf(a ? Number(a.dataset.line) : 0), bY = b ? yOf(Number(b.dataset.line)) : v.contentHeight;
      const aTop = a ? a.offsetTop : 0, bTop = b ? b.offsetTop : pv.scrollHeight;
      const frac = bTop > aTop ? Math.min(1, Math.max(0, (top - aTop) / (bTop - aTop))) : 0;
      lock.current.editor = Date.now() + 150;
      v.scrollDOM.scrollTop = aY + frac * (bY - aY);
    });
    v.scrollDOM.addEventListener('scroll', fromEditor);
    pv.addEventListener('scroll', fromPreview);
    return () => { v.scrollDOM.removeEventListener('scroll', fromEditor); pv.removeEventListener('scroll', fromPreview); };
  }, [editor, preview, active]);
}

/** Moves the cursor to a line and scrolls it into view (Outline and Checks tabs). */
export function goToLine(editor: EditorHandle | null, line: number) {
  const v = editor?.view();
  if (!v) return;
  const pos = v.state.doc.line(Math.min(line + 1, v.state.doc.lines)).from;
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  v.focus();
}

/** Toggles the task checkbox on a source line, in the editor (preview ticks while editing). */
export function toggleTaskInView(v: EditorView | null | undefined, line: number) {
  if (!v) return;
  const l = v.state.doc.line(line + 1);
  const next = l.text.replace(/\[( |x|X)\]/, (_m, ch) => (ch === ' ' ? '[x]' : '[ ]'));
  if (next !== l.text) v.dispatch({ changes: { from: l.from, to: l.to, insert: next } });
}

/** Ctrl/Cmd+S anywhere on a full-screen editor (not only inside the text). */
export function useSaveShortcut(fn: () => void, active = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!(e.target as HTMLElement)?.closest?.('.cm-editor')) ref.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}

/* ---------- banner and status ---------- */

export interface BannerState { tone: 'warn' | 'err' | 'info'; text: ReactNode; actions?: { label: string; run: () => void; danger?: boolean; primary?: boolean }[] }

export function Banner({ b }: { b: BannerState | null }) {
  if (!b) return null;
  return (
    <div className={`ed-banner ${b.tone}`} id="ed-banner" role={b.tone === 'err' ? 'alert' : 'status'}>
      <span>{b.text}</span>
      {b.actions && (
        <span className="acts">
          {b.actions.map((a) => (
            <button key={a.label} type="button" className={`sm ${a.danger ? 'danger' : a.primary ? 'primary' : 'ghost'}`} onClick={a.run}>
              {a.label}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

export const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
