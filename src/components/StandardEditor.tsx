/* A standard, full screen: the body in the full editor, the change (version, note, status) and details in the side panel. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { categoryLabel } from '../lib/settings';
import { bumpVersion, newStandardDoc, nextVersion, renderStandardFile, slug, standardFilePath, standardTemplate, type StandardStatus } from '../lib/standards';
import type { StandardEntry } from '../lib/standardsService';
import { MarkdownEditor, type CursorInfo, type EditorHandle } from '../editor/MarkdownEditor';
import { checkStandard } from '../editor/checks';
import { countWords, mdRender } from '../editor/markdown';
import { drafts } from '../editor/drafts';
import { COMMANDS, insertSnippet } from '../editor/commands';
import {
  Banner, ChecksList, DiffView, editorPrefs, FormatTools, goToLine, KeysList, MarkdownView, MenuButton, MOD, OutlineList, PopItem, Segmented, SideTabs,
  timeOf, toggleTaskInView, ToolButton, useEditorPrefs, useSaveShortcut, useScrollSync, type BannerState, type ViewMode,
} from '../editor/parts';
import { mentionsIn, useEditorData, useUnknownUsers } from './editorData';
import { useApp } from './ctx';

type Tab = 'change' | 'details' | 'outline' | 'checks' | 'keys';

const SECTIONS: [string, string][] = [
  ['Context', 'Why this standard exists and which problem it solves.'],
  ['The standard', '- Teams **MUST** …'],
  ['Rationale', ''],
  ['Examples', ''],
  ['Exceptions', 'How to ask for an exception, and who decides.'],
  ['How to adopt', '1. …'],
];

interface Meta { title: string; category: string; tags: string; owner: string; status: StandardStatus; kind: 'minor' | 'major'; note: string }

export function StandardEditor({
  entry, presetStatus, newFrom, onDone,
}: {
  entry?: StandardEntry;
  presetStatus?: StandardStatus;
  newFrom?: { title: string; summary: string; fromIid?: number };
  onDone: (id?: string) => void;
}) {
  const { svc, catalog, loadCatalog, run, me, toast, today } = useApp();
  const prefs = useEditorPrefs();
  const m = entry?.doc.meta;
  const dk = `std:${m?.id ?? 'new'}`;
  const saved = drafts.get(dk);
  const startBody = entry?.doc.body ?? standardTemplate(newFrom?.title || 'Title', newFrom?.summary ?? '');
  const [body, setBody] = useState(saved?.content ?? startBody);
  const [meta, setMeta] = useState<Meta>(() => ({
    title: m?.title ?? newFrom?.title ?? '',
    category: m?.category ?? svc.settings.categories[0]?.key ?? 'general',
    tags: m?.tags.join(', ') ?? '',
    owner: m?.owner ?? me,
    status: presetStatus ?? m?.status ?? 'active',
    kind: presetStatus === 'deprecated' ? 'major' : 'minor',
    note: presetStatus === 'deprecated' ? 'Deprecated: ' : '',
    ...((saved?.extra as Partial<Meta>) ?? {}),
  }));
  const [draftAt, setDraftAt] = useState<number | undefined>(saved?.at);
  const [tab, setTab] = useState<Tab>('change');
  const [cursor, setCursor] = useState<CursorInfo>({ line: 0, col: 0, sel: 0, cursors: 1 });
  const [withHeader, setWithHeader] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<BannerState | null>(() =>
    saved && entry && saved.base !== entry.doc.body
      ? { tone: 'warn', text: `Your draft started from an older text of v${m!.version}. Check Changes before opening the merge request.` }
      : null,
  );
  const editor = useRef<EditorHandle>(null);
  const preview = useRef<HTMLDivElement>(null);
  const view: ViewMode = prefs.view;
  const set = <K extends keyof Meta>(k: K, v: Meta[K]) => setMeta((x) => ({ ...x, [k]: v }));

  const unknown = useUnknownUsers([...mentionsIn(body), ...(meta.owner.trim() ? [meta.owner.replace(/^@/, '')] : [])]);
  const mrs = useMemo(() => (catalog.catalog ? [...catalog.catalog.entries.flatMap((e) => e.proposals), ...catalog.catalog.newProposals].map((p) => ({ iid: p.mr.iid, title: p.mr.title })) : []), [catalog.catalog]);
  const { completions, knowledge, byIid } = useEditorData('standard', { unknown, mergeRequests: () => mrs });

  const dirty = body !== startBody || (saved !== undefined);
  useEffect(() => {
    const t = setTimeout(() => {
      const changed = body !== startBody || meta.note.trim() || meta.title !== (m?.title ?? newFrom?.title ?? '');
      if (changed) {
        const at = Date.now();
        drafts.put(dk, { content: body, base: startBody, at, extra: { ...meta } });
        setDraftAt(at);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [body, meta, dk, startBody, m?.title, newFrom?.title]);

  const id = m?.id ?? slug(meta.title);
  const version = m ? bumpVersion(m.version, meta.kind) : '1.0';
  const path = standardFilePath(svc.settings.standardsFolder, meta.category, id || '…');
  const tagList = meta.tags.split(',').map((t) => t.trim()).filter(Boolean);
  const owner = meta.owner.replace(/^@/, '').trim();
  const ownerBad = Boolean(owner && unknown.has(owner.toLowerCase()));
  const exists = !entry && id && catalog.catalog && (catalog.catalog.entries.some((e) => e.doc.meta.id === id) || catalog.catalog.newProposals.some((p) => p.id === id));
  const problems = [
    !meta.title.trim() && 'Give the standard a title',
    !body.trim() && 'Write the standard',
    entry && !meta.note.trim() && 'Describe the change for the changelog',
    entry && body === entry.doc.body && meta.title === m!.title && meta.status === m!.status && meta.category === m!.category && meta.tags === m!.tags.join(', ') && owner === (m!.owner ?? '') && 'Nothing has changed yet',
    exists && `A standard with the id “${id}” already exists or is proposed`,
    ownerBad && `@${owner} is not a GitLab user`,
  ].filter(Boolean) as string[];

  const checks = useMemo(() => checkStandard(body), [body]);
  const errors = checks.filter((c) => c.severity === 'error').length;
  const rendered = useMemo(() => mdRender(body, { tasks: true, item: (i) => byIid.get(i), mrUrl: (n) => mrs.length ? `${catalog.catalog?.project.web_url}/-/merge_requests/${n}` : undefined }), [body, byIid, mrs, catalog.catalog]);
  useScrollSync(editor, preview, view === 'split');

  const fullFiles = useMemo(() => {
    if (!withHeader) return null;
    const metaEdits = { title: meta.title.trim(), category: slug(meta.category), tags: tagList, owner: owner || undefined, status: meta.status };
    if (entry) return { base: renderStandardFile(entry.doc), current: renderStandardFile(nextVersion(entry.doc, { kind: meta.kind, note: meta.note.trim() || '…', date: today }, { body, meta: metaEdits })) };
    return { base: '', current: renderStandardFile(newStandardDoc({ id, title: meta.title, category: slug(meta.category), tags: tagList, owner }, body, today, meta.note.trim() || 'Initial version')) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withHeader, entry, meta, body, today, id, owner]);

  const submit = async () => {
    if (busy) return;
    if (problems.length) {
      setBanner({ tone: 'err', text: problems.join(' · ') });
      if (entry && !meta.note.trim()) { editorPrefs.set({ side: true }); setTab('change'); setTimeout(() => document.getElementById('std-note')?.focus()); }
      return;
    }
    const c = catalog.catalog;
    if (!c) return;
    setBusy(true);
    const mr = await run('', () =>
      entry
        ? svc.std.proposeChange(c, entry, { kind: meta.kind, note: meta.note, body, meta: { title: meta.title.trim(), category: meta.category, tags: tagList, owner, status: meta.status } })
        : svc.std.proposeNew(c, { title: meta.title, category: meta.category, tags: tagList, owner, body, note: meta.note.trim() || undefined }, newFrom?.fromIid),
    );
    setBusy(false);
    if (!mr) return;
    drafts.drop(dk);
    toast(`Merge request !${mr.iid} opened for review`);
    await loadCatalog(true);
    onDone(entry ? entry.doc.meta.id : undefined);
  };
  const cancel = () => {
    if (!dirty) return onDone(entry?.doc.meta.id);
    setBanner({
      tone: 'warn',
      text: 'Discard this draft? It is only kept in this browser.',
      actions: [
        { label: 'Discard draft', danger: true, run: () => { drafts.drop(dk); onDone(entry?.doc.meta.id); } },
        { label: 'Keep the draft and leave', run: () => onDone(entry?.doc.meta.id) },
        { label: 'Keep editing', run: () => setBanner(null) },
      ],
    });
  };
  const latest = useRef({ submit });
  latest.current = { submit };
  useSaveShortcut(() => latest.current.submit());

  const setView = (v: ViewMode) => editorPrefs.set({ view: v });
  const v = () => editor.current?.view() ?? null;
  const goLine = (line: number) => {
    if (view === 'preview' || view === 'changes') setView('split');
    setTimeout(() => goToLine(editor.current, line));
  };
  const other = entry?.proposals ?? [];
  const cats = [...svc.settings.categories];
  if (m && !cats.some((c) => c.key === m.category)) cats.push({ key: m.category, label: m.category });
  const branch = `standard/${id || '…'}-${version.replace('.', '-')}-…`;
  const mrTitle = `Standard: ${meta.title.trim() || '…'} v${version}${entry ? '' : ' (new)'}`;

  return (
    <div className="fs" id="std-editor">
      <header className="fs-bar">
        <button type="button" className="fs-back" onClick={() => onDone(entry?.doc.meta.id)} title="Back to Standards (your draft stays in this browser)">
          ← Standards
        </button>
        <span className="kind kind-standard">{categoryLabel(svc.settings, meta.category)}</span>
        <div className="fs-titlebox">
          <input className="fs-title" id="std-title" value={meta.title} onChange={(e) => set('title', e.target.value)} placeholder="Standard title" aria-label="Standard title" autoFocus={!entry && !meta.title} />
          <span className="fs-sub">
            <span className="ver">{entry ? `v${m!.version} → v${version}` : 'new · v1.0'}</span>
            <code>{path}</code>
          </span>
        </div>
        <Segmented value={view} onChange={setView} label="View" options={[['write', 'Write'], ['split', 'Split'], ['preview', 'Preview'], ['changes', 'Changes']]} />
        <div className="fs-acts">
          <span className={`ed-status-txt${busy ? ' dirty' : ''}`} id="std-status">
            {busy ? 'Opening merge request…' : draftAt ? `Draft saved ${timeOf(draftAt)}` : entry ? `Editing v${m!.version}` : 'New standard'}
          </span>
          <button type="button" className="ghost sm" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="primary sm" id="std-submit" onClick={submit} disabled={busy} title={problems.length ? problems.join('\n') : `Open a merge request (${MOD}+S)`}>
            Open merge request
          </button>
        </div>
      </header>

      <FormatTools
        editor={editor}
        extraInsert={[
          { id: 'must', label: 'MUST rule', hint: 'Teams **MUST** …', icon: '!' },
          { id: 'should', label: 'SHOULD rule', hint: 'Teams **SHOULD** …', icon: '?' },
          { id: 'may', label: 'MAY rule', hint: 'Teams **MAY** …', icon: '~' },
          { id: 'example', label: 'Do / don’t example', hint: 'Two code blocks', icon: '⇆' },
        ]}
        extra={({ open, setOpen }) => (
          <div className="tgrp arch">
            <span className="lbl-t">RULES</span>
            <ToolButton label="+ MUST" title="A rule teams must follow" onClick={() => { const x = v(); if (x) COMMANDS.must(x); }} />
            <ToolButton label="+ SHOULD" title="A recommendation" onClick={() => { const x = v(); if (x) COMMANDS.should(x); }} />
            <ToolButton label="+ Example" title="Do / don’t example" onClick={() => { const x = v(); if (x) COMMANDS.example(x); }} />
            <MenuButton
              open={open}
              setOpen={setOpen}
              menu={{
                key: 'sections',
                label: 'Sections',
                title: 'Insert a standard section',
                wide: true,
                render: (close) => (
                  <>
                    <div className="hd">Insert a section at the cursor</div>
                    {SECTIONS.map(([h, t]) => (
                      <PopItem key={h} icon="§" label={h} hint={body.includes(`## ${h}`) ? 'already there' : ''} onPick={() => { close(); const x = v(); if (x) insertSnippet(x, `## ${h}\n${t ? '⟨' + t + '⟩' : '⟨⟩'}`, true); }} />
                    ))}
                  </>
                ),
              }}
            />
          </div>
        )}
        right={
          <div className="tgrp">
            <ToolButton label="Wrap" title="Wrap long lines" pressed={prefs.wrap} onClick={() => editorPrefs.set({ wrap: !prefs.wrap })} />
            <ToolButton label={<>Panel {errors ? <span className="badge bad">{errors}</span> : null}</>} title="Change, details, outline and checks" pressed={prefs.side} onClick={() => editorPrefs.set({ side: !prefs.side })} />
          </div>
        }
      />

      {banner ? (
        <Banner b={banner} />
      ) : other.length > 0 ? (
        <Banner
          b={{
            tone: 'warn',
            text: (
              <>
                Another change to this standard is in review:{' '}
                {other.map((p) => (
                  <span key={p.mr.iid}>
                    <b>!{p.mr.iid}</b> v{p.version} {p.mr.title.replace(/^Standard:\s*/, '')}{' '}
                  </span>
                ))}
                . Yours starts from v{m!.version} on {catalog.catalog?.project.default_branch ?? 'main'}; whoever merges second will be asked to rebase.
              </>
            ),
            actions: other.map((p) => ({ label: `Open !${p.mr.iid} ↗`, run: () => window.open(p.mr.web_url, '_blank', 'noopener') })),
          }}
        />
      ) : null}

      <div className={`ed-body v-${view}${prefs.side ? ' side' : ''}`}>
        <section className="ed-pane ed-src" aria-label="Standard text">
          <MarkdownEditor
            ref={editor}
            id="std-body"
            initial={body}
            onChange={setBody}
            completions={completions}
            knowledge={knowledge}
            placeholder="Write the standard. Type / for rules, examples and blocks."
            label="Standard in Markdown"
            wrap={prefs.wrap}
            lineNumbers={prefs.lineNumbers}
            autoFocus={Boolean(entry)}
            onCursor={setCursor}
            hooks={{ save: () => latest.current.submit(), togglePreview: () => setView(view === 'preview' ? 'split' : 'preview'), checks: () => checks }}
          />
        </section>
        <section className="ed-pane ed-prev" aria-label="Preview">
          <div className="ed-prev-h">
            <span>Preview · as on the wiki</span>
            <label>
              <input type="checkbox" checked={prefs.syncScroll} onChange={(e) => editorPrefs.set({ syncScroll: e.target.checked })} />
              Scroll together
            </label>
          </div>
          <div className="ed-prev-scroll" ref={preview}>
            <MarkdownView id="std-preview" html={rendered.html} onTask={(line) => toggleTaskInView(v(), line)} />
          </div>
        </section>
        {view === 'changes' && (
          <DiffView
            base={fullFiles ? fullFiles.base : entry ? entry.doc.body : ''}
            current={fullFiles ? fullFiles.current : body}
            title={entry ? `Your changes compared with v${m!.version} on ${catalog.catalog?.project.default_branch ?? 'main'}` : 'The new standard'}
            extra={
              <label>
                <input type="checkbox" checked={withHeader} onChange={(e) => setWithHeader(e.target.checked)} id="std-header" /> Include header and changelog
              </label>
            }
          />
        )}
        {prefs.side && (
          <aside className="ed-side" aria-label="Side panel">
            <SideTabs
              tab={tab}
              setTab={setTab}
              tabs={[
                ['change', 'Change'],
                ['details', 'Details'],
                ['outline', 'Outline'],
                ['checks', <>Checks <span className={`badge${errors ? ' bad' : ''}`}>{checks.length || '✓'}</span></>],
                ['keys', 'Keys'],
              ]}
            />
            <div className="ed-side-b">
              {tab === 'change' && (
                <div className="side-form">
                  {entry ? (
                    <>
                      <label>
                        Version
                        <Segmented
                          value={meta.kind}
                          onChange={(k) => set('kind', k)}
                          label="Version"
                          options={[['minor', `Minor → v${bumpVersion(m!.version, 'minor')}`], ['major', `Major → v${bumpVersion(m!.version, 'major')}`]]}
                        />
                      </label>
                      <span className="muted small">
                        {meta.kind === 'major' ? 'Major: teams have to act. Once merged, Arch suggests an adoption cycle.' : "Minor: clarifications teams don't have to act on."}
                      </span>
                      <label>
                        What changed <span className="muted">(changelog)</span>
                        <input id="std-note" value={meta.note} onChange={(e) => set('note', e.target.value)} placeholder="e.g. Images must be signed with cosign" className={!meta.note.trim() ? 'err' : ''} />
                      </label>
                      <label>
                        Status
                        <Segmented value={meta.status} onChange={(s) => set('status', s)} label="Status" options={[['active', 'Active'], ['deprecated', 'Deprecated']]} />
                      </label>
                    </>
                  ) : (
                    <label>
                      Note for the changelog
                      <input id="std-note" value={meta.note} onChange={(e) => set('note', e.target.value)} placeholder="Initial version" />
                    </label>
                  )}
                  <div className="ed-side-sec" style={{ padding: '6px 0 0' }}>Merge request</div>
                  <div className="mr-preview">
                    <span><b>Title</b> {mrTitle}</span>
                    <span><b>Branch</b> <code>{branch}</code> → <code>{catalog.catalog?.project.default_branch ?? 'main'}</code></span>
                    <span><b>File</b> <code>{path}</code></span>
                    <span className="muted">Reviewers merge it in GitLab. Then publish it to the wiki from Standards{entry && meta.kind === 'major' ? ' and start an adoption cycle' : ''}.</span>
                  </div>
                  {problems.length > 0 && (
                    <ul className="small err" style={{ margin: 0, paddingLeft: 18 }}>
                      {problems.map((p) => <li key={p}>{p}</li>)}
                    </ul>
                  )}
                </div>
              )}
              {tab === 'details' && (
                <div className="side-form">
                  <label>
                    Category
                    <select value={meta.category} onChange={(e) => set('category', e.target.value)}>
                      {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Owner
                    <input list="users" value={meta.owner} onChange={(e) => set('owner', e.target.value)} className={ownerBad ? 'err' : ''} />
                    {ownerBad && <span className="err small">Not a GitLab user</span>}
                  </label>
                  <label>
                    Tags <span className="muted">(comma separated)</span>
                    <input value={meta.tags} onChange={(e) => set('tags', e.target.value)} placeholder="rest, errors" />
                  </label>
                  <span className="muted small">
                    Id <code>{id || '…'}</code>{entry && meta.category !== m!.category ? ' · changing the category moves the file' : ''}
                  </span>
                </div>
              )}
              {tab === 'outline' && <OutlineList headings={rendered.headings} cursorLine={cursor.line} goLine={goLine} />}
              {tab === 'checks' && <ChecksList checks={checks} goLine={goLine} />}
              {tab === 'keys' && <KeysList extra={[['/', 'Rules, examples and blocks'], [`${MOD}+S`, 'Open the merge request']]} />}
            </div>
          </aside>
        )}
      </div>

      <footer className="ed-statusbar">
        <span>Ln {cursor.line + 1}, Col {cursor.col + 1}</span>
        <span>{countWords(body).toLocaleString()} words</span>
        <span>{body.split('\n').length} lines</span>
        {errors > 0 && <span className="err">{errors} problem{errors === 1 ? '' : 's'}</span>}
        <span className="r">{svc.settings.standardsProject}</span>
      </footer>
    </div>
  );
}
