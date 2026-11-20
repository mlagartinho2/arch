import { createContext, useContext } from 'react';
import type { GlUser } from '../lib/gitlab';
import type { Item } from '../lib/model';
import type { Service } from '../lib/service';

export type View = 'focus' | 'mine' | 'waiting' | 'decisions' | 'standards' | 'meetings' | 'prepare' | 'capture' | 'settings';

/** What the Prepare screen starts from (e.g. "next session of this meeting", "1:1 with Anna"). */
export interface PrepPreset {
  title?: string;
  attendees?: string[];
  crews?: string[];
}

export interface Ctx {
  svc: Service;
  items: Item[];
  today: string;
  me: string;
  users: string[];
  /** Every GitLab user seen in loaded items (assignees, authors) plus me */
  userMap: Map<string, GlUser>;
  openItem: (it: Item | number) => void;
  upsert: (it: Item | null | undefined) => void;
  reload: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
  go: (v: View) => void;
  /** Open the Prepare screen, optionally pre-filled */
  prepare: (preset?: PrepPreset) => void;
  run: <T>(label: string, fn: () => Promise<T>) => Promise<T | undefined>;
}

export const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppCtx missing');
  return c;
}
