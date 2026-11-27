/* Line diff, ported from GitLab Everything (src/lib/wiki/diff.ts), plus collapsing of long unchanged runs. */
export interface DiffLine { t: ' ' | '+' | '-'; a?: number; b?: number; text: string }

/** Line diff (longest common subsequence after trimming the shared head and tail). */
export function lineDiff(a: string, b: string): DiffLine[] {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length, eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const a1 = A.slice(s, ea), b1 = B.slice(s, eb), n = a1.length, m = b1.length;
  const mid: DiffLine[] = [];
  if (n * m > 4e6) {
    a1.forEach((t, i) => mid.push({ t: '-', a: s + i, text: t }));
    b1.forEach((t, j) => mid.push({ t: '+', b: s + j, text: t }));
  } else {
    const W = m + 1;
    const dp = new Uint32Array((n + 1) * W);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a1[i] === b1[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a1[i] === b1[j]) { mid.push({ t: ' ', a: s + i, b: s + j, text: a1[i] }); i++; j++; }
      else if (j < m && (i >= n || dp[i * W + j + 1] >= dp[(i + 1) * W + j])) { mid.push({ t: '+', b: s + j, text: b1[j] }); j++; }
      else { mid.push({ t: '-', a: s + i, text: a1[i] }); i++; }
    }
  }
  return [
    ...A.slice(0, s).map((t, i): DiffLine => ({ t: ' ', a: i, b: i, text: t })),
    ...mid,
    ...A.slice(ea).map((t, k): DiffLine => ({ t: ' ', a: ea + k, b: eb + k, text: t })),
  ];
}

export type DiffRow = DiffLine | { t: 'gap'; count: number };

/** Hides unchanged runs longer than 2×context lines, keeping `context` lines around each change. */
export function collapseDiff(lines: DiffLine[], context = 3): DiffRow[] {
  const out: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].t !== ' ') { out.push(lines[i++]); continue; }
    let j = i;
    while (j < lines.length && lines[j].t === ' ') j++;
    const run = lines.slice(i, j);
    const head = i === 0 ? 0 : context, tail = j === lines.length ? 0 : context;
    if (run.length > head + tail + 1) {
      out.push(...run.slice(0, head), { t: 'gap', count: run.length - head - tail }, ...run.slice(run.length - tail));
    } else out.push(...run);
    i = j;
  }
  return out;
}

export const diffStats = (lines: DiffLine[]) => ({ added: lines.filter((l) => l.t === '+').length, removed: lines.filter((l) => l.t === '-').length });
