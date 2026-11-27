// The CI wiki sync (scripts/sync-standards-wiki.ts), as a testable function.
import { GitLab, type FetchFn } from './gitlab';
import { DEFAULT_CATEGORIES, defaultSettings, type Settings } from './settings';
import { StandardsService } from './standardsService';

export interface SyncEnv {
  CI_SERVER_URL?: string;
  CI_PROJECT_PATH?: string;
  ARCH_WIKI_TOKEN?: string;
  ARCH_STANDARDS_FOLDER?: string;
  ARCH_WIKI_KIND?: string;
  ARCH_WIKI_PATH?: string;
  ARCH_WIKI_PREFIX?: string;
  /** "api=API,react=React" */
  ARCH_CATEGORIES?: string;
  /** "1" republishes every page */
  ARCH_FORCE?: string;
}

function need(env: SyncEnv, k: keyof SyncEnv): string {
  const v = env[k];
  if (!v) throw new Error(`Missing environment variable ${k}`);
  return v;
}

export async function syncWiki(env: SyncEnv, log: (line: string) => void = () => undefined, fetchFn?: FetchFn) {
  const server = need(env, 'CI_SERVER_URL');
  const token = need(env, 'ARCH_WIKI_TOKEN');
  const settings: Settings = {
    ...defaultSettings,
    baseUrl: server,
    token,
    standardsProject: need(env, 'CI_PROJECT_PATH'),
    standardsFolder: env.ARCH_STANDARDS_FOLDER || 'standards',
    wikiKind: env.ARCH_WIKI_KIND === 'group' ? 'group' : 'project',
    wikiPath: env.ARCH_WIKI_PATH ?? '',
    wikiPrefix: env.ARCH_WIKI_PREFIX || 'standards',
    categories: env.ARCH_CATEGORIES
      ? env.ARCH_CATEGORIES.split(',').map((pair) => {
          const [key, label] = pair.split('=').map((x) => x.trim());
          return { key, label: label || key };
        })
      : DEFAULT_CATEGORIES,
  };
  const std = new StandardsService(
    new GitLab(server, token, fetchFn),
    settings,
    () => {
      throw new Error('The wiki sync does not need the current user');
    },
    () => 0,
  );
  const catalog = await std.loadCatalog();
  if (catalog.wikiError) throw new Error(`Cannot read the wiki: ${catalog.wikiError}`);
  const force = env.ARCH_FORCE === '1';
  const todo = catalog.entries.filter((e) => force || e.wikiVersion !== e.doc.meta.version);
  log(`${catalog.entries.length} standards, ${todo.length} to publish${force ? ' (forced)' : ''}`);
  for (const e of todo) log(`  ${e.wikiSlug}: ${e.wikiVersion ?? 'missing'} → ${e.doc.meta.version}`);
  await std.publish(catalog, todo);
  const removed = await std.prune(catalog);
  for (const slug of removed) log(`  removed ${slug}`);
  log('Wiki is up to date.');
  return { published: todo.map((e) => e.wikiSlug), removed };
}
