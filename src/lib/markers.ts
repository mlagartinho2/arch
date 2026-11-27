/*
 * Issue descriptions carry hidden markers (<!-- fu:key=value -->) that Arch relies on. The editors
 * show and edit the description without them and put them back on save, so a careless edit can
 * never break the link between an item and its meeting, standard or team.
 */

const MARKER_LINE = /^\s*<!-- (?:fu|arch):[^>]*-->\s*$/;
const MARKER = /<!-- (?:fu|arch):[^>]*-->/g;

export interface SplitDescription {
  /** What the person edits */
  text: string;
  /** Marker comments, in their original order */
  markers: string[];
}

export function splitMarkers(desc: string): SplitDescription {
  const markers: string[] = [];
  const kept: string[] = [];
  for (const line of String(desc ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const found = line.match(MARKER);
    if (found) markers.push(...found);
    if (MARKER_LINE.test(line)) continue;
    kept.push(found ? line.replace(MARKER, '').replace(/\s+$/, '') : line);
  }
  return { text: kept.join('\n').replace(/\n+$/, ''), markers };
}

export function joinMarkers(text: string, markers: string[]): string {
  const body = text.replace(/\s+$/, '');
  if (!markers.length) return body ? body + '\n' : '';
  return `${body}${body ? '\n' : ''}${markers.join('\n')}\n`;
}

/**
 * Ticks or unticks the task on `line` (0-based) of `text`. When the text changed in between
 * (someone else edited it), the same task is looked up by its wording. Returns null when the task
 * can no longer be found.
 */
export function toggleTask(text: string, line: number, expected: string, checked: boolean): string | null {
  const L = text.split('\n');
  const norm = (s: string) => s.replace(/\[[ xX]\]/, '[ ]').trim();
  let k = L[line] !== undefined && norm(L[line]) === norm(expected) ? line : -1;
  if (k < 0) k = L.findIndex((l) => /^\s*[-*+]\s+\[[ xX]\]/.test(l) && norm(l) === norm(expected));
  if (k < 0) return null;
  L[k] = L[k].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
  return L.join('\n');
}
