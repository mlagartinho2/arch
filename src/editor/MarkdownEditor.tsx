/* React wrapper around a CodeMirror 6 view configured by setup.ts. */
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CompletionSource } from '@codemirror/autocomplete';
import { editorExtensions, numbersCompartment, refreshDecorations, wrapCompartment, type ArchKnowledge, type EditorHooks } from './setup';
import { lineNumbers } from '@codemirror/view';

export interface EditorHandle {
  view: () => EditorView | null;
  /** Replaces the whole text (keeps undo history). */
  setText: (text: string) => void;
  focus: () => void;
  /** Re-runs highlighting and checks after what the editor knows (people, items) changed. */
  refresh: () => void;
}

export interface CursorInfo { line: number; col: number; sel: number; cursors: number }

interface Props {
  initial: string;
  onChange: (text: string) => void;
  completions: CompletionSource;
  placeholder: string;
  label: string;
  wrap?: boolean;
  lineNumbers?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  hooks?: Partial<Omit<EditorHooks, 'onDocChange' | 'onSelection'>>;
  onCursor?: (c: CursorInfo) => void;
  knowledge?: ArchKnowledge | null;
  className?: string;
  id?: string;
}

export const MarkdownEditor = forwardRef<EditorHandle, Props>(function MarkdownEditor(p, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(p);
  useLayoutEffect(() => { latest.current = p; });

  useEffect(() => {
    const cursor = () => {
      const v = view.current;
      if (!v || !latest.current.onCursor) return;
      const s = v.state.selection.main;
      const line = v.state.doc.lineAt(s.head);
      latest.current.onCursor({ line: line.number - 1, col: s.head - line.from, sel: Math.abs(s.to - s.from), cursors: v.state.selection.ranges.length });
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: p.initial,
        extensions: editorExtensions({
          hooks: () => ({
            save: () => latest.current.hooks?.save?.(),
            togglePreview: () => latest.current.hooks?.togglePreview?.(),
            submit: latest.current.hooks?.submit ? () => latest.current.hooks?.submit?.() : undefined,
            checks: (doc) => latest.current.hooks?.checks?.(doc) ?? [],
            onDocChange: () => latest.current.onChange(view.current!.state.doc.toString()),
            onSelection: cursor,
          }),
          completions: (ctx) => latest.current.completions(ctx),
          wrap: p.wrap ?? true,
          lineNumbers: p.lineNumbers ?? true,
          placeholder: p.placeholder,
          label: p.label,
          compact: p.compact,
          knowledge: () => latest.current.knowledge ?? null,
        }),
      }),
    });
    view.current = v;
    if (p.autoFocus) v.focus();
    cursor();
    return () => { v.destroy(); view.current = null; };
    // The view is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { view.current?.dispatch({ effects: wrapCompartment.reconfigure(p.wrap ?? true ? EditorView.lineWrapping : []) }); }, [p.wrap]);
  useEffect(() => { view.current?.dispatch({ effects: numbersCompartment.reconfigure(p.lineNumbers ?? true ? lineNumbers() : []) }); }, [p.lineNumbers]);
  useEffect(() => { view.current?.dispatch({ effects: refreshDecorations.of(null) }); }, [p.knowledge]);

  useImperativeHandle(ref, () => ({
    view: () => view.current,
    setText: (text) => { const v = view.current; if (v && v.state.doc.toString() !== text) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } }); },
    focus: () => view.current?.focus(),
    refresh: () => view.current?.dispatch({ effects: refreshDecorations.of(null) }),
  }), []);

  return <div className={`cm-host ${p.className ?? ''}`} id={p.id} ref={host} />;
});
