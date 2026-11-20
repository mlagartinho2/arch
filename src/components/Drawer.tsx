import { useEffect, useState } from 'react';
import type { GlNote } from '../lib/gitlab';
import { meetingUpdates, slugify, type Item } from '../lib/model';
import { seriesName } from '../lib/prep';
import { addDays } from '../lib/dates';
import { useApp } from './ctx';
import { ItemList } from './ItemRow';
import { Avatar, Due, KindTag, Progress, STD_LABEL_TEXT, STD_STEPS } from './ui';

function cleanDescription(d: string) {
  return d
    .replace(/^## Notes\s*$/m, '')
    .replace(/\*\*(\w+):\*\*/g, '$1:')
    .replace(/ {2}$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/<!-- fu:[^>]*-->\n?/g, '')
    .replace(/^From meeting #\d+\s*\n*/m, '')
    .trim();
}

function sectionText(desc: string, name: string) {
  const m = desc.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |<!-- fu:|$(?![\\s\\S]))`, 'm'));
  return m?.[1].trim() ?? '';
}

function docTemplate(it: Item, me: string, ref: string) {
  const summary = sectionText(it.description, 'Summary').replace(/^_To be written._$/, '');
  return `# ${it.title}

| | |
|---|---|
| Status | Proposed |
| Owner | @${it.assignee?.username ?? me} |
| Tracking | ${ref} |
| Adoption deadline | ${it.due ?? 'TBD'} |

## Context
${summary || 'Why this standard exists and what problem it solves.'}

## The standard
- Crews **MUST** …
- Crews **SHOULD** …

## Rationale

## Examples

## How to adopt
1. …
`;
}

export function Drawer({ item, onClose }: { item: Item; onClose: () => void }) {
  const app = useApp();
  const { svc, today, me, items, upsert, run, openItem, toast, prepare } = app;
  const [notes, setNotes] = useState<GlNote[] | null>(null);
  const [note, setNote] = useState('');
  const [title, setTitle] = useState(item.title);
  const [assignee, setAssignee] = useState(item.assignee?.username ?? '');
  const [nudgeMsg, setNudgeMsg] = useState('Friendly follow-up on this one — any update?');
  const [crewMsg, setCrewMsg] = useState('');
  const [newCrew, setNewCrew] = useState('');
  const [docPath, setDocPath] = useState('');
  const [doc, setDoc] = useState('');
  const [mrInfo, setMrInfo] = useState<{ state?: string; url?: string }>({});

  const ref = `${svc.project.path_with_namespace}#${item.iid}`;

  useEffect(() => {
    setTitle(item.title);
    setAssignee(item.assignee?.username ?? '');
    setNotes(null);
    setMrInfo({});
    setDocPath(`${svc.settings.standardsFolder.replace(/\/+$/, '')}/${slugify(item.title)}.md`);
    setDoc(item.kind === 'standard' ? docTemplate(item, me, ref) : '');
    setCrewMsg(
      `Reminder: the standard **${item.title}** is published and your crew hasn't confirmed adoption yet.` +
        (item.due ? ` Target date: ${item.due}.` : '') +
        ' Reply here once done or if you need help.',
    );
    svc.notes(item).then(setNotes).catch(() => setNotes([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.iid]);

  useEffect(() => {
    if (item.kind === 'standard' && item.std?.mr && item.std.status === 'review') {
      svc
        .syncStandard(item)
        .then((r) => {
          setMrInfo({ state: r.mrState, url: r.mrUrl });
          if (r.item !== item) {
            upsert(r.item);
            toast('Merge request merged — standard is now published');
          }
        })
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.iid, item.std?.status]);

  const act = async (label: string, fn: () => Promise<Item | null | undefined>) => {
    const r = await run(label, fn);
    if (r) upsert(r);
  };
  const refreshNotes = () => svc.notes(item).then(setNotes);

  const meeting = item.meetingIid ? items.find((i) => i.iid === item.meetingIid) : undefined;
  const outcomes = item.kind === 'meeting' ? items.filter((i) => i.meetingIid === item.iid) : [];
  const trackable = item.kind === 'action' || item.kind === 'standard';
  const waiting = item.assignee && item.assignee.username !== me;
  const std = item.std;

  return (
    <aside className="drawer">
      <header className="drawer-head">
        <KindTag kind={item.kind} />
        <a href={item.webUrl} target="_blank" rel="noreferrer" className="ref">
          {ref} ↗
        </a>
        <span className={item.open ? 'pill ok' : 'pill'}>{item.open ? 'open' : 'closed'}</span>
        <button className="ghost close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <input
        className="drawer-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== item.title && act('Renamed', () => svc.rename(item, title.trim()))}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />

      {meeting && (
        <div className="muted small">
          From{' '}
          <a href="#" onClick={(e) => (e.preventDefault(), openItem(meeting))}>
            {meeting.title}
          </a>
        </div>
      )}

      {trackable && (
        <div className="props">
          <div className="prop">
            <span>Owner</span>
            <div className="prop-val">
              <Avatar user={item.assignee} />
              <input
                list="users"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && assignee.replace('@', '') !== item.assignee?.username) {
                    act('Reassigned', () => svc.assign(item, assignee.replace('@', '') || undefined));
                  }
                }}
                placeholder="username, Enter to assign"
              />
            </div>
          </div>
          <div className="prop">
            <span>Follow up</span>
            <div className="prop-val">
              <Due item={item} today={today} />
              <input type="date" value={item.due ?? ''} onChange={(e) => act('Date set', () => svc.setDue(item, e.target.value || null))} />
              {[
                ['today', 0],
                ['+1d', 1],
                ['+3d', 3],
                ['+1w', 7],
                ['+2w', 14],
              ].map(([l, n]) => (
                <button key={l} className="ghost xs" onClick={() => act(`Follow-up ${l}`, () => svc.setDue(item, addDays(today, n as number)))}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="prop">
            <span>State</span>
            <div className="prop-val">
              {item.open ? (
                <button className="primary sm" onClick={() => act('Marked done', () => svc.close(item))}>
                  ✓ Mark done
                </button>
              ) : (
                <button className="ghost sm" onClick={() => act('Reopened', () => svc.reopen(item))}>
                  Reopen
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {item.kind === 'decision' && (
        <div className="muted small">
          Recorded {item.createdAt.slice(0, 10)} by {item.author.name}.{' '}
          {item.open ? (
            <a href="#" onClick={(e) => (e.preventDefault(), act('Closed', () => svc.close(item)))}>
              Close
            </a>
          ) : (
            <a href="#" onClick={(e) => (e.preventDefault(), act('Reopened', () => svc.reopen(item)))}>
              Reopen
            </a>
          )}
        </div>
      )}

      {waiting && item.open && item.kind === 'action' && (
        <div className="box">
          <h4>Nudge @{item.assignee!.username}</h4>
          <textarea rows={2} value={nudgeMsg} onChange={(e) => setNudgeMsg(e.target.value)} />
          <div className="box-actions">
            <span className="muted small">Posts a GitLab comment mentioning them and moves the follow-up to +3 days.</span>
            <button
              className="primary sm"
              onClick={async () => {
                await act(`Nudged @${item.assignee!.username}`, () => svc.nudge(item, nudgeMsg));
                refreshNotes();
              }}
            >
              Nudge
            </button>
          </div>
        </div>
      )}

      {std && (
        <>
          <div className="stepper">
            {STD_STEPS.map((s, i) => (
              <span key={s} className={`step ${s === std.status ? 'cur' : STD_STEPS.indexOf(std.status) > i ? 'done' : ''}`}>
                {STD_LABEL_TEXT[s]}
              </span>
            ))}
          </div>

          {std.status === 'draft' && (
            <div className="box">
              <h4>Publish the document</h4>
              {!svc.settings.standardsProject ? (
                <div className="muted small">Set a standards repository in Settings to publish from here.</div>
              ) : (
                <>
                  <label>
                    <span>
                      File in <code>{svc.settings.standardsProject}</code>
                    </span>
                    <input value={docPath} onChange={(e) => setDocPath(e.target.value)} />
                  </label>
                  <textarea className="doc" rows={14} value={doc} onChange={(e) => setDoc(e.target.value)} spellCheck={false} />
                  <div className="box-actions">
                    <span className="muted small">Creates a branch + merge request. When it's merged the standard moves to “Adopting”.</span>
                    <button
                      className="primary sm"
                      onClick={async () => {
                        const r = await run('Merge request opened', () => svc.publishStandard(item, docPath, doc));
                        if (r) {
                          upsert(r.item);
                          setMrInfo({ state: r.mr.state, url: r.mr.web_url });
                          refreshNotes();
                        }
                      }}
                    >
                      Open merge request
                    </button>
                  </div>
                  <button className="link small" onClick={() => act('Marked as published', () => svc.setStdStatus(item, 'published'))}>
                    Already published elsewhere? Skip to adoption
                  </button>
                </>
              )}
            </div>
          )}

          {std.status === 'review' && (
            <div className="box">
              <h4>In review</h4>
              <div className="small">
                Merge request {mrInfo.url ? <a href={mrInfo.url} target="_blank" rel="noreferrer">{mrInfo.url}</a> : '…'} is{' '}
                <b>{mrInfo.state ?? 'being checked'}</b>.
              </div>
              <div className="box-actions">
                <button
                  className="ghost sm"
                  onClick={async () => {
                    const r = await run('Checked', () => svc.syncStandard(item));
                    if (r) {
                      setMrInfo({ state: r.mrState, url: r.mrUrl });
                      upsert(r.item);
                    }
                  }}
                >
                  Check MR status
                </button>
                <button className="ghost sm" onClick={() => act('Marked as published', () => svc.setStdStatus(item, 'published'))}>
                  Mark published
                </button>
              </div>
            </div>
          )}

          <div className="box">
            <h4>
              Crew adoption <Progress done={std.adoption.filter((a) => a.done).length} total={std.adoption.length} />
            </h4>
            {std.adoption.map((a) => (
              <label key={a.name} className="crew-row">
                <input type="checkbox" checked={a.done} onChange={() => act(`${a.name} ${a.done ? 'unmarked' : 'adopted'}`, () => svc.toggleAdoption(item, a.name, !a.done))} />
                {a.name}
              </label>
            ))}
            <div className="inline-form">
              <input value={newCrew} onChange={(e) => setNewCrew(e.target.value)} placeholder="Add crew…" />
              <button
                className="ghost sm"
                disabled={!newCrew.trim()}
                onClick={async () => {
                  const c = svc.settings.crews.find((x) => x.name === newCrew.trim());
                  await act('Crew added', () => svc.addCrew(item, newCrew.trim(), c?.handle));
                  setNewCrew('');
                }}
              >
                Add
              </button>
            </div>
            {std.status === 'published' && std.adoption.some((a) => !a.done) && (
              <>
                <textarea rows={3} value={crewMsg} onChange={(e) => setCrewMsg(e.target.value)} />
                <div className="box-actions">
                  <span className="muted small">Mentions the GitLab handles of crews that haven't adopted (configure handles in Settings).</span>
                  <button
                    className="primary sm"
                    onClick={async () => {
                      const n = await run('', () => svc.notifyCrews(item, crewMsg));
                      if (n !== undefined) {
                        toast(n ? `Notified ${n} crew(s)` : 'Comment posted (no crew handles configured)');
                        refreshNotes();
                      }
                    }}
                  >
                    Notify pending crews
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      )}

      {item.kind === 'meeting' && (
        <>
          <button className="primary sm self-start" onClick={() => prepare({ title: seriesName(item.title) })}>
            Prepare next session →
          </button>
          <div className="box">
            <h4>Outcomes</h4>
            <ItemList items={outcomes} showMeeting={false} empty="No items were created in this meeting." />
          </div>
          {meetingUpdates(item.description).length > 0 && (
            <div className="box">
              <h4>Updated in this meeting</h4>
              <div className="list">
                {meetingUpdates(item.description).map((u) => {
                  const it = items.find((i) => i.iid === u.iid);
                  return (
                    <div className="row" key={u.iid} onClick={() => it && openItem(it)} role="button" tabIndex={0}>
                      <div className="row-main">
                        <div className="row-title">{it?.title ?? u.title}</div>
                        <div className="row-meta">
                          <span className="ref">#{u.iid}</span>
                          <span>{u.summary}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {cleanDescription(item.description) && item.kind !== 'standard' && (
        <div className="box">
          <h4>{item.kind === 'meeting' ? 'Notes' : 'Details'}</h4>
          <pre className="desc">{cleanDescription(item.description.replace(/\n## Outcomes[\s\S]*$/, ''))}</pre>
        </div>
      )}

      <div className="box">
        <h4>Activity</h4>
        <div className="inline-form">
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. “discussed with Anna in the hallway, waiting for budget”)" />
          <button
            className="ghost sm"
            disabled={!note.trim()}
            onClick={async () => {
              await run('Note added', () => svc.addNote(item, note.trim()));
              setNote('');
              refreshNotes();
            }}
          >
            Add
          </button>
        </div>
        {notes === null && <div className="muted small">Loading…</div>}
        {notes?.filter((n) => !n.system).map((n) => (
          <div className="note" key={n.id}>
            <div className="note-head">
              <Avatar user={n.author} size={18} /> <b>{n.author.name}</b> <span className="muted">{new Date(n.created_at).toLocaleString()}</span>
            </div>
            <pre className="desc">{n.body}</pre>
          </div>
        ))}
      </div>
    </aside>
  );
}
