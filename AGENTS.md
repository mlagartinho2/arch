# Agent instructions: Arch

Read `docs/SPEC.md` before changing anything. It is the source of truth for behaviour, the GitLab data contract, invariants and the enhancement backlog.

## Commands

```bash
npm install
npm test          # vitest; must pass
npx tsc -p .      # strict type-check; must be clean
npm run build     # must succeed
npm run dev       # manual check; click "Try it with demo data" (no GitLab needed)
```

## Hard rules

- **Don't break stored data.** These are read back from existing GitLab issues: label names (`fu::*`, `fu-std::*`), markers (`<!-- fu:key=value -->`), the `## Summary` / `## Document` / `## Adoption` sections, and a meeting's `### Updated` lines (`- #iid title — summary`). Changes must stay backward compatible (spec §3, §11).
- **Browser-only, GitLab is the only store.** Don't add a backend, a database or a UI component library.
- **Every new GitLab endpoint** in `src/lib/gitlab.ts` must also be implemented in the fake (`src/lib/demo.ts`) and covered by a test in `tests/`.
- **Never render issue content as HTML** without sanitising it (the page holds a PAT).
- Keep `parser.ts`, `dates.ts` and `model.ts` pure (no I/O, no React). Put orchestration in `service.ts`.
- Use the local-date helpers in `dates.ts`. Never use `toISOString()` for calendar dates.
- No `alert`, `confirm` or `prompt`.
- Update `docs/SPEC.md` (and `README.md` if user-facing) in the same change as the behaviour change. Move backlog items to "done" or remove them when implemented.
