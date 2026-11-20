import { useEffect, useMemo, useState } from 'react';
import type { Item } from '../lib/model';
import { agendaMarkdown, agendaNotes, buildPrep, listSeries, meetingAttendeesText, meetingDate, resolveAttendees, seriesKey } from '../lib/prep';
import { useApp, type PrepPreset } from './ctx';
import { hasUnsavedCapture, saveCaptureDraft } from './Capture';
import { Avatar, Due, Empty, KindTag, copyText } from './ui';

export function Prepare({ preset }: { preset?: PrepPreset }) {
  const { items, userMap, me, today, svc, go, openItem, run, toast } = useApp();
  const users = useMemo(() => [...userMap.values()], [userMap]);
  const series = useMemo(() => listSeries(items), [items]);

  const [title, setTitle] = useState(preset?.title ?? '');
  const [date, setDate] = useState(today);
  const [attendees, setAttendees] = useState<string[]>(preset?.attendees ?? []);
  const [guests, setGuests] = useState<string[]>([]);
  const [crews, setCrews] = useState<string[]>(preset?.crews ?? []);
  const [topics, setTopics] = useState('');
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [who, setWho] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);

  const matched = series.find((s) => s.key === seriesKey(title));

  // Picking a recurring meeting fills in who was at its last session.
  useEffect(() => {
    if (!matched || attendees.length || guests.length) return;
    const r = resolveAttendees(meetingAttendeesText(matched.sessions[0]), users);
    setAttendees(r.usernames.filter((u) => u !== me));
    setGuests(r.unresolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched?.key]);

  const prep = useMemo(() => buildPrep(items, { title, attendees, crews, me, users }), [items, title, attendees, crews, me, users]);
  const name = (u: string) => userMap.get(u)?.name ?? u;
  const opts = {
    title: matched?.name ?? title.trim(),
    date,
    attendeeNames: [...attendees.map(name), ...guests],
    topics,
    today,
    projectPath: svc.project.path_with_namespace,
    excluded,
  };
  const total = prep.sections.reduce((n, s) => n + s.items.filter((i) => !excluded.has(i.iid)).length, 0);

  const addPeople = (text: string) => {
    const r = resolveAttendees(text, users);
    setAttendees([...new Set([...attendees, ...r.usernames.filter((u) => u !== me)])]);
    setGuests([...new Set([...guests, ...r.unresolved])]);
    setWho('');
  };
  const toggle = (iid: number) => {
    const s = new Set(excluded);
    if (s.has(iid)) s.delete(iid);
    else s.add(iid);
    setExcluded(s);
  };

  const startNotes = () => {
    if (hasUnsavedCapture() && !confirmReplace) {
      setConfirmReplace(true);
      toast('The capture screen has unsaved notes. Click again to replace them.', 'err');
      return;
    }
    saveCaptureDraft({ title: opts.title, date, attendees: opts.attendeeNames.join(', '), notes: agendaNotes(prep, opts) });
    go('capture');
  };

  return (
    <div className="prepare">
      <div className="prep-form">
        <label>
          Meeting
          <input list="series" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recurring meeting, or e.g. “1:1 Anna”" autoFocus={!preset} />
          <datalist id="series">
            {series.map((s) => (
              <option key={s.key} value={s.name} />
            ))}
          </datalist>
        </label>
        <div className="hint">
          {matched ? (
            <>
              Recurring · {matched.sessions.length} earlier session{matched.sessions.length === 1 ? '' : 's'}, last{' '}
              <a href="#" onClick={(e) => (e.preventDefault(), openItem(matched.sessions[0]))}>
                {meetingDate(matched.sessions[0])}
              </a>
            </>
          ) : title.trim() ? (
            'No earlier sessions with this name; matching on attendees only.'
          ) : (
            'Pick a meeting you captured before to carry its open items over.'
          )}
        </div>
        <label>
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          Attendees
          <div className="chips">
            {attendees.map((u) => (
              <span className="chip" key={u}>
                <Avatar user={userMap.get(u)} size={18} /> {name(u)}
                <button className="chip-x" onClick={() => setAttendees(attendees.filter((x) => x !== u))} aria-label={`Remove ${name(u)}`}>
                  ×
                </button>
              </span>
            ))}
            {guests.map((g) => (
              <span className="chip guest" key={g} title="Not matched to a GitLab user">
                {g}
                <button className="chip-x" onClick={() => setGuests(guests.filter((x) => x !== g))} aria-label={`Remove ${g}`}>
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
                  addPeople(who);
                }
                if (e.key === 'Backspace' && !who && attendees.length) setAttendees(attendees.slice(0, -1));
              }}
              onBlur={() => who.trim() && addPeople(who)}
              placeholder={attendees.length + guests.length ? 'Add…' : 'Name or username, Enter'}
            />
          </div>
        </label>
        {svc.settings.crews.length > 0 && (
          <label>
            Crews in the room <span className="muted">(adds their pending standards)</span>
            <div className="crew-picks">
              {svc.settings.crews.map((c) => (
                <label key={c.name} className="crew-row">
                  <input
                    type="checkbox"
                    checked={crews.includes(c.name)}
                    onChange={() => setCrews(crews.includes(c.name) ? crews.filter((x) => x !== c.name) : [...crews, c.name])}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </label>
        )}
        <label>
          Other topics
          <textarea rows={4} value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="One per line" />
        </label>
      </div>

      <div className="prep-main">
        {!title.trim() && !attendees.length ? (
          <Empty>Pick a meeting or add attendees to see what's open with them.</Empty>
        ) : prep.sections.every((s) => !s.items.length) ? (
          <Empty>Nothing open with these people right now. Add topics on the left and start the notes.</Empty>
        ) : (
          prep.sections.filter((s) => s.items.length).map((s) => (
            <section className="section" key={s.id}>
              <header>
                <h3>
                  {s.title}
                  <span className="count">{s.items.length}</span>
                </h3>
                <span className="muted small">{s.hint}</span>
              </header>
              <div className="list">
                {s.items.map((i) => (
                  <PrepRow key={i.iid} item={i} on={!excluded.has(i.iid)} onToggle={() => toggle(i.iid)} />
                ))}
              </div>
            </section>
          ))
        )}
        <div className="prep-actions">
          <span className="muted small">
            {total} item{total === 1 ? '' : 's'} on the agenda
          </span>
          <button
            className="ghost"
            disabled={!opts.title}
            onClick={async () => (await copyText(agendaMarkdown(prep, opts))) && toast('Agenda copied as markdown')}
          >
            Copy agenda
          </button>
          {prep.lastSession && (
            <button
              className="ghost"
              title="Posts the agenda as a comment on the last session. People @mentioned in it get a GitLab notification."
              onClick={() =>
                run(`Agenda posted on #${prep.lastSession!.iid}`, () =>
                  svc.postAgenda(prep.lastSession!.iid, `**Agenda for the next session**\n\n${agendaMarkdown(prep, opts)}`),
                )
              }
            >
              Post on last session
            </button>
          )}
          <button className="primary" disabled={!opts.title} onClick={startNotes}>
            {confirmReplace ? 'Replace unsaved notes →' : 'Start meeting notes →'}
          </button>
        </div>
      </div>
    </div>
  );
}

function PrepRow({ item, on, onToggle }: { item: Item; on: boolean; onToggle: () => void }) {
  const { openItem, today } = useApp();
  const pending = item.std?.adoption.filter((a) => !a.done).map((a) => a.name) ?? [];
  return (
    <div className={`row ${on ? '' : 'row-off'}`}>
      <input type="checkbox" checked={on} onChange={onToggle} aria-label="Include on agenda" />
      {item.kind !== 'action' && <KindTag kind={item.kind} />}
      <div className="row-main" onClick={() => openItem(item)} role="button" tabIndex={0}>
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          <span className="ref">#{item.iid}</span>
          {item.std && <span className="muted">{pending.length ? `pending: ${pending.join(', ')}` : 'all crews adopted'}</span>}
        </div>
      </div>
      {item.kind === 'action' && (
        <>
          <Due item={item} today={today} />
          <Avatar user={item.assignee ?? item.author} />
        </>
      )}
    </div>
  );
}
