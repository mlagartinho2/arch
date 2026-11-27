# Agent instructions: Arch

Read `docs/SPEC.md` before changing anything. It is the source of truth for behaviour, the GitLab data contract, invariants and the enhancement backlog.

## Commands

```bash
npm install
npm test          # vitest; must pass
npx tsc -p .      # strict type-check; must be clean
npm run build     # must succeed
npm run build:sync  # must succeed (bundles the CI wiki sync)
npm run test:e2e    # browser tests in demo mode; must pass (once: npx playwright install chromium)
npm run dev       # manual check; click "Try it with demo data" (no GitLab needed)
```

## Hard rules

- **Don't break stored data.** These are read back from existing data: label names (`fu::*`), issue markers (`<!-- fu:key=value -->`), a meeting's `### Updated` lines, the standard file format (front matter, `## Changelog`) and paths, and the wiki and merge request markers (`<!-- arch:… -->`). Changes must stay backward compatible (spec §3, §11).
- **`src/lib/standards.ts` is shared with the CI wiki sync** (`npm run build:sync`), which runs in the standards repository: keep it pure and dependency-free.
- **Browser-only, GitLab is the only store.** Don't add a backend, a database or a UI component library.
- **Every new GitLab endpoint** in `src/lib/gitlab.ts` must also be implemented in the fake (`src/lib/demo.ts`) and covered by a test in `tests/`.
- **Never render issue content as HTML** except through `src/editor/markdown.ts` and `MarkdownView` (escape-first renderer plus DOMPurify); the page holds a PAT.
- **The editor in `src/editor/` is ported from GitLab Everything** (not a shared package). Keep Arch-specific behaviour (keywords, `@`/`#`/`due:` completions, Arch checks, meeting preview) in clearly separate functions so fixes can be carried between the two.
- Full-screen screens must not lose text: keep the draft (`editor/drafts.ts` or the capture draft) and the conflict check before saving a description.
- Keep `parser.ts`, `dates.ts` and `model.ts` pure (no I/O, no React). Put orchestration in `service.ts`.
- Use the local-date helpers in `dates.ts`. Never use `toISOString()` for calendar dates.
- No `alert`, `confirm` or `prompt`.
- Update `docs/SPEC.md` (and `README.md` if user-facing) in the same change as the behaviour change. Move backlog items to "done" or remove them when implemented.
- **Keep the browser tests green.** A UI change that renames an id, a `data-view`/`data-tab` or a visible label used in `e2e/` must update the tests in the same change; a new screen or flow gets a test there.
