import type { ReactNode } from 'react';
import type { GlUser } from '../lib/gitlab';
import type { Item, Kind } from '../lib/model';
import { daysBetween, humanDue } from '../lib/dates';

/** 'standard' is a parsed "STANDARD:" line: a standard still to be written. */
export const KIND_LABEL: Record<Kind | 'standard', string> = {
  action: 'Action',
  decision: 'Decision',
  meeting: 'Meeting',
  adoption: 'Adoption',
  standard: 'Standard to write',
};

export function KindTag({ kind }: { kind: Kind | 'standard' }) {
  return <span className={`kind kind-${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function Avatar({ user, size = 22 }: { user?: GlUser; size?: number }) {
  if (!user) return null;
  const initials = user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  let h = 0;
  for (const ch of user.username) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="avatar"
      title={`${user.name} (@${user.username})`}
      style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${h} 45% 45%)` }}
    >
      {initials}
    </span>
  );
}

export function Due({ item, today }: { item: Item; today: string }) {
  if (!item.due) return <span className="due due-none">no date</span>;
  const n = daysBetween(today, item.due);
  const cls = !item.open ? 'due' : n < 0 ? 'due due-over' : n === 0 ? 'due due-today' : n <= 2 ? 'due due-soon' : 'due';
  return (
    <span className={cls} title={item.due}>
      {humanDue(item.due, today)}
    </span>
  );
}

export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="progress" title={`${done}/${total} crews`}>
      <span className="progress-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="progress-txt">
        {done}/{total}
      </span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Section({ title, count, children, actions }: { title: string; count?: number; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="section">
      <header>
        <h3>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
}

/** Copy text to the clipboard, with a fallback for browsers that block the async API. */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
