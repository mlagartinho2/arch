/* An item, full screen: title and properties, the description in the full editor, activity with a comment composer, and a rail. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlNote } from '../lib/gitlab';
import { getMarker, isTrackable, meetingUpdates, type Item } from '../lib/model';
import { joinMarkers, splitMarkers } from '../lib/markers';
import { addDays, daysBetween, fromIso } from '../lib/dates';
import { seriesName } from '../lib/prep';
import { MarkdownEditor, type EditorHandle } from '../editor/MarkdownEditor';
import { checkMarkdown } from '../editor/checks';
import { mdRender } from '../editor/markdown';
import { drafts } from '../editor/drafts';
import { Banner, DiffView, FormatTools, MarkdownView, MOD, Popover, Segmented, timeOf, toggleTaskInView, ToolButton, useSaveShortcut, type BannerState } from '../editor/parts';
import { mentionsIn, useEditorData, useUnknownUsers } from './editorData';
import { useApp, type FullFocus } from './ctx';
import { ItemList } from './ItemRow';
import { Avatar, Due, KindTag } from './ui';

const ago = (iso: string, today: string) => {
  const n = daysBetween(iso.slice(0, 10), today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};
const relDays = (due: string, today: string) => {
  const n = daysBetween(today, due);
  return n < 0 ? `${-n} day${n === -1 ? '' : 's'} overdue` : n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
};
const longDate = (iso: string) => fromIso(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/** Text of a description to show and edit: without hidden markers. */
export const visibleDescription = (desc: string) => splitMarkers(desc).text;

export function ItemScreen({ iid, focus, nav, backLabel, onClose }: { iid: number; focus?: FullFocus; nav: number[]; backLabel: string; onClose: () => void }) {
  const app = useApp();
  const { svc, items, upsert, today, openFull } = app;
  const loaded = items.find((i) => i.iid === iid);
  const [fetched, setFetched] = useState<Item | null | undefined>(undefined);
  useEffect(() => {
    if (loaded) return;
    setFetched(undefined);
    svc.fetch({ projectId: svc.project.id, iid }).then((it) => { setFetched(it); upsert(it); }).catch(() => setFetched(null));
  }, [iid, loaded, svc, upsert]);
  const item = loaded ?? fetched;

  const pos = nav.indexOf(iid);
  const prev = pos > 0 ? nav[pos - 1] : undefined;
  const next = pos >= 0 && pos < nav.length - 1 ? nav[pos + 1] : undefined;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' && prev) openFull(prev);
      if (e.key === 'ArrowRight' && next) openFull(next);
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, openFull, onClose]);

  if (item === undefined) return <div className="fs"><div className="loading">Loading #{iid}…</div></div>;
  if (item === null) {
    return (
      <div className="fs">
        <header className="fs-bar"><button type="button" className="fs-back" onClick={onClose}>← {backLabel}</button></header>
        <div className="empty" style={{ margin: 40 }}>#{iid} is not an Arch item in {svc.project.path_with_namespace}, or you can't see it.</div>
      </div>
    );
  }
  return <ItemPage key={item.iid} item={item} focus={focus} prev={prev} next={next} backLabel={backLabel} onClose={onClose} today={today} />;
}

function ItemPage({ item, focus, prev, next, backLabel, onClose, today }: { item: Item; focus?: FullFocus; prev?: number; next?: number; backLabel: string; onClose: () => void; today: string }) {
  const app = useApp();
  const { svc, me, items, upsert, run, openFull, prepare, standards } = app;
  const [title, setTitle] = useState(item.title);
  const [owner, setOwner] = useState(item.assignee?.username ?? '');
  const [notes, setNotes] = useState<GlNote[] | null>(null);
  const [nudge, setNudge] = useState<HTMLElement | null>(null);
  const [nudgeMsg, setNudgeMsg] = useState('Friendly follow-up on this one. Any update?');
  const ownerUnknown = useUnknownUsers(owner.trim() && owner.replace('@', '') !== item.assignee?.username ? [owner.replace('@', '')] : []);

  const refreshNotes = () => svc.notes(item).then(setNotes).catch(() => setNotes([]));
  useEffect(() => {
    refreshNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.iid, item.updatedAt]);

  const act = async (label: string, fn: () => Promise<Item | null | undefined>) => {
    const r = await run(label, fn);
    if (r) upsert(r);
    return r;
  };
  const trackable = isTrackable(item);
  const waiting = item.assignee && item.assignee.username !== me;
  const meeting = item.meetingIid ? items.find((i) => i.iid === item.meetingIid) : undefined;
  const outcomes = item.kind === 'meeting' ? items.filter((i) => i.meetingIid === item.iid) : [];
  const refs = useMemo(() => {
    const seen = new Set<number>();
    for (const m of visibleDescription(item.description).matchAll(/(^|[\s(])#(\d+)\b/g)) seen.add(Number(m[2]));
    seen.delete(item.iid);
    if (item.meetingIid) seen.delete(item.meetingIid);
    return [...seen].map((n) => items.find((i) => i.iid === n)).filter(Boolean) as Item[];
  }, [item, items]);
  const stdId = item.adoption?.std;
  const stdEntry = stdId ? app.catalog.catalog?.entries.find((e) => e.doc.meta.id === stdId) : undefined;
  const userNotes = (notes ?? []).filter((n) => !n.system).slice().reverse();
  const history = (notes ?? []).filter((n) => n.system);

  const doneLabel = item.kind === 'adoption' ? 'Mark adopted' : 'Mark done';
  return (
    <div className="fs" id="item-screen" data-iid={item.iid}>
      <header className="fs-bar">
        <button type="button" className="fs-back" onClick={onClose} title="Back (Esc)">
          ← {backLabel}
        </button>
        <KindTag kind={item.kind} />
        <span className="fs-crumb">
          {svc.project.path_with_namespace} <b>#{item.iid}</b>
        </span>
        <span className={item.open ? 'pill ok' : 'pill'}>{item.open ? 'open' : 'closed'}</span>
        <span className="btns">
          <button type="button" className="ghost xs" disabled={!prev} onClick={() => prev && openFull(prev)} title="Previous in the list (←)">←</button>
          <button type="button" className="ghost xs" disabled={!next} onClick={() => next && openFull(next)} title="Next in the list (→)">→</button>
        </span>
        <div className="fs-acts">
          <a className="ghost sm" style={{ textDecoration: 'none', color: 'inherit', borderRadius: 6 }} href={item.webUrl} target="_blank" rel="noreferrer">
            Open in GitLab ↗
          </a>
          {waiting && item.open && item.kind === 'action' && (
            <button type="button" className="ghost sm" onClick={(e) => setNudge(e.currentTarget)}>
              Nudge…
            </button>
          )}
          {(trackable || item.kind === 'decision') &&
            (item.open ? (
              <button type="button" className="primary sm" id="it-done" onClick={() => act(item.kind === 'decision' ? 'Closed' : 'Marked done', () => svc.close(item))}>
                ✓ {item.kind === 'decision' ? 'Close' : doneLabel}
              </button>
            ) : (
              <button type="button" className="ghost sm" onClick={() => act('Reopened', () => svc.reopen(item))}>
                Reopen
              </button>
            ))}
        </div>
      </header>
      {nudge && (
        <Popover anchor={nudge} onClose={() => setNudge(null)} wide>
          <div className="side-form" style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8, width: 340 }}>
            <b style={{ fontSize: 13 }}>Nudge @{item.assignee!.username}</b>
            <textarea rows={3} value={nudgeMsg} onChange={(e) => setNudgeMsg(e.target.value)} />
            <span className="muted small">Posts a GitLab comment mentioning them and moves the follow-up to +3 days.</span>
            <button
              type="button"
              className="primary sm"
              onClick={async () => {
                setNudge(null);
                await act(`Nudged @${item.assignee!.username}`, () => svc.nudge(item, nudgeMsg));
                refreshNotes();
              }}
            >
              Nudge
            </button>
          </div>
        </Popover>
      )}

      <div className="it-body">
        <main className="it-main">
          <div>
            <input
              className="it-title"
              id="it-title"
              aria-label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title.trim() && title !== item.title && act('Renamed', () => svc.rename(item, title.trim()))}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
            <div className="it-props">
              {trackable && (
                <span className="prop2">
                  <b>Owner</b>
                  <Avatar user={item.assignee} size={20} />
                  <input
                    list="users"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    onKeyDown={(e) => {
                      const u = owner.replace('@', '').trim();
                      if (e.key === 'Enter' && u !== (item.assignee?.username ?? '')) {
                        if (u && ownerUnknown.has(u.toLowerCase())) return app.toast(`@${u} is not a GitLab user`, 'err');
                        act('Reassigned', () => svc.assign(item, u || undefined));
                      }
                    }}
                    placeholder="username, Enter"
                    aria-label="Owner"
                    className={owner.trim() && ownerUnknown.has(owner.replace('@', '').toLowerCase()) ? 'err' : ''}
                  />
                </span>
              )}
              {trackable && (
                <span className="prop2">
                  <b>Follow-up</b> <Due item={item} today={today} />
                </span>
              )}
              {meeting && (
                <span className="prop2">
                  <b>From</b>
                  <a href="#" onClick={(e) => (e.preventDefault(), openFull(meeting.iid))}>
                    {meeting.title}
                  </a>
                </span>
              )}
              <span className="prop2 muted">
                Created by {item.author.name} · {ago(item.createdAt, today)}
              </span>
            </div>
          </div>

          {item.kind === 'meeting' && (
            <div className="ed-card">
              <div className="ed-card-h">
                <h4>Outcomes</h4>
                <span className="acts">
                  <button type="button" className="primary sm" onClick={() => prepare({ title: seriesName(item.title) })}>
                    Prepare next session →
                  </button>
                </span>
              </div>
              <div style={{ padding: 10 }}>
                <ItemList items={outcomes} showMeeting={false} empty="No items were created in this meeting." />
                {meetingUpdates(item.description).length > 0 && (
                  <p className="muted small" style={{ margin: '8px 4px 0' }}>
                    Also updated: {meetingUpdates(item.description).map((u) => `#${u.iid} (${u.summary})`).join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}
          {item.newStandard && item.open && (
            <div className="ed-banner info" style={{ borderRadius: 10, border: '1px solid var(--line)' }}>
              <span>This is a standard still to be written. Draft it in Arch: it opens a merge request in the standards repository.</span>
              <span className="acts">
                <button
                  type="button"
                  className="primary sm"
                  onClick={() =>
                    standards({
                      newFrom: {
                        title: decodeURIComponent(getMarker(item.description, 'newstandard') ?? '') || item.title.replace(/^Write standard:\s*/, ''),
                        summary: visibleDescription(item.description).replace(/^From meeting #\d+\s*/m, '').trim(),
                        fromIid: item.iid,
                      },
                    })
                  }
                >
                  Draft this standard →
                </button>
              </span>
            </div>
          )}

          <DescriptionCard item={item} startEditing={focus === 'desc'} />

          <section className="activity" aria-label="Activity">
            <h4 className="h4">Activity</h4>
            {notes === null && <span className="muted small">Loading…</span>}
            {notes !== null && !userNotes.length && <span className="muted small">No comments yet.</span>}
            {userNotes.map((n) => (
              <div className="act-note" key={n.id}>
                <Avatar user={n.author} size={24} />
                <div className="bubble">
                  <div className="who">
                    <b>{n.author.name}</b> · {ago(n.created_at, today)}
                  </div>
                  <MarkdownView className="compact" html={mdRender(n.body, { item: (i) => items.find((x) => x.iid === i) }).html} onRef={(i) => openFull(i)} />
                </div>
              </div>
            ))}
            <Composer item={item} autoFocus={focus === 'comment'} onPosted={refreshNotes} />
          </section>
        </main>

        <aside className="it-rail" aria-label="Details">
          {trackable && (
            <div className="rail-sec">
              <h4 className="h4">Follow-up</h4>
              <span className="big">{item.due ? `${longDate(item.due)}` : 'No date'}</span>
              {item.due && <span className={`small ${daysBetween(today, item.due) < 0 ? 'err' : 'muted'}`}>{relDays(item.due, today)}</span>}
              <div className="btns">
                {([['today', 0], ['+1d', 1], ['+3d', 3], ['+1w', 7], ['+2w', 14]] as const).map(([l, n]) => (
                  <button key={l} type="button" className="ghost xs" onClick={() => act(`Follow-up ${l}`, () => svc.setDue(item, addDays(today, n)))}>
                    {l}
                  </button>
                ))}
              </div>
              <input type="date" aria-label="Follow-up date" value={item.due ?? ''} onChange={(e) => act('Date set', () => svc.setDue(item, e.target.value || null))} />
            </div>
          )}
          <div className="rail-sec">
            <h4 className="h4">Linked</h4>
            {meeting && (
              <button type="button" className="rail-link" onClick={() => openFull(meeting.iid)}>
                <KindTag kind="meeting" /> {meeting.title}
              </button>
            )}
            {stdId && (
              <button type="button" className="rail-link" onClick={() => standards({ open: stdId })}>
                <span className="kind kind-standard">Standard</span> {stdEntry ? `${stdEntry.doc.meta.title} v${item.adoption?.version}` : `${stdId} v${item.adoption?.version}`}
              </button>
            )}
            {refs.map((r) => (
              <button type="button" key={r.iid} className="rail-link" onClick={() => openFull(r.iid)}>
                <KindTag kind={r.kind} /> <span className="ref">#{r.iid}</span> {r.title}
              </button>
            ))}
            {!meeting && !stdId && !refs.length && <span className="muted small">Mention #123 in the description or a comment to link an item.</span>}
          </div>
          <div className="rail-sec">
            <h4 className="h4">History</h4>
            <div className="hist">
              {history.slice(0, 12).map((n) => (
                <div key={n.id}>
                  {n.body} · {n.author.name.split(' ')[0]} · {ago(n.created_at, today)}
                </div>
              ))}
              <div>
                Created{meeting ? ` in ${meeting.title}` : ''} · {item.author.name.split(' ')[0]} · {ago(item.createdAt, today)}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- description ---------- */

function DescriptionCard({ item, startEditing }: { item: Item; startEditing: boolean }) {
  const { svc, upsert, toast, openFull, run } = useApp();
  const dk = `desc:${item.projectId}:${item.iid}`;
  const split = useMemo(() => splitMarkers(item.description), [item.description]);
  const [editing, setEditing] = useState(() => startEditing || Boolean(drafts.get(dk)));
  const [text, setText] = useState(() => drafts.get(dk)?.content ?? split.text);
  const [base, setBase] = useState(() => drafts.get(dk)?.base ?? split.text);
  const [mode, setMode] = useState<'write' | 'preview' | 'changes'>('write');
  const [banner, setBanner] = useState<BannerState | null>(() => {
    const d = drafts.get(dk);
    return d && d.base !== split.text ? { tone: 'warn', text: 'This description changed in GitLab since your draft was started. Check Changes before saving.' } : null;
  });
  const [theirs, setTheirs] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftAt, setDraftAt] = useState<number | undefined>(drafts.get(dk)?.at);
  const editor = useRef<EditorHandle>(null);
  const unknown = useUnknownUsers(editing ? mentionsIn(text) : []);
  const { completions, knowledge, byIid } = useEditorData('description', { unknown });
  const dirty = editing && text !== base;

  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => {
      if (text !== base) {
        const at = Date.now();
        drafts.put(dk, { content: text, base, at });
        setDraftAt(at);
      } else drafts.drop(dk);
    }, 400);
    return () => clearTimeout(t);
  }, [text, base, editing, dk]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);
  // Follow GitLab when not editing.
  useEffect(() => {
    if (!editing) { setText(split.text); setBase(split.text); }
  }, [split.text, editing]);

  const startEdit = () => { setText(split.text); setBase(split.text); setEditing(true); setMode('write'); setBanner(null); };
  const cancel = () => {
    if (text !== base && !banner?.actions) {
      setBanner({
        tone: 'warn', text: 'Discard your changes to the description?',
        actions: [
          { label: 'Discard', danger: true, run: () => { drafts.drop(dk); setBanner(null); setEditing(false); setText(split.text); } },
          { label: 'Keep editing', run: () => setBanner(null) },
        ],
      });
      return;
    }
    drafts.drop(dk);
    setBanner(null);
    setEditing(false);
  };
  const save = async (force = false) => {
    if (saving) return;
    if (text === base && !force) { setEditing(false); drafts.drop(dk); return; }
    setSaving(true);
    try {
      const remote = await svc.remoteDescription(item);
      const remoteSplit = splitMarkers(remote);
      if (!force && remoteSplit.text !== base) {
        setTheirs(remoteSplit.text);
        setBanner({
          tone: 'err',
          text: 'Someone changed this description in GitLab after you started editing. Saving now would replace their changes.',
          actions: [
            { label: 'Compare versions', run: () => setMode('changes') },
            { label: 'Save mine anyway', danger: true, run: () => { setBanner(null); save(true); } },
            {
              label: 'Load their version',
              run: () => {
                drafts.put(`${dk}:mine`, { content: text, base, at: Date.now() });
                setBase(remoteSplit.text);
                setText(remoteSplit.text);
                editor.current?.setText(remoteSplit.text);
                setTheirs(null);
                setBanner({ tone: 'info', text: 'Their version is loaded. Your text is kept as a draft in this browser.' });
              },
            },
          ],
        });
        return;
      }
      const r = await svc.setDescription(item, joinMarkers(text, remoteSplit.markers.length ? remoteSplit.markers : split.markers));
      if (r) upsert(r);
      drafts.drop(dk);
      setBase(text);
      setTheirs(null);
      setBanner(null);
      setEditing(false);
      toast('Description saved');
    } catch (e) {
      setBanner({ tone: 'err', text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };
  const latest = useRef({ save });
  latest.current = { save };
  useSaveShortcut(() => latest.current.save(), editing);

  if (!editing) {
    const html = mdRender(split.text, { tasks: true, item: (i) => byIid.get(i) }).html;
    return (
      <div className="ed-card" id="desc-card">
        <div className="ed-card-h">
          <h4>{item.kind === 'meeting' ? 'Notes' : 'Description'}</h4>
          <span className="acts">
            <button type="button" className="ghost xs" id="desc-edit" onClick={startEdit} title="Edit the description (E)">
              Edit
            </button>
          </span>
        </div>
        <div className="desc-read" onDoubleClick={startEdit}>
          {split.text.trim() ? (
            <MarkdownView
              html={html}
              onRef={(i) => openFull(i)}
              onTask={(line, checked, input) => {
                const expected = split.text.split('\n')[line] ?? '';
                input.disabled = true;
                run(checked ? 'Task ticked' : 'Task unticked', () => svc.tickTask(item, line, expected, checked)).then((r) => {
                  input.disabled = false;
                  if (r) upsert(r);
                  else input.checked = !checked;
                });
              }}
            />
          ) : (
            <p className="empty-desc">No description. Double-click or press Edit to write one.</p>
          )}
        </div>
      </div>
    );
  }

  const checks = checkMarkdown(text);
  return (
    <div className="ed-card tall" id="desc-card">
      <div className="ed-card-h">
        <h4>{item.kind === 'meeting' ? 'Notes' : 'Description'}</h4>
        <Segmented value={mode} onChange={setMode} label="View" options={[['write', 'Write'], ['preview', 'Preview'], ['changes', 'Changes']]} />
        <span className="acts">
          <span className={`ed-status-txt${dirty ? ' dirty' : ''}`} id="desc-status">
            {saving ? 'Saving…' : dirty ? `Unsaved changes${draftAt ? ` · draft kept ${timeOf(draftAt)}` : ''}` : 'No changes'}
          </span>
          <button type="button" className="ghost sm" onClick={cancel}>Cancel</button>
          <button type="button" className="primary sm" id="desc-save" onClick={() => save()} disabled={saving} title={`Save (${MOD}+S)`}>
            Save
          </button>
        </span>
      </div>
      <Banner b={banner} />
      {mode === 'write' && <FormatTools editor={editor} compact right={checks.length ? <span className="muted small" title={checks.map((c) => `Line ${c.line + 1}: ${c.message}`).join('\n')}>{checks.length} check{checks.length === 1 ? '' : 's'}</span> : null} />}
      <div style={{ display: mode === 'write' ? 'contents' : 'none' }}>
        <MarkdownEditor
          ref={editor}
          id="desc-editor"
          initial={text}
          onChange={setText}
          completions={completions}
          knowledge={knowledge}
          placeholder="Describe the item. Type / for blocks, # to link an item, @ to mention someone."
          label="Description in Markdown"
          lineNumbers={false}
          autoFocus
          hooks={{ save: () => latest.current.save(), togglePreview: () => setMode((m) => (m === 'preview' ? 'write' : 'preview')), checks: () => checks }}
        />
      </div>
      {mode === 'preview' && (
        <div className="ed-card-prev">
          <MarkdownView html={mdRender(text, { tasks: true, item: (i) => byIid.get(i) }).html} onTask={(line) => toggleTaskInView(editor.current?.view(), line)} onRef={(i) => openFull(i)} />
        </div>
      )}
      {mode === 'changes' && (
        theirs !== null ? (
          <DiffView base={theirs} current={text} title="Their version in GitLab → yours" />
        ) : (
          <DiffView base={base} current={text} title="Your changes" empty="You haven't changed anything yet." />
        )
      )}
    </div>
  );
}

/* ---------- comment composer ---------- */

function Composer({ item, autoFocus, onPosted }: { item: Item; autoFocus: boolean; onPosted: () => void }) {
  const { svc, run, upsert, today } = useApp();
  const ck = `comment:${item.projectId}:${item.iid}`;
  const [text, setText] = useState(() => drafts.get(ck)?.content ?? '');
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [big, setBig] = useState(false);
  const [push, setPush] = useState(false);
  const [close, setClose] = useState(false);
  const [posting, setPosting] = useState(false);
  const editor = useRef<EditorHandle>(null);
  const unknown = useUnknownUsers(mentionsIn(text));
  const { completions, knowledge, byIid } = useEditorData('comment', { unknown });
  const trackable = isTrackable(item) && item.open;

  useEffect(() => {
    const t = setTimeout(() => (text.trim() ? drafts.put(ck, { content: text, base: '', at: Date.now() }) : drafts.drop(ck)), 400);
    return () => clearTimeout(t);
  }, [text, ck]);

  const submit = async () => {
    if (posting || (!text.trim() && !push && !close)) return;
    setPosting(true);
    const ok = await run(close ? (item.kind === 'adoption' ? 'Commented and marked adopted' : 'Commented and closed') : 'Comment added', async () => {
      if (text.trim()) await svc.addNote(item, text.trim());
      let r: Item | null = null;
      if (push) r = await svc.setDue(item, addDays(today, 3));
      if (close) r = await svc.close(r ?? item);
      if (r) upsert(r);
      return true;
    });
    setPosting(false);
    if (!ok) return;
    drafts.drop(ck);
    setText('');
    editor.current?.setText('');
    setPush(false);
    setClose(false);
    onPosted();
  };
  const latest = useRef({ submit });
  latest.current = { submit };

  return (
    <div className={`ed-card composer${big ? ' big' : ''}`} id="composer">
      <FormatTools
        editor={editor}
        compact
        right={
          <div className="tgrp">
            <Segmented value={mode} onChange={setMode} label="Comment view" options={[['write', 'Write'], ['preview', 'Preview']]} />
            <ToolButton label={big ? '⤡' : '⤢'} title={big ? 'Smaller' : 'Expand'} onClick={() => setBig(!big)} />
          </div>
        }
      />
      <div style={{ display: mode === 'write' ? 'contents' : 'none' }}>
        <MarkdownEditor
          ref={editor}
          id="comment-editor"
          initial={text}
          onChange={setText}
          completions={completions}
          knowledge={knowledge}
          placeholder={`Write a comment. @ mentions notify people in GitLab. ${MOD}+Enter to post.`}
          label="Comment in Markdown"
          lineNumbers={false}
          compact
          autoFocus={autoFocus}
          hooks={{ submit: () => latest.current.submit(), save: () => latest.current.submit() }}
        />
      </div>
      {mode === 'preview' && (
        <div className="ed-card-prev">
          {text.trim() ? <MarkdownView className="compact" html={mdRender(text, { item: (i) => byIid.get(i) }).html} /> : <p className="muted">Nothing to preview.</p>}
        </div>
      )}
      <div className="composer-f">
        {trackable && (
          <label>
            <input type="checkbox" checked={push} onChange={(e) => setPush(e.target.checked)} /> Push follow-up +3 days
          </label>
        )}
        {trackable && (
          <label>
            <input type="checkbox" checked={close} onChange={(e) => setClose(e.target.checked)} /> {item.kind === 'adoption' ? 'Mark adopted' : 'Close the action'}
          </label>
        )}
        <span className="acts">
          <kbd>{MOD} Enter</kbd>
          <button type="button" className="primary sm" id="comment-post" disabled={posting || (!text.trim() && !push && !close)} onClick={submit}>
            {text.trim() ? 'Comment' : close ? 'Close' : 'Update'}
          </button>
        </span>
      </div>
    </div>
  );
}
