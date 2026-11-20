import { useEffect, useMemo, useState } from 'react';
import { parseMeeting, updateNote, type Draft, type UpdateDraft } from '../lib/parser';
import { UPDATE_LABEL, updateProblem } from '../lib/model';
import { humanDue } from '../lib/dates';
import { useApp } from './ctx';
import { KindTag } from './ui';

const DRAFT_KEY = 'arch.capture-draft.v1';

export interface CaptureForm {
  title: string;
  date: string;
  attendees: string;
  notes: string;
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

/** True when the capture screen holds notes that haven't been saved to GitLab. */
export function hasUnsavedCapture() {
  return Boolean(loadCaptureDraft()?.notes?.trim());
}

const PLACEHOLDER = `Free-form notes. Lines starting with a keyword become tracked items:

DECISION: Kafka for all async domain events
    RabbitMQ stays for legacy integrations until 2027   ← indented lines = details
ACTION @jonas.weber: share load-test results due:fri
TODO: write the ADR for Kafka adoption               ← assigned to you
ask @sofia: list services still on RabbitMQ due:+3d
STANDARD: API error format (RFC 7807) due:15.12

Update existing items by their number:
- [x] #7                          ← ticked = done
UPDATE #8: halfway there      PUSH #9 due:fri
DROP #10: no longer needed     ADOPTED #14 Payments`;

export function Capture() {
  const { svc, today, me, run, reload, go, openItem, toast, items } = useApp();
  const empty: Form = { title: '', date: today, attendees: '', notes: '' };
  const [f, setF] = useState<Form>(() => ({ ...empty, ...(loadCaptureDraft() ?? {}) }));
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState('');

  useEffect(() => saveCaptureDraft(f), [f]);

  const parsed = useMemo(
    () => parseMeeting(f.notes, { today: f.date || today, me, defaultFollowUpDays: svc.settings.defaultFollowUpDays }),
    [f.notes, f.date, today, me, svc.settings.defaultFollowUpDays],
  );
  const drafts = parsed.items;
  const key = (d: Draft) => `${d.line}:${d.title}`;
  const ukey = (u: UpdateDraft) => `u:${u.line}:${u.op}:${u.iid}`;
  const byIid = useMemo(() => new Map(items.map((i) => [i.iid, i])), [items]);
  const updates = parsed.updates.map((u) => ({ u, item: byIid.get(u.iid), problem: updateProblem(u, byIid.get(u.iid)) }));

  // Validate @usernames against GitLab (debounced).
  useEffect(() => {
    const names = [...new Set(drafts.map((d) => d.assignee).filter(Boolean) as string[])];
    const t = setTimeout(async () => {
      const bad = new Set<string>();
      for (const n of names) {
        const u = await svc.gl.userByUsername(n).catch(() => null);
        if (!u) bad.add(n);
      }
      setUnknown(bad);
    }, 500);
    return () => clearTimeout(t);
  }, [drafts, svc]);

  const selected = drafts.filter((d) => !skip.has(key(d)));
  // Updates with an error are skipped unless the user ticks them explicitly.
  const isOn = (x: (typeof updates)[number]) => (x.problem?.level === 'err' ? skip.has(`force:${ukey(x.u)}`) : !skip.has(ukey(x.u)));
  const selectedUpdates = updates.filter(isOn).map((x) => x.u);
  const toggle = (k: string) => {
    const s = new Set(skip);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    setSkip(s);
  };
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    if (!f.title.trim()) return toast('Give the meeting a title', 'err');
    const res = await run('', () => svc.captureMeeting(f, selected, setProgress, selectedUpdates));
    setProgress('');
    if (!res) return;
    toast(`Meeting saved: ${res.created.length} new, ${res.updated.length} updated`);
    if (res.errors.length) toast(`Saved, but ${res.errors.length} item(s) failed: ${res.errors.join('; ')}`, 'err');
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      /* ignore */
    }
    setF(empty);
    setSkip(new Set());
    await reload();
    go('meetings');
    openItem(res.meetingIid);
  };

  return (
    <div className="capture">
      <div className="capture-form">
        <div className="field-row">
          <label className="grow">
            Meeting
            <input value={f.title} onChange={set('title')} placeholder="e.g. Architecture Board" autoFocus />
          </label>
          <label>
            Date
            <input type="date" value={f.date} onChange={set('date')} />
          </label>
        </div>
        <label>
          Attendees
          <input value={f.attendees} onChange={set('attendees')} placeholder="Anna, Jonas, @sofia.ricci…" />
        </label>
        <label className="grow">
          Notes
          <textarea value={f.notes} onChange={set('notes')} placeholder={PLACEHOLDER} spellCheck={false} />
        </label>
        <div className="hint">
          Keywords: <code>ACTION</code> <code>TODO</code> <code>ask</code> · <code>DECISION</code> · <code>STANDARD</code> — <code>@user</code> assigns ·{' '}
          <code>due:</code> accepts <code>fri</code> <code>+3d</code> <code>2w</code> <code>eow</code> <code>15.12</code> <code>2026-12-15</code>. Actions without a date
          get a follow-up in {svc.settings.defaultFollowUpDays} days. Existing items: <code>- [x] #7</code> or <code>DONE #7</code> · <code>UPDATE #7: text</code> ·{' '}
          <code>PUSH #7 due:fri</code> · <code>DROP #7</code> · <code>ADOPTED #14 Crew</code>. Notes autosave in this browser.
        </div>
      </div>
      <div className="capture-preview">
        <h3>
          Will create <span className="count">{selected.length}</span>
        </h3>
        {!drafts.length && <div className="empty small">New items appear here as you type.</div>}
        {drafts.map((d) => {
          const k = key(d);
          const off = skip.has(k);
          const bad = d.assignee && unknown.has(d.assignee);
          return (
            <label key={k} className={`draft ${off ? 'off' : ''} ${bad ? 'bad' : ''}`}>
              <input
                type="checkbox"
                checked={!off}
                onChange={() => {
                  const s = new Set(skip);
                  if (off) s.delete(k);
                  else s.add(k);
                  setSkip(s);
                }}
              />
              <div className="draft-body">
                <div>
                  <KindTag kind={d.type} /> {d.title}
                </div>
                <div className="row-meta">
                  {d.type !== 'decision' && <span className={bad ? 'err' : ''}>→ {d.assignee ? `@${d.assignee}` : 'me'}{bad ? ' (unknown user)' : ''}</span>}
                  {d.due && <span>due {humanDue(d.due, today)} ({d.due})</span>}
                  {d.details && <span className="muted">+ details</span>}
                  <span className="muted">line {d.line}</span>
                </div>
              </div>
            </label>
          );
        })}
        {updates.length > 0 && (
          <>
            <h3 className="preview-sub">
              Will update <span className="count">{selectedUpdates.length}</span>
            </h3>
            {updates.map((x) => {
              const k = ukey(x.u);
              const on = isOn(x);
              const note = updateNote(x.u.text, x.item?.title);
              return (
                <label key={k} className={`draft ${on ? '' : 'off'} ${x.problem?.level === 'err' ? 'bad' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(x.problem?.level === 'err' ? `force:${k}` : k)} />
                  <div className="draft-body">
                    <div>
                      <span className={`op op-${x.u.op}`}>{UPDATE_LABEL[x.u.op]}</span> <span className="ref">#{x.u.iid}</span>{' '}
                      {x.item?.title ?? <span className="muted">unknown item</span>}
                    </div>
                    <div className="row-meta">
                      {x.u.due && <span>follow-up → {humanDue(x.u.due, today)} ({x.u.due})</span>}
                      {x.u.assignee && <span>→ @{x.u.assignee}</span>}
                      {note && <span className="muted">“{note}”</span>}
                      {x.problem && <span className={x.problem.level === 'err' ? 'err' : 'warn-txt'}>{x.problem.msg}</span>}
                      <span className="muted">line {x.u.line}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </>
        )}
        <div className="capture-actions">
          {progress && <span className="muted">{progress}</span>}
          <button className="ghost" onClick={() => {
              if (confirmClear()) {
                setF(empty);
                setSkip(new Set());
              } else toast('Click Clear again to discard these notes');
            }}>
            Clear
          </button>
          <button className="primary" onClick={save} disabled={!f.title.trim() || Boolean(progress)} title={!f.title.trim() ? 'Give the meeting a title' : ''}>
            Save to GitLab
          </button>
        </div>
      </div>
    </div>
  );
}

function confirmClear() {
  // window.confirm would block automation; a second click within 3s confirms instead.
  const w = window as unknown as { __clearAt?: number };
  const now = Date.now();
  if (w.__clearAt && now - w.__clearAt < 3000) {
    w.__clearAt = 0;
    return true;
  }
  w.__clearAt = now;
  return false;
}
