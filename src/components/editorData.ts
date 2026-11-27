/* What the editors know about the app: people to suggest, items to link, users that don't exist. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlUser } from '../lib/gitlab';
import { archCompletions, type CompletionData, type EditorMode, type Person } from '../editor/completions';
import type { ArchKnowledge } from '../editor/setup';
import { useApp } from './ctx';

/** Project members matching a query, cached per query for this page load. */
const memberCache = new Map<string, Promise<GlUser[]>>();

export function usePeople(first: string[] = []) {
  const { svc, userMap, me } = useApp();
  const firstRef = useRef(first);
  firstRef.current = first;
  return useMemo(
    () => async (query: string): Promise<Person[]> => {
      const q = query.toLowerCase();
      const key = `${svc.project.id}:${q}`;
      if (!memberCache.has(key)) memberCache.set(key, svc.gl.projectMembers(svc.project.id, q).catch(() => []));
      const members = await memberCache.get(key)!;
      const out = new Map<string, Person>();
      const match = (u: GlUser) => !q || u.username.toLowerCase().includes(q) || u.name.toLowerCase().includes(q);
      for (const username of firstRef.current) {
        const u = userMap.get(username) ?? members.find((m) => m.username === username);
        if (u && match(u)) out.set(u.username, { username: u.username, name: u.name, hint: 'in the room' });
      }
      for (const u of [...userMap.values(), ...members]) {
        if (!out.has(u.username) && match(u)) out.set(u.username, { username: u.username, name: u.name, hint: u.username === me ? 'you' : 'member' });
      }
      return [...out.values()].slice(0, 30);
    },
    [svc, userMap, me],
  );
}

/** Looks up @usernames in GitLab (debounced) and returns the ones that don't exist, lower-cased. */
export function useUnknownUsers(names: string[]) {
  const { svc, userMap } = useApp();
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const key = [...new Set(names.map((n) => n.toLowerCase()))].sort().join(',');
  useEffect(() => {
    const list = key ? key.split(',') : [];
    const t = setTimeout(async () => {
      const bad = new Set<string>();
      for (const n of list) {
        if (n === 'me' || [...userMap.keys()].some((k) => k.toLowerCase() === n)) continue;
        const u = await svc.gl.userByUsername(n).catch(() => null);
        if (!u) bad.add(n);
      }
      setUnknown((prev) => (prev.size === bad.size && [...bad].every((b) => prev.has(b)) ? prev : bad));
    }, 450);
    return () => clearTimeout(t);
  }, [key, svc, userMap]);
  return unknown;
}

/** @mentions in a text (for validation). */
export const mentionsIn = (text: string) => [...text.matchAll(/(^|[\s(])@([\w][\w.-]*[\w]|[\w])/g)].map((m) => m[2]);

/** The completion source and highlighter knowledge for one editor. */
export function useEditorData(mode: EditorMode, opts: { first?: string[]; unknown: Set<string>; keywords?: boolean; mergeRequests?: CompletionData['mergeRequests'] }) {
  const { items, today, catalog } = useApp();
  const people = usePeople(opts.first);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const byIid = useMemo(() => new Map(items.map((i) => [i.iid, i])), [items]);
  const completions = useMemo(
    () =>
      archCompletions({
        mode,
        today,
        people,
        items: () => [...itemsRef.current].sort((a, b) => Number(b.open) - Number(a.open) || b.iid - a.iid).map((i) => ({ iid: i.iid, title: i.title, kind: i.kind, open: i.open })),
        mergeRequests: opts.mergeRequests,
        standards: () => (catalog.catalog?.entries ?? []).map((e) => ({ title: e.doc.meta.title, version: e.doc.meta.version, url: e.wikiUrl })),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, today, people, catalog.catalog],
  );
  const knowledge = useMemo<ArchKnowledge>(
    () => ({ today, keywords: Boolean(opts.keywords), unknownUser: (u) => opts.unknown.has(u), item: (iid) => byIid.get(iid) }),
    [today, opts.keywords, opts.unknown, byIid],
  );
  return { completions, knowledge, byIid };
}
