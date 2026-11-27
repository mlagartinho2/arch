import { createContext, useContext } from 'react';
import type { GlUser } from '../lib/gitlab';
import type { Item } from '../lib/model';
import type { Service } from '../lib/service';
import type { Catalog } from '../lib/standardsService';

export interface CatalogState {
  catalog?: Catalog;
  loading: boolean;
  error?: string;
}

export type View = 'focus' | 'mine' | 'waiting' | 'decisions' | 'standards' | 'meetings' | 'prepare' | 'capture' | 'settings';

/** What the Prepare screen starts from (e.g. "next session of this meeting", "1:1 with Anna"). */
export interface PrepPreset {
  title?: string;
  attendees?: string[];
  crews?: string[];
}

/** What the Standards screen opens with: a standard by id, or the editor for a new one. */
export interface StdPreset {
  open?: string;
  newFrom?: { title: string; summary: string; fromIid?: number };
}

export type FullFocus = 'desc' | 'comment';

export interface Ctx {
  svc: Service;
  items: Item[];
  today: string;
  me: string;
  users: string[];
  /** Every GitLab user seen in loaded items (assignees, authors) plus me */
  userMap: Map<string, GlUser>;
  /** Quick look (read-only drawer). `list` is the list it was opened from, for ↑/↓ and ←/→. */
  openItem: (it: Item | number, list?: number[]) => void;
  /** Full-screen item page; `focus` starts editing the description or a comment */
  openFull: (iid: number, focus?: FullFocus) => void;
  /** iid shown in the quick look, if any */
  selected?: number;
  upsert: (it: Item | null | undefined) => void;
  reload: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  go: (v: View) => void;
  /** Open the Prepare screen, optionally pre-filled */
  prepare: (preset?: PrepPreset) => void;
  /** Open the Standards screen, optionally on one standard or on a new draft */
  standards: (preset?: StdPreset) => void;
  /** Standards catalog (loaded on demand) */
  catalog: CatalogState;
  loadCatalog: (force?: boolean) => Promise<void>;
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

export const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppCtx missing');
  return c;
}
