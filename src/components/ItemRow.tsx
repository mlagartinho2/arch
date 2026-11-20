import type { Item } from '../lib/model';
import { addDays } from '../lib/dates';
import { useApp } from './ctx';
import { Avatar, Due, KindTag, Progress, STD_LABEL_TEXT } from './ui';

export function ItemRow({ item, showKind = true, showMeeting = true }: { item: Item; showKind?: boolean; showMeeting?: boolean }) {
  const { openItem, today, me, svc, upsert, run } = useApp();
  const waiting = item.assignee && item.assignee.username !== me;
  const doneStd = item.std?.adoption.filter((a) => a.done).length ?? 0;

  const quick = (e: React.MouseEvent, fn: () => Promise<Item | null | undefined>, label: string) => {
    e.stopPropagation();
    run(label, fn).then((r) => upsert(r ?? undefined));
  };

  return (
    <div className={`row ${item.open || item.kind === 'decision' ? '' : 'row-closed'}`} onClick={() => openItem(item)} role="button" tabIndex={0}>
      {item.kind === 'action' && (
        <button
          className={`check ${item.open ? '' : 'checked'}`}
          title={item.open ? 'Mark done' : 'Reopen'}
          onClick={(e) => quick(e, () => (item.open ? svc.close(item) : svc.reopen(item)), item.open ? 'Done' : 'Reopened')}
        >
          {item.open ? '' : '✓'}
        </button>
      )}
      {showKind && item.kind !== 'action' && <KindTag kind={item.kind} />}
      <div className="row-main">
        <div className="row-title">{item.title}</div>
        <div className="row-meta">
          <span className="ref">#{item.iid}</span>
          {showMeeting && item.meetingIid && <span className="muted">from meeting #{item.meetingIid}</span>}
          {item.notesCount > 0 && <span className="muted">💬 {item.notesCount}</span>}
          {item.std && <span className={`std-pill std-${item.std.status}`}>{STD_LABEL_TEXT[item.std.status]}</span>}
        </div>
      </div>
      {item.std && item.std.adoption.length > 0 && <Progress done={doneStd} total={item.std.adoption.length} />}
      {(item.kind === 'action' || item.kind === 'standard') && (
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
  return (
    <div className="list">
      {items.map((i) => (
        <ItemRow key={i.iid} item={i} {...rest} />
      ))}
    </div>
  );
}
