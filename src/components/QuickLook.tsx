/* Read-only quick look beside a list. It reads, ticks tasks, snoozes and closes; writing happens full screen. */
import { useEffect, useMemo, useState } from 'react';
import type { GlNote } from '../lib/gitlab';
import { getMarker, isTrackable, type Item } from '../lib/model';
import { splitMarkers } from '../lib/markers';
import { addDays, daysBetween } from '../lib/dates';
import { seriesName } from '../lib/prep';
import { mdRender } from '../editor/markdown';
import { MarkdownView } from '../editor/parts';
import { useApp } from './ctx';
import { ItemList } from './ItemRow';
import { Avatar, Due, KindTag } from './ui';

const ago = (iso: string, today: string) => {
  const n = daysBetween(iso.slice(0, 10), today);
  return n <= 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`;
};

export function QuickLook({ item, onClose }: { item: Item; onClose: () => void }) {
  const { svc, today, items, upsert, run, openFull, prepare, standards } = useApp();
  const [notes, setNotes] = useState<GlNote[] | null>(null);

  useEffect(() => {
    setNotes(null);
    svc.notes(item).then(setNotes).catch(() => setNotes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.iid, item.updatedAt]);

  const act = async (label: string, fn: () => Promise<Item | null | undefined>) => {
    const r = await run(label, fn);
    if (r) upsert(r);
  };
  const text = useMemo(() => splitMarkers(item.description).text, [item.description]);
  const desc = item.kind === 'meeting' ? text.replace(/\n## Outcomes[\s\S]*$/, '') : text;
  const html = useMemo(() => mdRender(desc, { tasks: true, item: (i) => items.find((x) => x.iid === i) }).html, [desc, items]);
  const meeting = item.meetingIid ? items.find((i) => i.iid === item.meetingIid) : undefined;
  const outcomes = item.kind === 'meeting' ? items.filter((i) => i.meetingIid === item.iid) : [];
  const userNotes = (notes ?? []).filter((n) => !n.system);
  const last = userNotes[0];
  const trackable = isTrackable(item);

  return (
    <aside className="drawer ql" id="quicklook" aria-label="Quick look">
      <header className="drawer-head">
        <KindTag kind={item.kind} />
        <span className="ref">#{item.iid}</span>
        <span className="ql-tag">Quick look · read only</span>
        <button type="button" className="ghost close" onClick={onClose} aria-label="Close (Esc)">
          ✕
        </button>
      </header>

      <h2 className="ql-title">{item.title}</h2>
      <div className="ql-sub">
        {trackable && (
          <>
            <Avatar user={item.assignee} size={20} />
            <span>{item.assignee?.name ?? 'Nobody'}</span>
            <span>·</span>
            <Due item={item} today={today} />
          </>
        )}
        {!trackable && <span>Recorded {item.createdAt.slice(0, 10)} by {item.author.name}</span>}
        {meeting && (
          <span>
            · from{' '}
            <a href="#" onClick={(e) => (e.preventDefault(), openFull(meeting.iid))}>
              {meeting.title}
            </a>
          </span>
        )}
      </div>
      {trackable && (
        <div className="ql-acts">
          {item.open ? (
            <button type="button" className="primary sm" onClick={() => act('Marked done', () => svc.close(item))}>
              ✓ {item.kind === 'adoption' ? 'Mark adopted' : 'Mark done'}
            </button>
          ) : (
            <button type="button" className="ghost sm" onClick={() => act('Reopened', () => svc.reopen(item))}>
              Reopen
            </button>
          )}
          {item.open &&
            ([['+1d', 1], ['+3d', 3], ['+1w', 7]] as const).map(([l, n]) => (
              <button key={l} type="button" className="ghost xs" onClick={() => act(`Follow-up ${l}`, () => svc.setDue(item, addDays(today, n)))}>
                {l}
              </button>
            ))}
        </div>
      )}

      {item.kind === 'meeting' && (
        <div className="box">
          <h4>
            Outcomes
            <button type="button" className="ghost xs" onClick={() => prepare({ title: seriesName(item.title) })}>
              Prepare next session →
            </button>
          </h4>
          <ItemList items={outcomes} showMeeting={false} empty="No items were created in this meeting." />
        </div>
      )}
      {item.kind === 'adoption' && item.adoption && (
        <div className="box">
          <h4>Standard adoption</h4>
          <div className="small">
            Team <b>{item.adoption.team}</b> adopting version <b>{item.adoption.version}</b>
            {item.adoption.outcome ? ` · closed as ${item.adoption.outcome}` : ''}
          </div>
          <button type="button" className="ghost sm self-start" onClick={() => standards({ open: item.adoption!.std })}>
            Open the standard →
          </button>
        </div>
      )}
      {item.newStandard && item.open && (
        <div className="box">
          <h4>Standard to write</h4>
          <button
            type="button"
            className="primary sm self-start"
            onClick={() =>
              standards({
                newFrom: {
                  title: decodeURIComponent(getMarker(item.description, 'newstandard') ?? '') || item.title.replace(/^Write standard:\s*/, ''),
                  summary: text.replace(/^From meeting #\d+\s*/m, '').trim(),
                  fromIid: item.iid,
                },
              })
            }
          >
            Draft this standard →
          </button>
        </div>
      )}

      <div className="ql-desc">
        <h4 className="h4" style={{ marginBottom: 6 }}>{item.kind === 'meeting' ? 'Notes' : 'Description'}</h4>
        {desc.trim() ? (
          <MarkdownView
            className="compact"
            id="ql-desc"
            html={html}
            onRef={(i) => openFull(i)}
            onTask={(line, checked, input) => {
              input.disabled = true;
              run(checked ? 'Task ticked' : 'Task unticked', () => svc.tickTask(item, line, text.split('\n')[line] ?? '', checked)).then((r) => {
                input.disabled = false;
                if (r) upsert(r);
                else input.checked = !checked;
              });
            }}
          />
        ) : (
          <p className="muted small">No description.</p>
        )}
      </div>

      {last && (
        <div>
          <h4 className="h4" style={{ marginBottom: 6 }}>Latest comment</h4>
          <div className="note-head">
            <Avatar user={last.author} size={18} /> <b>{last.author.name}</b> <span className="muted">· {ago(last.created_at, today)}</span>
          </div>
          <MarkdownView className="compact" html={mdRender(last.body, { item: (i) => items.find((x) => x.iid === i) }).html} onRef={(i) => openFull(i)} />
        </div>
      )}
      {userNotes.length > 0 && (
        <button type="button" className="link self-start" onClick={() => openFull(item.iid)}>
          All activity ({userNotes.length})
        </button>
      )}

      <div className="ql-foot">
        <div className="btns">
          <button type="button" className="primary sm" id="ql-open" onClick={() => openFull(item.iid)}>
            Open full screen <kbd>↵</kbd>
          </button>
          <button type="button" className="ghost sm" onClick={() => openFull(item.iid, 'desc')}>
            Edit description <kbd>E</kbd>
          </button>
          <button type="button" className="ghost sm" onClick={() => openFull(item.iid, 'comment')}>
            Comment <kbd>C</kbd>
          </button>
        </div>
        <span className="muted small">↑ ↓ move through the list · Esc closes. Writing happens full screen, with the full editor.</span>
      </div>
    </aside>
  );
}
