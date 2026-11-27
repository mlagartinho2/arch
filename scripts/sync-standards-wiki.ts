// Optional CI job for the standards repository: mirrors every standard on the default branch to the wiki.
// Build with `npm run build:sync`, copy dist-sync/sync-standards-wiki.mjs into the standards repo (e.g. ci/), and
// run it from .gitlab-ci.yml (see docs/ci/standards-wiki-sync.gitlab-ci.yml). Needs Node 18+, no dependencies.
import { syncWiki, type SyncEnv } from '../src/lib/syncWiki';

declare const process: { env: SyncEnv; exit(code: number): never };

syncWiki(process.env, (line) => console.log(line)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
