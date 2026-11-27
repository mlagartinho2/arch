/* Unsaved text kept in this browser, per document, so a closed tab or a failed save loses nothing. */

export interface Draft {
  content: string;
  /** The text the draft started from (to detect that GitLab changed meanwhile) */
  base: string;
  at: number;
  /** Anything else the screen wants back (title, version kind, …) */
  extra?: Record<string, unknown>;
}

const KEY = 'arch.drafts.v1';
const read = (): Record<string, Draft> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
};
const write = (all: Record<string, Draft>) => {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage full or unavailable */ }
};

export const drafts = {
  get: (key: string): Draft | undefined => read()[key],
  put(key: string, d: Draft) { const all = read(); all[key] = d; write(all); },
  drop(key: string) { const all = read(); if (key in all) { delete all[key]; write(all); } },
  keys: () => Object.keys(read()),
};
