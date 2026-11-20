// All dates are local calendar dates in ISO form (YYYY-MM-DD), which is what GitLab's due_date uses.

export function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function todayIso(now = new Date()): string {
  return iso(now);
}

export function fromIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  const d = fromIso(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86400000);
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Resolve a human due-date token relative to `today`.
 * Accepts: 2026-12-01, 01.12.2026, 1.12, today, tomorrow, +3d, 3d, +2w, mon..sun (next one), eow, eom, nw (next Monday)
 */
export function resolveDate(token: string, today: string): string | null {
  const t = token.trim().toLowerCase().replace(/[.,;]$/, '');
  if (!t) return null;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return iso(new Date(+m[1], +m[2] - 1, +m[3]));
  if ((m = t.match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4})?)?$/))) {
    const base = fromIso(today);
    let year = m[3] ? +m[3] : base.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, +m[2] - 1, +m[1]);
    if (!m[3] && iso(d) < today) d.setFullYear(year + 1);
    return iso(d);
  }
  if (t === 'today' || t === 'tod') return today;
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return addDays(today, 1);
  if ((m = t.match(/^\+?(\d+)d$/))) return addDays(today, +m[1]);
  if ((m = t.match(/^\+?(\d+)w$/))) return addDays(today, 7 * +m[1]);
  const dow = fromIso(today).getDay();
  if (t === 'eow') return addDays(today, (5 - dow + 7) % 7);
  if (t === 'nw' || t === 'nextweek') return addDays(today, ((1 - dow + 7) % 7) || 7);
  if (t === 'eom') {
    const d = fromIso(today);
    return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  }
  const wi = WEEKDAYS.findIndex((w) => t.startsWith(w) && t.length <= 9);
  if (wi >= 0) return addDays(today, ((wi - dow + 7) % 7) || 7);
  return null;
}

export function humanDue(due: string | null | undefined, today: string): string {
  if (!due) return '';
  const n = daysBetween(today, due);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n}d overdue`;
  if (n < 7) return fromIso(due).toLocaleDateString(undefined, { weekday: 'short' });
  return fromIso(due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
