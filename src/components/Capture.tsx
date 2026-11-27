/* Meeting notes, full screen: the GitLab Everything editor with Arch's lines, people, items and checks. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseMeeting, updateNote, type Draft, type UpdateDraft } from '../lib/parser';
import { UPDATE_LABEL, updateProblem } from '../lib/model';
import { fromIso, humanDue } from '../lib/dates';
import { listSeries, resolveAttendees, seriesKey } from '../lib/prep';
import type { GlUser } from '../lib/gitlab';
import { MarkdownEditor, type CursorInfo, type EditorHandle } from '../editor/MarkdownEditor';
import { meetingChecks } from '../editor/checks';
import { renderMeetingPreview } from '../editor/meetingPreview';
import { countWords } from '../editor/markdown';
import { COMMANDS, insertDue, UPDATE_OPS, updateLine } from '../editor/commands';
import { dueTokens } from '../editor/completions';
import {
  Banner, ChecksList, DiffView, editorPrefs, FormatTools, goToLine, KeysList, MarkdownView, MenuButton, MOD, OutlineList, PopItem, Segmented, SideTabs,
  timeOf, toggleTaskInView, ToolButton, useEditorPrefs, useSaveShortcut, useScrollSync, type BannerState, type ViewMode,
} from '../editor/parts';
import { mentionsIn, useEditorData, useUnknownUsers } from './editorData';
import { useApp } from './ctx';
import { Avatar, KindTag } from './ui';

const DRAFT_KEY = 'arch.capture-draft.v1';

export interface CaptureForm {
  title: string;
  date: string;
  attendees: string;
  notes: string;
  /** The text the notes started from (the agenda from Prepare), for the Changes view */
  base?: string;
  /** When the draft was last written */
  at?: number;
}
type Form = CaptureForm;

export function loadCaptureDraft(): Partial<CaptureForm> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCaptureDraft(f: CaptureForm) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(f));
  } catch {
    /* ignore */
  }
}

function dropCaptureDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the capture screen holds notes that haven't been saved to GitLab. */
export function hasUnsavedCapture() {
  return Boolean(loadCaptureDraft()?.notes?.trim());
}

const PLACEHOLDER = `Free-form notes. Lines starting with a keyword become tracked items (type / for the menu):

DECISION: Kafka for all async domain events
    RabbitMQ stays for legacy integrations until 2027   ← indented lines = details
ACTION @jonas.weber: share load-test results due:fri
TODO: write the ADR for Kafka adoption               ← assigned to you
STANDARD: API error format (RFC 7807) due:15.12   ← a standard to write

Update existing items by their number:
- [x] #7                          ← ticked = done
UPDATE #8: halfway there      PUSH #9 due:fri
DROP #10: no longer needed     ADOPTED #14: rolled out`;

type Tab = 'items' | 'outline' | 'checks' | 'keys';

export function Capture() {
  const { svc, today, me, run, reload, go, openItem, toast, items, userMap } = useApp();
  const prefs = useEditorPrefs();
  const [f, setF] = useState<Form>(() => {
    const d = loadCaptureDraft() ?? {};
    return { title: '', date: today, attendees: '', notes: '', base: '', ...d };
  });
  const [savedAt, setSavedAt] = useState<number | undefined>(f.at);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState('');
  const [tab, setTab] = useState<Tab>('items');
  const [cursor, setCursor] = useState<CursorInfo>({ line: 0, col: 0, sel: 0, cursors: 1 });
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [who, setWho] = useState('');
  const editor = useRef<EditorHandle>(null);
  const preview = useRef<HTMLDivElement>(null);
  const view: ViewMode = prefs.view;

  useEffect(() => {
    const t = setTimeout(() => {
      const at = Date.now();
      saveCaptureDraft({ ...f, at });
      if (f.notes.trim() || f.title.trim()) setSavedAt(at);
    }, 400);
    return () => clearTimeout(t);
  }, [f]);

  /* ---- people ---- */
  const users = useMemo(() => [...userMap.values()], [userMap]);
  const attendeeTokens = f.attendees.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const chips = attendeeTokens.map((tok) => {
    const r = resolveAttendees(tok, users);
    const u = r.usernames[0] ? userMap.get(r.usernames[0]) : undefined;
    return { tok, user: u as GlUser | undefined };
  });
  const firstPeople = chips.map((c) => c.user?.username).filter(Boolean) as string[];

  /* ---- parse ---- */
  const opts = useMemo(() => ({ today: f.date || today, me, defaultFollowUpDays: svc.settings.defaultFollowUpDays }), [f.date, today, me, svc.settings.defaultFollowUpDays]);
  const parsed = useMemo(() => parseMeeting(f.notes, opts), [f.notes, opts]);
  const unknown = useUnknownUsers([
    ...parsed.items.map((d) => d.assignee).filter(Boolean) as string[],
    ...parsed.updates.map((u) => u.assignee).filter((a) => a && a !== me) as string[],
    ...mentionsIn(f.notes),
  ]);
  const { completions, knowledge, byIid } = useEditorData('meeting', { first: firstPeople, unknown, keywords: true });

  const key = (d: Draft) => `${d.line}:${d.title}`;
  const ukey = (u: UpdateDraft) => `u:${u.line}:${u.op}:${u.iid}`;
  const updates = parsed.updates.map((u) => ({ u, item: byIid.get(u.iid), problem: updateProblem(u, byIid.get(u.iid)) }));
  const isOnU = (x: (typeof updates)[number]) => (x.problem?.level === 'err' ? skip.has(`force:${ukey(x.u)}`) : !skip.has(ukey(x.u)));
  const selected = parsed.items.filter((d) => !skip.has(key(d)));
  const selectedUpdates = updates.filter(isOnU).map((x) => x.u);
  const toggle = (k: string) => {
    const s = new Set(skip);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setSkip(s);
  };

  const checks = useMemo(() => meetingChecks(f.notes, byIid, { unknown }, opts.today, me, opts.defaultFollowUpDays), [f.notes, byIid, unknown, opts, me]);
  const errors = checks.filter((c) => c.severity === 'error').length;
  const rendered = useMemo(
    () =>
      renderMeetingPreview(f.notes, parsed, {
        today: opts.today,
        items: byIid,
        name: (u) => userMap.get(u)?.name,
        unknown,
        isOff: (d) => ('op' in d ? !isOnU({ u: d, item: byIid.get(d.iid), problem: updateProblem(d, byIid.get(d.iid)) }) : skip.has(key(d))),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [f.notes, parsed, byIid, userMap, unknown, skip, opts.today],
  );
  useScrollSync(editor, preview, view === 'split');

  const series = useMemo(() => listSeries(items), [items]);
  const thisSeries = f.title.trim() ? series.find((s) => s.key === seriesKey(f.title)) : undefined;

  /* ---- actions ---- */
  const setField = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setAttendees = (list: string[]) => setF((x) => ({ ...x, attendees: list.join(', ') }));
  const addAttendee = (text: string) => {
    const add = text.split(/[,;]/).map((s) => s.trim().replace(/^@(?=\S)/, '@')).filter(Boolean);
    if (add.length) setAttendees([...new Set([...attendeeTokens, ...add])]);
    setWho('');
  };
  const save = async () => {
    if (progress) return;
    if (!f.title.trim()) {
      setBanner({ tone: 'err', text: 'Give the meeting a title before saving.' });
      document.getElementById('cap-title')?.focus();
      return;
    }
    if (!selected.length && !selectedUpdates.length && !f.notes.trim()) {
      setBanner({ tone: 'err', text: 'There is nothing to save yet.' });
      return;
    }
    setBanner(null);
    const res = await run('', () => svc.captureMeeting(f, selected, setProgress, selectedUpdates));
    setProgress('');
    if (!res) return;
    toast(`Meeting saved: ${res.created.length} new, ${res.updated.length} updated`);
    if (res.errors.length) toast(`Saved, but ${res.errors.length} item(s) failed: ${res.errors.join('; ')}`, 'err');
    dropCaptureDraft();
    await reload();
    go('meetings');
    openItem(res.meetingIid);
  };
  const discard = () =>
    setBanner({
      tone: 'warn',
      text: 'Discard these notes? They are only kept in this browser and have not been saved to GitLab.',
      actions: [
        {
          label: 'Discard notes',
          danger: true,
          run: () => {
            dropCaptureDraft();
            setBanner(null);
            go('meetings');
          },
        },
        { label: 'Keep editing', run: () => setBanner(null) },
      ],
    });
  const latest = useRef({ save });
  latest.current = { save };
  useSaveShortcut(() => latest.current.save());

  const setView = (v: ViewMode) => editorPrefs.set({ view: v });
  const v = () => editor.current?.view() ?? null;
  const goLine = (line: number) => {
    if (view === 'preview' || view === 'changes') setView('split');
    setTimeout(() => goToLine(editor.current, line));
  };
  const words = countWords(f.notes);
  const status = progress || (savedAt ? `Draft saved ${timeOf(savedAt)}` : f.notes.trim() ? 'Draft kept in this browser' : 'New notes');
  const dateLabel = f.date ? fromIso(f.date).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="fs" id="capture">
      <header className="fs-bar">
        <button type="button" className="fs-back" onClick={() => go('meetings')} title="Back to Meetings (your notes stay as a draft)">
          ← Meetings
        </button>
        <div className="fs-titlebox">
          <input
            id="cap-title"
            className="fs-title"
            list="cap-series"
            value={f.title}
            onChange={setField('title')}
            placeholder="Meeting title"
            aria-label="Meeting title"
            autoFocus={!f.title}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editor.current?.focus();
              }
            }}
          />
          <datalist id="cap-series">
            {series.map((s) => (
              <option key={s.key} value={s.name} />
            ))}
          </datalist>
          <span className="fs-sub">
            <input type="date" value={f.date} onChange={setField('date')} aria-label="Meeting date" title={dateLabel} />
            <span>·</span>
            <span id="cap-series-hint">
              {thisSeries ? `recurring, session ${thisSeries.sessions.length + 1}` : f.title.trim() ? 'one-off meeting' : 'recurring meetings are matched by title'}
            </span>
          </span>
        </div>
        <Segmented value={view} onChange={setView} label="View" options={[['write', 'Write'], ['split', 'Split'], ['preview', 'Preview'], ['changes', 'Changes']]} />
        <div className="fs-acts">
          <span className={`ed-status-txt${progress ? ' dirty' : ''}`} id="cap-status">
            {status}
          </span>
          <button type="button" className="ghost sm" onClick={discard} disabled={Boolean(progress)}>
            Cancel
          </button>
          <button type="button" className="primary sm" id="cap-save" onClick={save} disabled={Boolean(progress)} title={`Save to GitLab (${MOD}+S)`}>
            Save to GitLab <kbd>{MOD}S</kbd>
          </button>
        </div>
      </header>

      <div className="fs-people">
        <span className="lbl">Attendees</span>
        <div className="chips">
          {chips.map((c) => (
            <span key={c.tok} className={`chip${c.user ? '' : ' guest'}`} title={c.user ? `@${c.user.username}` : 'Not matched to a GitLab user: listed as a guest'}>
              {c.user && <Avatar user={c.user} size={18} />}
              {c.user ? c.user.name : `${c.tok.replace(/^@/, '')} (guest)`}
              <button type="button" className="chip-x" aria-label={`Remove ${c.tok}`} onClick={() => setAttendees(attendeeTokens.filter((t) => t !== c.tok))}>
                ×
              </button>
            </span>
          ))}
          <input
            className="chip-input"
            list="users"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === ',') && who.trim()) {
                e.preventDefault();
                addAttendee(who);
              }
              if (e.key === 'Backspace' && !who && attendeeTokens.length) setAttendees(attendeeTokens.slice(0, -1));
            }}
            onBlur={() => who.trim() && addAttendee(who)}
            placeholder={chips.length ? 'Add someone…' : 'Who is in the meeting? Name or @username, Enter'}
            aria-label="Add an attendee"
          />
        </div>
        {f.base?.trim() ? <span className="note">Started from the agenda · {f.base.split('\n').filter((l) => /#\d+/.test(l)).length} open items carried over</span> : null}
      </div>

      <FormatTools
        editor={editor}
        extra={({ open, setOpen }) => (
          <div className="tgrp arch">
            <span className="lbl-t">ARCH</span>
            <ToolButton label="+ Action" title="Action for someone (ACTION @owner: …)" onClick={() => { const x = v(); if (x) COMMANDS.action(x); }} id="tb-action" />
            <ToolButton label="+ Decision" title="Decision (DECISION: …)" onClick={() => { const x = v(); if (x) COMMANDS.decision(x); }} id="tb-decision" />
            <ToolButton label="+ Standard" title="Standard to write (STANDARD: …)" onClick={() => { const x = v(); if (x) COMMANDS.standard(x); }} />
            <MenuButton
              open={open}
              setOpen={setOpen}
              menu={{
                key: 'update',
                label: 'Update item',
                title: 'Update an existing item by its number',
                wide: true,
                render: (close) =>
                  UPDATE_OPS.map((o) => (
                    <PopItem key={o.kw} icon={<span className={`op op-${o.kw.toLowerCase() === 'update' ? 'note' : o.kw.toLowerCase()}`}>{o.kw}</span>} label={o.label} hint={o.detail} onPick={() => { close(); const x = v(); if (x) updateLine(x, o.kw); }} />
                  )),
              }}
            />
            <MenuButton
              open={open}
              setOpen={setOpen}
              menu={{
                key: 'due',
                label: 'Due date',
                title: 'Add a due date to the line',
                wide: true,
                render: (close) => (
                  <>
                    {dueTokens(opts.today).map((d) => (
                      <PopItem key={d.token} icon="📅" label={d.label} hint={`due:${d.token} · ${humanDue(d.date, opts.today)}`} onPick={() => { close(); const x = v(); if (x) insertDue(x, d.token + ' '); }} />
                    ))}
                    <div className="hd">Pick a date</div>
                    <input type="date" onChange={(e) => { if (e.target.value) { close(); const x = v(); if (x) insertDue(x, e.target.value + ' '); } }} />
                  </>
                ),
              }}
            />
          </div>
        )}
        right={
          <div className="tgrp">
            <ToolButton label="Wrap" title="Wrap long lines" pressed={prefs.wrap} onClick={() => editorPrefs.set({ wrap: !prefs.wrap })} />
            <ToolButton label="Lines" title="Line numbers" pressed={prefs.lineNumbers} onClick={() => editorPrefs.set({ lineNumbers: !prefs.lineNumbers })} />
            <ToolButton
              label={<>Panel {errors ? <span className="badge bad">{errors}</span> : null}</>}
              title="Items, outline, checks and shortcuts"
              pressed={prefs.side}
              onClick={() => editorPrefs.set({ side: !prefs.side })}
              id="tb-panel"
            />
          </div>
        }
      />

      <Banner b={banner} />

      <div className={`ed-body v-${view}${prefs.side ? ' side' : ''}`}>
        <section className="ed-pane ed-src" aria-label="Meeting notes">
          <MarkdownEditor
            ref={editor}
            id="cap-editor"
            initial={f.notes}
            onChange={(notes) => setF((x) => ({ ...x, notes }))}
            completions={completions}
            knowledge={knowledge}
            placeholder={PLACEHOLDER}
            label="Meeting notes in Markdown"
            wrap={prefs.wrap}
            lineNumbers={prefs.lineNumbers}
            autoFocus={Boolean(f.title)}
            onCursor={setCursor}
            hooks={{ save: () => latest.current.save(), togglePreview: () => setView(view === 'preview' ? 'split' : 'preview'), checks: () => checks }}
          />
        </section>
        <section className="ed-pane ed-prev" aria-label="Preview">
          <div className="ed-prev-h">
            <span>Preview · as it will be saved</span>
            <label>
              <input type="checkbox" checked={prefs.syncScroll} onChange={(e) => editorPrefs.set({ syncScroll: e.target.checked })} />
              Scroll together
            </label>
          </div>
          <div className="ed-prev-scroll" ref={preview}>
            {f.notes.trim() ? (
              <MarkdownView id="cap-preview" html={rendered.html} onTask={(line) => toggleTaskInView(v(), line)} onRef={(iid) => openItem(iid)} />
            ) : (
              <p className="muted">Items appear here as cards while you type.</p>
            )}
          </div>
        </section>
        {view === 'changes' && (
          <DiffView
            base={f.base ?? ''}
            current={f.notes}
            title={f.base?.trim() ? 'Your notes compared with the agenda' : 'Notes written in this session'}
          />
        )}
        {prefs.side && (
          <aside className="ed-side" aria-label="Side panel">
            <SideTabs
              tab={tab}
              setTab={setTab}
              tabs={[
                ['items', <>Items <span className="badge">{selected.length + selectedUpdates.length}</span></>],
                ['outline', 'Outline'],
                ['checks', <>Checks <span className={`badge${errors ? ' bad' : ''}`}>{checks.length || '✓'}</span></>],
                ['keys', 'Keys'],
              ]}
            />
            <div className="ed-side-b">
              {tab === 'items' && (
                <div id="cap-items">
                  <div className="ed-side-sec">
                    Will create <span className="count">{selected.length}</span>
                  </div>
                  {!parsed.items.length && <p className="ed-side-empty">New actions, decisions and standards appear here as you type.</p>}
                  {parsed.items.map((d) => {
                    const k = key(d);
                    const off = skip.has(k);
                    const bad = d.assignee && unknown.has(d.assignee.toLowerCase());
                    return (
                      <label key={k} className={`draft ${off ? 'off' : ''} ${bad ? 'bad' : ''}`}>
                        <input type="checkbox" checked={!off} onChange={() => toggle(k)} />
                        <div className="draft-body" onClick={(e) => { e.preventDefault(); goLine(d.line - 1); }}>
                          <div>
                            <KindTag kind={d.type} /> {d.title}
                          </div>
                          <div className="row-meta">
                            {d.type !== 'decision' && (
                              <span className={bad ? 'err' : ''}>
                                → {d.assignee ? userMap.get(d.assignee)?.name ?? `@${d.assignee}` : 'me'}
                                {bad ? ' (unknown user)' : ''}
                              </span>
                            )}
                            {d.due && <span>due {humanDue(d.due, opts.today)}</span>}
                            {d.details && <span className="muted">+ details</span>}
                            <span className="muted">line {d.line}</span>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                  {updates.length > 0 && (
                    <>
                      <div className="ed-side-sec">
                        Will update <span className="count">{selectedUpdates.length}</span>
                      </div>
                      {updates.map((x) => {
                        const k = ukey(x.u);
                        const on = isOnU(x);
                        const note = updateNote(x.u.text, x.item?.title);
                        return (
                          <label key={k} className={`draft ${on ? '' : 'off'} ${x.problem?.level === 'err' ? 'bad' : ''}`}>
                            <input type="checkbox" checked={on} onChange={() => toggle(x.problem?.level === 'err' ? `force:${k}` : k)} />
                            <div className="draft-body" onClick={(e) => { e.preventDefault(); goLine(x.u.line - 1); }}>
                              <div>
                                <span className={`op op-${x.u.op}`}>{UPDATE_LABEL[x.u.op]}</span> <span className="ref">#{x.u.iid}</span> {x.item?.title ?? <span className="muted">unknown item</span>}
                              </div>
                              <div className="row-meta">
                                {x.u.due && <span>follow-up → {humanDue(x.u.due, opts.today)}</span>}
                                {x.u.assignee && <span>→ @{x.u.assignee}</span>}
                                {note && <span className="muted">“{note}”</span>}
                                {x.problem && <span className={x.problem.level === 'err' ? 'err' : 'warn-txt'}>{x.problem.msg}</span>}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </>
                  )}
                  <p className="ed-side-empty small">
                    Untick to leave a line out. Actions without a date get a follow-up in {svc.settings.defaultFollowUpDays} days. The whole text is saved as the meeting record.
                  </p>
                </div>
              )}
              {tab === 'outline' && <OutlineList headings={rendered.headings} cursorLine={cursor.line} goLine={goLine} />}
              {tab === 'checks' && <ChecksList checks={checks} goLine={goLine} empty="No problems: every person, item and date checks out." />}
              {tab === 'keys' && (
                <KeysList
                  extra={[
                    ['/', 'Action, decision, update…'],
                    ['due:', 'Date suggestions'],
                    ['- [x] #7', 'Mark #7 done'],
                  ]}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      <footer className="ed-statusbar" id="cap-sb">
        <span>
          Ln {cursor.line + 1}, Col {cursor.col + 1}
          {cursor.sel ? ` · ${cursor.sel} selected` : ''}
        </span>
        <span>{words.toLocaleString()} words</span>
        <span>{f.notes ? f.notes.split('\n').length : 0} lines</span>
        <span>
          {selected.length} new · {selectedUpdates.length} update{selectedUpdates.length === 1 ? '' : 's'}
        </span>
        {errors > 0 && <span className="err">{errors} problem{errors === 1 ? '' : 's'}</span>}
        <span className="r">Saves to {svc.project.path_with_namespace}</span>
      </footer>
    </div>
  );
}
