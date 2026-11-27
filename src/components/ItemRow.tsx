import type { Item } from '../lib/model';
import { addDays } from '../lib/dates';
import { useApp } from './ctx';
import { Avatar, Due, KindTag } from './ui';

export function ItemRow({ item, showKind = true, showMeeting = true, siblings }: { item: Item; showKind?: boolean; showMeeting?: boolean; siblings?: number[] }) {
  const { openItem, openFull, selected, today, me, svc, upsert, run } = useApp();
  const waiting = item.assignee && item.assignee.username !== me;

  const quick = (e: React.MouseEvent, fn: () => Promise<Item | null | undefined>, label: string) => {
    e.stopPropagation();
    run(label, fn).then((r) => upsert(r ?? undefined));
  };

  return (
    <div
      className={`row ${item.open || item.kind === 'decision' ? '' : 'row-closed'}${selected === item.iid ? ' row-sel' : ''}`}
      onClick={() => openItem(item, siblings)}
      onDoubleClick={() => openFull(item.iid)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === ' ') { e.preventDefault(); openItem(item, siblings); }
        if (e.key === 'Enter') { e.preventDefault(); openFull(item.iid); }
      }}
      role="button"
      tabIndex={0}
      data-iid={item.iid}
    >
      {(item.kind === 'action' || item.kind === 'adoption') && (
        <button
          className={`check ${item.open ? '' : 'checked'}`}
          title={item.open ? (item.kind === 'adoption' ? 'Mark adopted' : 'Mark done') : 'Reopen'}
          onClick={(e) =>
            quick(e, () => (item.open ? svc.close(item) : svc.reopen(item)), item.open ? (item.kind === 'adoption' ? 'Adopted' : 'Done') : 'Reopened')
          }
        >
          {item.open ? '' : '✓'}
        </button>
      )}
      {showKind && item.kind !== 'action' && item.kind !== 'adoption' && <KindTag kind={item.kind} />}
      <div className="row-main">
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          <span className="ref">#{item.iid}</span>
          {showMeeting && item.meetingIid && <span className="muted">from meeting #{item.meetingIid}</span>}
          {item.notesCount > 0 && <span className="muted">💬 {item.notesCount}</span>}
          {item.kind === 'adoption' && <span className="kind kind-adoption">Adoption · {item.adoption?.team ?? '?'}</span>}
          {item.adoption?.outcome && <span className="muted">{item.adoption.outcome}</span>}
          {item.newStandard && <span className="kind kind-standard">Standard to write</span>}
        </div>
      </div>
      {(item.kind === 'action' || item.kind === 'adoption') && (
        <>
          {item.open && (
            <span className="row-actions">
              <button className="ghost xs" title="Push 1 day" onClick={(e) => quick(e, () => svc.setDue(item, addDays(today, 1)), 'Snoozed to tomorrow')}>
                +1d
              </button>
              <button className="ghost xs" title="Push 1 week" onClick={(e) => quick(e, () => svc.setDue(item, addDays(today, 7)), 'Snoozed 1 week')}>
                +1w
              </button>
            </span>
          )}
          <Due item={item} today={today} />
          <span className={waiting ? 'who waiting' : 'who'}>
            <Avatar user={item.assignee ?? item.author} />
          </span>
        </>
      )}
      {item.kind === 'decision' && <span className="muted small">{item.createdAt.slice(0, 10)}</span>}
    </div>
  );
}

export function ItemList({ items, empty, ...rest }: { items: Item[]; empty?: string; showKind?: boolean; showMeeting?: boolean }) {
  if (!items.length) return <div className="empty small">{empty ?? 'Nothing here.'}</div>;
  const siblings = items.map((i) => i.iid);
  return (
    <div className="list">
      {items.map((i) => (
        <ItemRow key={i.iid} item={i} siblings={siblings} {...rest} />
      ))}
    </div>
  );
}
