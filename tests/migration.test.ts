import { beforeEach, expect, it } from 'vitest';
import { loadSettings, migrateLegacyStorage } from '../src/lib/settings';

beforeEach(() => {
  const m = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
});

it('moves "Loose Ends" storage to the Arch keys', () => {
  localStorage.setItem('loose-ends.settings.v1', JSON.stringify({ baseUrl: 'https://gl', followupsProject: 'a/b' }));
  localStorage.setItem('loose-ends.capture-draft.v1', '{"title":"Board"}');
  migrateLegacyStorage();
  expect(loadSettings()).toMatchObject({ baseUrl: 'https://gl', followupsProject: 'a/b' });
  expect(localStorage.getItem('arch.capture-draft.v1')).toBe('{"title":"Board"}');
  expect(localStorage.getItem('loose-ends.settings.v1')).toBeNull();
});

it('never overwrites data already under the new keys', () => {
  localStorage.setItem('arch.settings.v1', JSON.stringify({ baseUrl: 'new' }));
  localStorage.setItem('loose-ends.settings.v1', JSON.stringify({ baseUrl: 'old' }));
  migrateLegacyStorage();
  expect(loadSettings().baseUrl).toBe('new');
});
