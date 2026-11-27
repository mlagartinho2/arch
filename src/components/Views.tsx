import { useMemo, useState } from 'react';
import { byDue, isDueSoon, isMine, isOverdue, isTrackable, isWaiting, type Item } from '../lib/model';
import { addDays, humanDue } from '../lib/dates';
import { useApp } from './ctx';
import { seriesName } from '../lib/prep';
import { ItemList } from './ItemRow';
import { Avatar, Empty, Section, copyText } from './ui';

function useTrackable() {
  const { items } = useApp();
  return useMemo(() => items.filter(isTrackable).sort(byDue), [items]);
}

export function FocusView() {
  const { today, me, items, go } = useApp();
  const open = useTrackable();
  const overdue = open.filter((i) => isOverdue(i, today));
  const dueToday = open.filter((i) => i.due === today);
  const soon = open.filter((i) => i.due && i.due > today && isDueSoon(i, today, 7));
  const undated = open.filter((i) => !i.due);
  const decisions30 = items.filter((i) => i.kind === 'decision' && i.createdAt.slice(0, 10) >= addDays(today, -30)).length;
  const adopting = items.filter((i) => i.kind === 'adoption' && i.open).length;

  return (
    <>
      <div className="stats">
        <button className="stat" onClick={() => go('mine')}>
          <b>{open.filter((i) => isMine(i, me)).length}</b>
          <span>on my plate</span>
        </button>
        <button className="stat" onClick={() => go('waiting')}>
          <b>{open.filter((i) => isWaiting(i, me)).length}</b>
          <span>waiting on others</span>
        </button>
        <button className={`stat ${overdue.length ? 'stat-alert' : ''}`}>
          <b>{overdue.length}</b>
          <span>overdue</span>
        </button>
        <button className="stat" onClick={() => go('standards')}>
          <b>{adopting}</b>
          <span>adoptions open</span>
        </button>
        <button className="stat" onClick={() => go('decisions')}>
          <b>{decisions30}</b>
          <span>decisions, last 30d</span>
        </button>
      </div>
      {overdue.length + dueToday.length + soon.length === 0 && <Empty>Nothing due this week. Enjoy it.</Empty>}
      {overdue.length > 0 && (
        <Section title="Overdue" count={overdue.length}>
          <ItemList items={overdue} />
        </Section>
      )}
      {dueToday.length > 0 && (
        <Section title="Follow up today" count={dueToday.length}>
          <ItemList items={dueToday} />
        </Section>
      )}
      {soon.length > 0 && (
        <Section title="Next 7 days" count={soon.length}>
          <ItemList items={soon} />
        </Section>
      )}
      {undated.length > 0 && (
        <Section title="No follow-up date" count={undated.length}>
          <ItemList items={undated} />
        </Section>
      )}
    </>
  );
}

export function MineView() {
  const { me } = useApp();
  const open = useTrackable().filter((i) => isMine(i, me));
  return (
    <Section title="On my plate" count={open.length}>
      <ItemList items={open} empty="Nothing assigned to you." />
    </Section>
  );
}

export function WaitingView() {
  const { me, today, toast, svc, prepare } = useApp();
  const open = useTrackable().filter((i) => isWaiting(i, me));
  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of open) m.set(i.assignee!.username, [...(m.get(i.assignee!.username) ?? []), i]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [open]);

  const digest = (list: [string, Item[]][]) =>
    list
      .map(
        ([u, its]) =>
          `**@${u}**\n` +
          its
            .map((i) => `- ${svc.project.path_with_namespace}#${i.iid} ${i.title}${i.due ? ` — ${humanDue(i.due, today)}` : ''}`)
            .join('\n'),
      )
      .join('\n\n');

  if (!open.length) return <Empty>Nobody owes you anything right now.</Empty>;
  return (
    <>
      <div className="toolbar">
        <span className="muted">Grouped by person — handy before 1:1s and crew syncs.</span>
        <button className="ghost" onClick={async () => (await copyText(digest(groups))) && toast('Digest copied as markdown')}>
          Copy full digest
        </button>
      </div>
      {groups.map(([u, its]) => (
        <Section
          key={u}
          title={its[0].assignee!.name}
          count={its.length}
          actions={
            <span className="section-actions">
              <Avatar user={its[0].assignee} />
              <button className="ghost xs" onClick={() => prepare({ title: `1:1 ${its[0].assignee!.name}`, attendees: [u] })}>
                Prepare 1:1
              </button>
              <button className="ghost xs" onClick={async () => (await copyText(digest([[u, its]]))) && toast(`Copied list for @${u}`)}>
                Copy list
              </button>
            </span>
          }
        >
          <ItemList items={its} />
        </Section>
      ))}
    </>
  );
}

export function DecisionsView() {
  const { items } = useApp();
  const [q, setQ] = useState('');
  const list = items
    .filter((i) => i.kind === 'decision')
    .filter((i) => !q || `${i.title} ${i.description}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const byMonth = new Map<string, Item[]>();
  for (const d of list) {
    const k = new Date(d.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    byMonth.set(k, [...(byMonth.get(k) ?? []), d]);
  }
  return (
    <>
      <div className="toolbar">
        <input className="search" placeholder="Search decisions…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!list.length && <Empty>{q ? 'No matching decisions.' : 'No decisions recorded yet. Capture a meeting to start the log.'}</Empty>}
      {[...byMonth.entries()].map(([m, its]) => (
        <Section key={m} title={m} count={its.length}>
          <ItemList items={its} showKind={false} />
        </Section>
      ))}
    </>
  );
}

export function MeetingsView() {
  const { items, openItem, prepare } = useApp();
  const meetings = items.filter((i) => i.kind === 'meeting').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!meetings.length) return <Empty>No meetings captured yet.</Empty>;
  return (
    <div className="list">
      {meetings.map((m) => {
        const out = items.filter((i) => i.meetingIid === m.iid);
        const openCount = out.filter((i) => i.open && i.kind !== 'decision').length;
        return (
          <div className="row" key={m.iid} onClick={() => openItem(m)} role="button" tabIndex={0}>
            <div className="row-main">
              <div className="row-title">{m.title}</div>
              <div className="row-meta">
                <span className="ref">#{m.iid}</span>
                <span className="muted">
                  {(['decision', 'action'] as const)
                    .map((k) => [k, out.filter((i) => i.kind === k).length] as const)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
                    .join(' · ') || 'no items'}
                </span>
              </div>
            </div>
            {openCount > 0 ? <span className="pill warn">{openCount} open</span> : out.length > 0 && <span className="pill ok">all closed</span>}
            <button
              className="ghost xs row-actions-btn"
              onClick={(e) => {
                e.stopPropagation();
                prepare({ title: seriesName(m.title) });
              }}
            >
              Prepare next
            </button>
          </div>
        );
      })}
    </div>
  );
}
