# Arch: Product & Technical Specification

> Audience: engineers and AI coding agents extending this codebase.
> Status: v0.4.1 (2026-11-27: browser tests with Playwright; v0.4: full-screen editors built on GitLab Everything's Markdown editor, read-only quick look; see §15 Changelog). This document describes **what exists today**. §12 lists known gaps and §13 a prioritized enhancement backlog.
> Keep this file current: any change to behaviour, data contracts or architecture must update the matching section in the same change.

---

## 1. Purpose

Marco is a software architect who has many meetings where decisions are made. Each meeting leaves "loose ends" that must be followed up:

1. **Actions**: something assigned to him or to someone else, which he must chase.
2. **Decisions**: something agreed, which must stay findable later ("when did we decide X, and why?").
3. **Standards**: a rule that is written up as a document, reviewed, published to a wiki, versioned, and optionally **adopted by teams** (crews), each with a responsible person and a deadline.

Arch is a capture-and-follow-up tool on top of **GitLab**, which the organisation already uses. GitLab issues are the system of record. The app adds:

- fast capture of meeting notes, with inline syntax that turns lines into issues
- views organised around *following up* (overdue, waiting on others, per person) rather than around projects
- **meeting preparation**: an agenda gathered from earlier sessions and the attendees' open items, which becomes the meeting's notes and updates those items in place
- standards as versioned documents: proposed in merge requests, mirrored to a wiki, grouped by category, and optionally adopted team by team. The document and its adoption are independent

### Name & identity

**Arch** draws on architecture and on structural support. An arch only stands because each wedge stone (voussoir) leans on its neighbours and the keystone locks them together. Decisions, actions and standards are the stones; following up is what keeps the structure standing.

- **Mark:** a Roman arch with nine voussoirs on two piers and a plinth. The keystone is raised slightly and drawn in the accent colour; the other stones use `currentColor`.
  - `public/arch.svg` is the favicon: light stones on a dark rounded square.
  - `src/components/ArchMark.tsx` holds the same geometry as an inline component, used in the nav brand and the setup screen.
  - The geometry was generated (springing centre (32, 32.5), radii 12.5/23.5, 1.1° joints). If you change it, regenerate both files from the same numbers.
- **History:** the app was first called *Loose Ends*. Browser storage is migrated from the old keys (§9). GitLab data never contained the app's name, except in label descriptions, which are cosmetic.

### Non-goals (deliberate)

- No backend or database of its own. Nothing is stored outside GitLab except browser-local settings and drafts.
- Not a general project-management tool. Issues are deliberately flat. Boards, milestones and epics are left to GitLab itself.
- No UI component library. The app uses its own small components; this matches Marco's other portal, "GitLab Everything".

---

## 2. Architecture

```
┌──────────────────────────── Browser (SPA, Vite + React 18 + TS) ───────────────────────────┐
│  components/*  (views, quick look, full-screen editors) ── editor/* (CodeMirror, Markdown)│
│        │  React context `AppCtx` (components/ctx.tsx)                                      │
│        ▼                                                                                   │
│  lib/service.ts  ── use cases (capture meeting, updates, nudge); svc.std = standards      │
│        │             uses lib/parser.ts, lib/model.ts, lib/dates.ts                        │
│        ▼                                                                                   │
│  lib/gitlab.ts   ── thin REST v4 client, injectable `fetch`                                │
│        │                                   ▲                                               │
│        ▼                                   │ demo mode / tests                             │
│  window.fetch → GitLab API      lib/demo.ts (in-memory fake GitLab implementing the same   │
│  (PRIVATE-TOKEN header, CORS)   endpoints, returns real `Response` objects)                │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Browser-only.** Calls go directly to `${baseUrl}/api/v4` with header `PRIVATE-TOKEN`. GitLab allows cross-origin API calls with token auth by default.
- **Dependency rule:** `components → (editor, service) → (parser, model, dates, markers, gitlab)`. `lib/*` must not import React or `editor/*`. `parser`, `model`, `dates` and `markers` are pure and synchronous. In `editor/`, `markdown`, `diff`, `tables`, `checks`, `meetingPreview` and `completions` (apart from CodeMirror types) are pure; `setup`, `commands`, `MarkdownEditor` and `parts` need the DOM.
- **Testability:** the `GitLab` class takes a `FetchFn`. Tests and demo mode pass `createFakeGitLab().fetch`. Any new endpoint added to `gitlab.ts` **must** also be implemented in `demo.ts`.

### Tooling

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (http://localhost:5173) |
| `npm test` | Vitest, node environment, `tests/**/*.test.ts` |
| `npm run build` | `tsc -b && vite build` → static `dist/` (relative `base: './'`, so it can be hosted under any path, e.g. GitLab Pages) |
| `npm run test:e2e` | Builds, serves `dist/` with `vite preview` on port 4174 and runs the Playwright browser tests in `e2e/` (§10). Needs `npx playwright install chromium` once, or `ARCH_E2E_CHROME=<path to Chrome>` |
| `npm run build:sync` | Bundles the CI wiki sync into one dependency-free Node script, `dist-sync/sync-standards-wiki.mjs` (§3.5) |

Runtime dependencies: React 18, CodeMirror 6 (`@codemirror/*`, `@lezer/highlight`) for the editors, DOMPurify for rendered Markdown. `vite.config.ts` puts CodeMirror in its own `editor` chunk and React in a `react` chunk.

TypeScript is `strict` with `noUnusedLocals` and `noUnusedParameters`. There is no ESLint config yet, although the source contains a couple of `eslint-disable` comments for future use.

### File map

| Path | Responsibility |
|---|---|
| `src/lib/settings.ts` | `Settings` type, defaults (incl. categories), demo settings, localStorage load/save, `isConfigured`, `wikiTarget`, `categoryLabel`, `migrateLegacyStorage` |
| `scripts/sync-standards-wiki.ts` | Entry point of the CI wiki sync; bundled by `npm run build:sync` (`vite.sync.config.ts`) into `dist-sync/sync-standards-wiki.mjs` |
| `docs/ci/standards-wiki-sync.gitlab-ci.yml` | The CI job to add to the standards repository |
| `src/lib/gitlab.ts` | REST client + GitLab types (`GlIssue`, `GlUser`, `GlNote`, `GlProject`, `GlMergeRequest`), pagination, user lookup cache |
| `src/lib/dates.ts` | ISO local-date helpers, `resolveDate` (due-date tokens), `humanDue` |
| `src/lib/parser.ts` | Meeting-notes syntax → new items (`Draft`) and updates (`UpdateDraft`): `parseLine`, `parseUpdate`, `parseMeeting`, `parseNotes`, `updateNote` |
| `src/lib/markers.ts` | Hide the `<!-- fu:… -->` markers while a description is edited and put them back on save (`splitMarkers`, `joinMarkers`); tick a task on the latest text (`toggleTask`) |
| `src/lib/model.ts` | Label constants, `Item` domain type, `toItem` mapping, hidden markers, adoption issue title/description, view predicates, `slugify`, `updateProblem`, `meetingUpdates` |
| `src/lib/standards.ts` | Standard documents (pure, dependency-free): front matter, versions, changelog, paths and wiki slugs, wiki page and index rendering |
| `src/lib/standardsService.ts` | `StandardsService` (`svc.std`): catalog, proposals as merge requests, wiki publishing, history, adoption cycles; `adoptionCycles()` |
| `src/lib/syncWiki.ts` | The optional CI wiki sync as a function (`syncWiki(env)`) |
| `src/lib/prep.ts` | Meeting preparation: series detection, attendee resolution, `buildPrep`, agenda and notes rendering |
| `src/lib/service.ts` | `Service`: all use cases that touch GitLab |
| `src/lib/demo.ts` | Fake GitLab (`createFakeGitLab`, `seedDb`, `resetDemo`) |
| `src/App.tsx` | Shell: settings/connection lifecycle, nav, routing, toasts, `QuickAdd`, context provider |
| `src/components/ctx.tsx` | `AppCtx` / `useApp()`, `View` union |
| `src/components/Views.tsx` | Focus, Mine, Waiting, Decisions, Meetings |
| `src/components/Standards.tsx` | Standards screen: catalog, detail panel, editor, adoption-cycle form (§8.8) |
| `src/components/Capture.tsx` | Meeting notes, full screen (§8.4); capture-draft storage helpers |
| `src/components/ItemScreen.tsx` | An item, full screen: description editor, comment composer, rail (§8.3b) |
| `src/components/QuickLook.tsx` | Read-only quick look beside the lists (§8.3a) |
| `src/components/StandardEditor.tsx` | A standard, full screen (§8.8) |
| `src/components/editorData.ts` | Hooks that feed the editors: people (attendees first, then project members), unknown-user lookups, completion source and highlighter knowledge |
| `src/components/Prepare.tsx` | Prepare screen (§8.7) |
| `src/components/ItemRow.tsx` | `ItemRow`, `ItemList` (passes the list's IIDs as the quick-look navigation order) |
| `src/editor/markdown.ts` | Markdown → HTML (escape-first GitLab Flavored subset, ported from GitLab Everything), outline, word count |
| `src/editor/setup.ts` | CodeMirror extensions: keys, theme, lint, Arch keyword/mention/reference/due highlighting |
| `src/editor/commands.ts` | Formatting commands, tables, Arch lines (`ACTION @`, `DONE #`, `due:`, `MUST` rules…) |
| `src/editor/completions.ts` | `/` menu, `@` people, `#` items, `!` merge requests, `§` standards, `due:` dates |
| `src/editor/checks.ts` | Markdown checks plus Arch checks for meeting notes and standards |
| `src/editor/meetingPreview.ts` | Preview of meeting notes with Arch lines as cards |
| `src/editor/diff.ts`, `tables.ts` | Line diff (with collapsed unchanged runs) and Markdown table model, from GitLab Everything |
| `src/editor/MarkdownEditor.tsx` | React wrapper around one CodeMirror view |
| `src/editor/parts.tsx` | Shared editor UI: preferences, toolbar and menus, side-panel tabs, diff view, `MarkdownView` (sanitised), scroll sync, save shortcut, banner |
| `src/editor/drafts.ts` | Per-document drafts in localStorage |
| `src/components/SettingsView.tsx` | Settings form, connection test, demo switch |
| `src/components/ArchMark.tsx` | The app's arch logo as an inline SVG component |
| `public/arch.svg` | Favicon (same geometry as `ArchMark`) |
| `src/components/ui.tsx` | Small presentational pieces (KindTag, Avatar, Due, Progress, Section, Empty) and label text maps |
| `src/styles.css` | All styling. CSS variables, light theme plus `prefers-color-scheme: dark` |
| `tests/core.test.ts` | Unit tests (dates, parser, model) and service tests against the fake GitLab |
| `tests/standards.test.ts` | Document format, versions, wiki rendering; standards service against the fake (proposals, merge, publish, moves, stale changes, cycles, group wiki); CI sync |
| `tests/prep.test.ts` | Update syntax, prep gathering, agenda rendering, applying updates against the fake GitLab |
| `tests/migration.test.ts` | Legacy storage-key migration |
| `e2e/*.e2e.ts`, `e2e/fixtures.ts`, `playwright.config.ts` | Browser tests in demo mode (§10) |
| `.gitlab-ci.yml` | GitLab CI/CD: job `unit` (unit tests, CI sync build) and job `e2e` (browser tests) on merge requests and branch pushes, with JUnit reports shown in the merge request |
| `tests/editor.test.ts` | Renderer, diff, tables, checks, markers, meeting preview, completions; task ticking against the fake |

---

## 3. GitLab data contract (stable; treat as a public API)

Issues (meetings, actions, decisions, adoptions) live in **one GitLab project**, `settings.followupsProject`. Standards live as files in `settings.standardsProject` and are mirrored to a wiki (§3.4). Existing user data depends on these conventions. **Do not rename labels or markers without writing a migration** (see §11).

### 3.1 Labels

| Label | Meaning | Colour |
|---|---|---|
| `fu::meeting` | Meeting record | `#6699cc` |
| `fu::action` | Action / follow-up | `#d9534f` |
| `fu::decision` | Decision record | `#5cb85c` |
| `fu::adoption` | One team adopting one version of one standard | `#8e44ad` |

- Scoped labels (`::`) make these mutually exclusive on Premium/Ultimate. On Free they are plain labels; the code never relies on the exclusivity.
- **Kind resolution** (`model.kindOf`) checks labels in priority order meeting > adoption > decision > action. Issues carrying none of these labels are ignored by the app.
- v0.3 removed `fu::standard` and the `fu-std::*` labels (issue-based standards, never used against a real GitLab). Old labels are left alone; issues carrying only them are ignored.
- `LABEL_DEFS` in `model.ts` is the single source for label names, colours and descriptions. On connect, `Service.init()` computes `missingLabels`; the UI shows a banner whose button calls `ensureLabels()`.

### 3.2 Hidden markers in issue descriptions

The format is `<!-- fu:<key>=<value> -->`, each on its own line. The value must not contain spaces. Helpers: `getMarker`, `setMarker` (replaces the marker if present, otherwise appends it).

| Key | Value | Set on | Purpose |
|---|---|---|---|
| `meeting` | meeting issue IID | items created from a meeting | Back-link; drives "from meeting #N" and the meeting's Outcomes |
| `newstandard` | URI-encoded standard title | actions created from a `STANDARD:` line | Marks a standard still to be written; "Draft this standard" pre-fills the editor with it |
| `std` | standard id | adoption issues | Which standard |
| `ver` | version, e.g. `2.0` | adoption issues | Which version the team adopts |
| `team` | URI-encoded team name | adoption issues | Which team |
| `outcome` | `superseded` or `dropped` | closed adoption issues | Closed **without** adopting. A closed adoption issue without it counts as adopted (`isAdopted`) |

Items created from a meeting also get a human-readable first line, `From meeting #N`, and a GitLab issue link (`POST /issues/:iid/links`, `link_type: relates_to`; failures are silently ignored).

### 3.3 Issue shapes per kind

**Meeting** (`fu::meeting`, created and then **closed**)
- Title: `<meeting title> (<YYYY-MM-DD>)`
- Description:
  ```
  **Date:** 2026-11-18  
  **Attendees:** Anna, Jonas        (line omitted when empty)

  ## Notes

  <raw notes exactly as typed>

  ## Outcomes
  ### Decisions
  - #17 Adopt OpenTelemetry
  ### Actions
  - #18 Confirm budget for the POC
  - #20 Write standard: Trace context propagation headers
  ### Updated
  - #7 Share load-test results — done
  - #10 Review the migration plan — follow-up → 2026-11-28
  ```
  Each `### ...` sub-section appears only if non-empty. `## Outcomes` is appended in a second `PUT`, together with `state_event: close`, after all items are created and all updates applied.
  - `### Updated` lines have the fixed shape `- #<iid> <title> — <summary>`. `model.meetingUpdates()` reads them back for the meeting's quick look and full screen, so **treat this shape as part of the data contract**.
  - Summaries: `done`, `dropped`, `updated`, `updated, follow-up → <date>`, `follow-up → <date>`, `adopted`, each optionally followed by ` · → @<user>` when reassigned.
- The meeting is linked (`relates_to`) to every item it created **and** every item it updated.

**Comments written by updates** (on the updated issue; `#M` is the meeting, omitted for quick-add updates):

| Op | Comment |
|---|---|
| done | `✅ Done in #M[: note]` |
| drop | `🚫 Dropped in #M[: note]` |
| push | `⏭️ Follow-up moved to <date> in #M[: note]` |
| note | `📝 Update in #M: <note>` (no comment if only the date or assignee changed) |
| adopted | `✅ Adopted in #M[: note]` |

**Action** (`fu::action`)
- Exactly one assignee: the resolved `@user`, or the current user.
- `due_date` = follow-up date (explicit `due:`, or `today + settings.defaultFollowUpDays`).
- Description: `From meeting #N` + indented details + `meeting` marker; or just the details for quick-add items.
- Open = still to follow up; closed = done.

**Decision** (`fu::decision`)
- Created, then immediately closed by a second `PUT` (`state_event: close`). A decision is a record, not a task.
- No assignee and no due date.
- Closed decisions are still loaded (§5) and are never shown struck through.

**Standard to write** (an action from a `STANDARD:` line)
- `fu::action`, title `Write standard: <title>`, the `newstandard` marker, assignee and follow-up as for any action.
- The quick look and the item page offer "Draft this standard →", which opens the standards editor pre-filled (title, and the details as context). Opening the merge request comments the MR link on this action. The action is closed by hand.

**Adoption** (`fu::adoption`): one team adopting one version of one standard (§3.4)
- Title `Adopt "<standard title>" v<version> — <team>`; assignee = the team's responsible person; `due_date` = the adoption deadline.
- Description (`model.adoptionDescription`):
  ```
  **Standard:** [API error format v1.1](<wiki url>) · API
  **Team:** Payments (@platform/crew-payments)
  **Responsible:** @priya.nair · **Adopt by:** 2026-12-31

  ### What changed since your last adopted version      (or "### What to adopt" + "The whole standard…")
  - **1.1** (2026-11-15): Clarified that validation errors list fields in `errors[]`

  Close this issue once the team has adopted this version. …
  <!-- fu:std=api-error-format -->
  <!-- fu:ver=1.1 -->
  <!-- fu:team=Payments -->
  ```
- Open = adopting; closed = adopted, unless the `outcome` marker says `superseded` (a newer cycle replaced it) or `dropped` (`DROP #id`).
- It behaves like an action everywhere (Focus, My actions, Waiting on others, nudge, Prepare), with "Mark adopted" instead of "Mark done".

### 3.4 Standards: documents, wiki and adoption

Standards have three independent parts. Only the first is required.

**1. The document: a file in the standards repository** (`settings.standardsProject`, default branch = the published truth)
- Path `<standardsFolder>/<category>/<id>.md`, e.g. `standards/api/api-error-format.md`. The category is the folder; `id` is the slug of the title at creation and never changes.
- Front matter (a small YAML subset; `standards.parseFrontMatter`) followed by the body and a changelog:
  ```
  ---
  id: api-error-format
  title: "API error format (RFC 7807)"
  category: api
  tags: [rest, errors]
  version: 1.1
  status: active                  (or deprecated)
  owner: marco
  updated: 2026-11-15
  ---

  # API error format (RFC 7807)
  …body…

  ## Changelog

  | Version | Date | Change |
  |---|---|---|
  | 1.1 | 2026-11-15 | Clarified that validation errors list fields in `errors[]` |
  | 1.0 | 2026-10-16 | Initial version |
  ```
- **Versions** are `major.minor`. Minor = clarifications teams don't have to act on; major = a change teams must adopt. Each version adds one changelog row (newest first; `|` escaped). Git keeps the exact text of every version; `svc.std.history()` lists the file's commits.
- Parsing is lenient: a file without front matter gets its id and category from its path, version 1.0 and status active.

**2. Changes: merge requests** (`proposeNew`, `proposeChange`)
- Every new standard and every change is a branch `standard/<id>-<major>-<minor>-<base36 time>` with one commit (`create`, `update`, or `move` when the category changes) and a merge request into the default branch. Its description ends with `<!-- arch:proposal id=<id> version=<v> kind=new|change -->`, which is how Arch finds open proposals.
- `proposeChange` re-reads the file from the default branch first and refuses if its version differs from the one being edited ("changed to vX since you opened it").
- Arch never merges; people review and merge in GitLab.

**3. The wiki mirror** (`publish`; optional CI job, §3.5)
- Target: `wikiTarget(settings)` = the project wiki of `wikiPath` or the standards project (all tiers), or a group wiki (`wikiKind: 'group'`, Premium/Ultimate).
- One page per standard at slug `<wikiPrefix>/<category>/<id>` (created with that slug as its title; front matter `title:` gives the display title on GitLab 17.2+), rendered by `renderWikiPage`: an `<!-- arch:standard id=<id> version=<v> -->` marker, a metadata table, a note that the page is overwritten and changes go through merge requests, the body and the changelog.
- An index page at slug `<wikiPrefix>`: one table per category (`renderWikiIndex`), regenerated on every publish.
- **Arch tells that the wiki is behind** by comparing the marker's version with the file's. It never publishes silently: the Standards screen shows a banner and buttons. A category move deletes the page under the old slug.
- GitLab's wiki API cannot list a page's history, which is why versions live in the file and its git history, not in the wiki.

**4. Adoption cycles (optional)** (`startCycle`)
- For the current version, the user picks teams (from `settings.crews`), a responsible person per team (default: the team's `lead`) and a deadline (default `today + adoptionDays`). Arch creates one adoption issue per team (§3.3).
- "What changed" lists the changelog entries newer than the team's last **adopted** version, up to this one; a team that never adopted gets "the whole standard".
- A team that already has an open issue for this version is skipped and reported. With "supersede" (default on), open issues of the same team for older versions get a comment `⏭️ Superseded by v<v>: #<new>` and are closed with `outcome=superseded`.
- Arch suggests a cycle (button highlighted, hint) when there is none yet, or when the current version is a major step from the latest cycle's version. It never starts one by itself.

### 3.5 Optional CI wiki sync

`docs/ci/standards-wiki-sync.gitlab-ci.yml` + `dist-sync/sync-standards-wiki.mjs` (Node 18+, no dependencies), added to the **standards** repository:
- Runs on pushes to the default branch that touch `standards/**/*.md`, or manually (`ARCH_FORCE=1` republishes everything).
- Same code as the app (`syncWiki` → `StandardsService.loadCatalog`, `publish`, `prune`): publishes standards whose wiki version differs, regenerates the index, and deletes mirrored pages whose standard no longer exists.
- Needs `ARCH_WIKI_TOKEN`: a project or group access token with `api` scope and at least Developer on the wiki's owner (the CI job token cannot write wikis). Other variables: `ARCH_STANDARDS_FOLDER`, `ARCH_WIKI_KIND`, `ARCH_WIKI_PATH`, `ARCH_WIKI_PREFIX`, `ARCH_CATEGORIES` (`key=Label,…`).
- With the job installed the wiki is current after every merge, and Arch shows nothing to publish.

---

## 4. Domain model (`lib/model.ts`)

```ts
type Kind = 'action' | 'decision' | 'meeting' | 'adoption';

interface Item {
  iid; projectId; kind; title; description /* raw, with markers */;
  open: boolean;              // state === 'opened'
  assignee?: GlUser;          // FIRST assignee only
  author: GlUser;
  due?: string;               // 'YYYY-MM-DD'
  labels; webUrl; createdAt; updatedAt; closedAt?; notesCount;
  meetingIid?: number;        // from marker
  adoption?: { std; version; team; outcome?: 'superseded' | 'dropped' };   // adoption issues
  newStandard?: boolean;      // action created from a STANDARD: line
}

// lib/standards.ts
interface StandardMeta { id; title; category; tags: string[]; version /* "1.2" */; status: 'active' | 'deprecated'; owner?; updated? }
interface StandardDoc { meta: StandardMeta; body: string; changelog: { version; date; change }[] /* newest first */ }

// lib/standardsService.ts
interface StandardEntry { doc; path; wikiSlug; wikiUrl; sourceUrl; historyUrl; wikiVersion? /* undefined = not on the wiki */; proposals: Proposal[] }
interface Catalog { project; entries: StandardEntry[]; newProposals: Proposal[]; wikiError?; loadedAt }
```

Standards are not issues: the catalog is loaded on demand (Standards screen) from the repository tree, each file's raw content (6 at a time), the wiki page list (`with_content=1`, one call) and the open merge requests. It is cached in `App` until reloaded.

### View predicates (single source of truth; reuse them, don't re-implement)

| Predicate | Rule |
|---|---|
| `isTrackable(it)` | `open && kind ∈ {action, adoption}` |
| `isAdopted(it)` | adoption issue, closed, and no `outcome` marker |
| `isMine(it, me)` | assignee is me; or there is no assignee and I am the author |
| `isWaiting(it, me)` | there is an assignee and it isn't me |
| `isOverdue(it, today)` | `due < today` |
| `isDueSoon(it, today, days=7)` | `today ≤ due ≤ today+days` |
| `byDue` | ascending due date, undated last, then by IID |

---

## 5. Loading strategy (`Service.loadItems`)

Four requests run in parallel. Results are de-duplicated by IID, and issues without a `fu::` kind label are dropped.

1. `state=opened` (everything open)
2. `state=closed&updated_after=<today-90d>` (recently closed, for context and reopening)
3. `state=all&labels=fu::decision` (the full decision log)
4. `state=all&labels=fu::meeting` (the full meeting list)

Pagination uses `per_page=100` and follows `x-next-page`. If that header isn't exposed and a page is full, the client tries the next page anyway. There is a hard guard of 50 pages per call.

All state is held in memory in `App` (`items: Item[]`). Mutations return the updated `Item` and are merged with `upsert`. A full refresh happens on connect, through the ↻ button, and after a meeting capture. There is no polling.

---

## 6. Capture syntax (`lib/parser.ts`)

### 6.1 Item lines

The regex (case-insensitive) accepts an optional list prefix (`- `, `* `, `+ `, `1. `, `1) `), an optional checkbox (`[ ]`, `[x]`), then a keyword:

| Keywords | Type |
|---|---|
| `ACTION`, `AI`, `TODO`, `ASK` | action |
| `DECISION`, `DECIDED`, `DEC` | decision |
| `STANDARD`, `STD` | a standard **to write**: an action `Write standard: <title>` (§3.3) |

After the keyword come an optional `@user`, an optional separator (`:`, `-`, `–`), and then the text.

**False-positive guard:**
- A keyword written in lowercase or mixed case counts only if it is directly followed by `:`, `@`, `-` or `–`. So "Decision makers were absent" and "Ask around" are ignored.
- `AI` (any case) requires `:` or `@`, so "AI strategy…" is ignored.

**Assignee resolution:**
1. An `@user` right after the keyword (`ACTION @bob: …`) is the assignee.
2. Otherwise a leading `@user` in the text is the assignee and is stripped from the title (`ACTION: @bob migrate X`).
3. Otherwise the first `@mention` anywhere in the text is the assignee, and the text is kept (`ask: check with @bob`).
4. `@me` or your own username → `undefined`, meaning "me".
5. Decisions never get an assignee; mentions stay in the title.

**Due dates:** `(due|by|fu):<token>` anywhere in the text. If the token resolves, it is removed from the title. If it doesn't resolve, the text is left untouched and no date is set. Actions without a date get `today + defaultFollowUpDays`. Standards and decisions do not.

**Title:** whitespace is collapsed, trailing `:;,-` is stripped, and the first letter is capitalised. An empty title means the line is not an item.

### 6.2 Details

In `parseNotes`, lines indented by ≥2 spaces or a tab that **directly follow** an item line (or its previous detail lines) become that item's `details`. List markers are normalised to `- `. Any non-empty, non-indented, non-item line ends the item's details block. Blank lines do not end it.

### 6.3 Due-date tokens (`dates.resolveDate`, relative to `today`)

| Token | Result |
|---|---|
| `2026-12-15` | ISO date |
| `15.12.2026`, `15.12.26` | Swiss/European day.month.year |
| `15.12`, `15.12.` | That day; rolls to next year if already past |
| `today`, `tod` | today |
| `tomorrow`, `tmr`, `tom` | +1 day |
| `3d`, `+3d` / `2w`, `+2w` | +N days / weeks |
| `mon` … `sun`, full names | **next** occurrence, always in the future (same weekday → +7) |
| `eow` | this week's Friday (a Saturday rolls to next Friday) |
| `nw`, `nextweek` | next Monday |
| `eom` | last day of the month |

All dates are **local calendar dates** formatted `YYYY-MM-DD`, which is what GitLab's `due_date` expects.

---

### 6.4 Updating existing items (`parseUpdate`, `parseMeeting`)

Besides creating items, notes (and Quick add) can update existing ones by issue number. Update lines are checked **before** item lines, and an update line ends the previous item's details block.

| Line | Op | Effect |
|---|---|---|
| `- [x] #7 …` (ticked checkbox before `#iid`) | done | Close |
| `DONE #7`, `CLOSED #7` | done | Close |
| `DROP #7`, `DROPPED #7` | drop | Close, recorded as dropped |
| `UPDATE #7: text`, `UPD`, `NOTE` | note | Comment; optional `due:` and reassignment |
| `PUSH #7 due:fri`, `MOVE`, `SNOOZE` | push | Set the follow-up date; with no `due:`, `today + defaultFollowUpDays` (fallback 7) |
| `ADOPTED #14[: note]` | adopted | Close an **adoption issue** as adopted (other kinds: use DONE) |

- Any case is accepted; the keyword may be followed by `:`. The optional list and checkbox prefixes of §6.1 are allowed, so `- [ ] PUSH #9` works.
- `@user` written **directly after** `#iid` reassigns the item (`UPDATE #7 @anna: she takes it`). `@me` or your own username means you. Mentions elsewhere in the text are only text.
- `due:<token>` anywhere in the line sets the follow-up date (§6.3).
- **Note text** (`updateNote(text, title)`): the remaining text, after removing a leading copy of the issue's own title, an agenda annotation in parentheses `(…)`, and leading `:`/`—`/`-`. So prefixing an untouched agenda line (`DONE #7 Share load-test results (jonas.weber, 2d overdue)`) adds no comment text, while `…: shared on the wiki` does.
- Untouched agenda lines (`- [ ] #7 Title (…)`, `- #14 Title (…)`) are not updates and not items. A bare `#7 was discussed` is plain text.

**Validation** (`model.updateProblem`, using the loaded items; shown in the capture preview and Quick add):

| Case | Level |
|---|---|
| Item not loaded (e.g. closed > 90 days ago) | warn; looked up in GitLab when applied |
| Target is a meeting; `adopted` on anything but an adoption issue; `note` with nothing to change | err; skipped unless the user ticks it explicitly |
| `done`/`drop` on an already closed item | warn |

`Service.applyUpdate` re-validates against GitLab and throws the same errors, so a forced update fails per item and is reported like any other capture error.

## 7. Use cases (`lib/service.ts`)

| Method | Behaviour |
|---|---|
| `init()` | `GET /user` and `GET /projects/:followups`; computes `missingLabels` |
| `ensureLabels()` | Creates the missing labels from `LABEL_DEFS` |
| `loadItems()` | §5 |
| `createItem(draft, meetingIid?)` | §3.3 per kind. Resolves `@username` via `GET /users?username=` (cached); an unknown user throws `GitLab user @x not found` |
| `captureMeeting(input, drafts, onProgress?, updates = [])` | Creates the meeting issue, then each new item and then each update **sequentially**; collects per-item errors **without aborting**; appends Outcomes (including `### Updated`) and closes the meeting. Returns `{ meetingIid, created, updated: {iid, title, summary}[], errors }` |
| `applyUpdate(update, meetingIid?)` | `GET` the issue, validate (§6.4), one `PUT` for state/due/assignee (a `drop` on an adoption issue also sets `outcome=dropped`), then the comment, then link it to the meeting. Returns `{ item, summary }` |
| `postAgenda(meetingIid, markdown)` | Adds the agenda as a comment on a meeting issue (used for "Post on last session") |
| `close / reopen / setDue / assign / rename` | Single `PUT`; return the mapped `Item` |
| `addNote / notes` | Issue notes; the UI hides `system` notes |
| `nudge(item, msg, pushDays=3)` | Posts `@assignee <msg>` (GitLab notifies them) and sets `due = today + pushDays` |

**Standards** (`svc.std`, `lib/standardsService.ts`; §3.4):

| Method | Behaviour |
|---|---|
| `loadCatalog()` | Repository tree of the standards folder (404 = empty), raw files, wiki pages with content (a failure sets `wikiError` instead of failing), open merge requests with the proposal marker |
| `proposeNew(catalog, {title, category, tags, owner?, body, note?}, fromIssueIid?)` | Refuses an id that exists or is proposed. Version 1.0, changelog "Initial version" (or the note). Comments the MR link on the "Write standard" action when given |
| `proposeChange(catalog, entry, {kind, note, body, meta})` | Note required. Stale-version guard. Bumps the version, adds the changelog row, moves the file if the category changed |
| `publish(catalog, entries)` | Creates or updates each wiki page, deletes the page under an old category slug, regenerates the index |
| `prune(catalog)` | Deletes mirrored pages whose standard no longer exists (used by the CI sync) |
| `history(catalog, entry)` / `versionAt(catalog, entry, sha)` | Commits that touched the file; the file at a commit |
| `startCycle(entry, teams, items, {supersede, meetingIid?})` | §3.4 point 4. Returns `{ created, errors }`; one team failing (unknown user, already open) doesn't stop the others |
| `adoptionCycles(items, stdId)` | Adoption issues grouped by version, newest first, with `adopted` and `active` (not superseded or dropped) counts |

---

## 8. UI specification

### 8.1 Shell (`App.tsx`)

- **Connection lifecycle:**
  - Settings are loaded from localStorage.
  - If they are configured, a `Service` is built. In demo mode it is backed by `createFakeGitLab(undefined, persist=true)`.
  - Then `init()` and `loadItems()` run.
  - Status moves `idle → loading → ready | error`. On error, or when settings are missing, the setup screen is shown.
- **Routing:** location hash `#/<view>`, where `View = focus | mine | waiting | decisions | standards | meetings | capture | settings`, plus `#/item/<iid>` for an item full screen (deep-linkable; the view underneath stays what it was, so browser Back returns to the list). Settings render in the setup layout, not the shell.
- **Nav:** a "+ Meeting notes" button and the views, including **Prepare meeting** (always opens an empty Prepare screen). Badges show: Focus = overdue + due today (accent colour); Mine; Waiting; Standards = open adoption issues. **Standards** in the nav always opens the catalog (it resets any preset).
- **Top bar:** view title, **Quick add**, refresh button and busy spinner. The missing-labels banner appears under it.
- **Quick add:** the same syntax as one line. An update line (`parseUpdate`, §6.4) is tried first. It is applied with no meeting reference after validation, and a toast shows its summary. Otherwise `parseLine` runs; if the text doesn't parse, it is retried as `TODO: <text>`, so any text becomes an action for me. A preview pops up under the input. Enter applies or creates and opens the item; Esc clears.
- **Keyboard:** `/` focuses Quick add; `n` opens Capture; `p` opens an empty Prepare screen. With a quick look open: `↑`/`↓` move through the list it was opened from, `Enter` opens the item full screen, `E` opens it editing the description, `C` opens it in the comment box, `Esc` closes. On a row, `Space` opens the quick look and `Enter` (or a double-click) the full screen. Shortcuts are ignored while typing (inputs, text areas and CodeMirror) and while a full-screen editor is open; the keys that open an editor are `preventDefault`ed so they are not typed into it.
- **`ctx.openItem(item, list?)`** opens the quick look; `list` (IIDs) sets the ↑/↓ and ←/→ order. **`ctx.openFull(iid, focus?)`** opens `#/item/<iid>`, `focus` = `'desc' | 'comment'`.
- **`ctx.prepare(preset?)`** opens Prepare pre-filled with `{ title?, attendees?, crews? }`. The screen is re-mounted (keyed) on every call, so it never keeps stale state from an earlier preparation.
- **`ctx.standards(preset?)`** opens the Standards screen on a standard (`{ open: id }`) or on the editor for a new one (`{ newFrom: { title, summary, fromIid } }`); keyed like Prepare.
- **`ctx.catalog` / `ctx.loadCatalog(force?)`**: the standards catalog state (`{ catalog?, loading, error? }`), loaded on first visit to Standards and reloaded after every proposal, publish or explicit refresh. A new connection clears it.
- **`ctx.userMap`**: every GitLab user seen in the loaded items (assignees, authors), plus me. It is used to resolve attendee names.
- **Feedback:** `run(label, fn)` wraps every mutation. It counts busy operations, shows a success toast (`label`, if non-empty), and shows any error as a red toast for 8 s.
- **Datalist `#users`:** every assignee and author seen in `items`, used for reassignment autocomplete.

### 8.2 Views (`Views.tsx`)

| View | Content |
|---|---|
| **Focus** | Five stat tiles: on my plate, waiting on others, overdue, adoptions open, decisions in the last 30 days. Tiles navigate on click, except overdue. Then sections over trackable items: Overdue, Follow up today, Next 7 days, No follow-up date |
| **My actions** | Trackable items where `isMine`, sorted `byDue` |
| **Waiting on others** | Trackable items where `isWaiting`, grouped by assignee username, largest group first. "Prepare 1:1" per person opens Prepare with title `1:1 <Name>` and that person as attendee. "Copy list" per person and "Copy full digest" copy markdown: `**@user**\n- <project>#<iid> <title> — <humanDue>` |
| **Decision log** | Full-text filter over title and description; grouped by month of `createdAt`, newest first |
| **Meetings** | Newest first. Per meeting: counts of outcomes by kind, and a pill with the number of open non-decision items, or "all closed". On hover, "Prepare next" opens Prepare for that meeting's series |

`ItemRow`:
- Actions and adoption issues have a round checkbox that toggles done (adopted) / reopen. Other kinds show a kind tag.
- Meta line: `#iid`, "from meeting #N", comment count, "Adoption · <team>" (and its outcome) for adoption issues, "Standard to write" for actions from a STANDARD line.
- Actions and adoption issues show `+1d` / `+1w` snooze on hover, a due chip (overdue in red, today in accent, ≤2 days in amber), and the owner avatar. The avatar has an amber ring when the item is waiting on someone else.
- Decisions show their creation date.

### 8.3a Quick look (`QuickLook.tsx`)

Opens on the right (overlay below 1100 px) when a row is clicked. It **only reads, ticks, snoozes and closes**; all writing happens full screen.

- Header: kind tag, `#iid`, "Quick look · read only", close.
- Title; owner and follow-up (trackable items) or "Recorded … by …"; "from <meeting>" (opens the meeting full screen).
- Trackable items: Mark done / Mark adopted (or Reopen), `+1d` `+3d` `+1w`.
- Meeting: Outcomes list and "Prepare next session →". Adoption issue: team, version, "Open the standard →". Standard to write: "Draft this standard →".
- Description (meetings: Notes without the generated `## Outcomes`) rendered as Markdown (§8.9). **Ticking a task saves at once** through `Service.tickTask`, which re-reads the issue, ticks the same task in the latest text (found by its wording if lines moved) and keeps the markers; if the task is gone it fails with a message and the box is reverted.
- Latest comment (rendered) and "All activity (n)" → full screen.
- Footer: **Open full screen ↵**, **Edit description E**, **Comment C**.

### 8.3b Item full screen (`ItemScreen.tsx`)

`#/item/<iid>`; an item that isn't loaded is fetched (`Service.fetch`), and a non-Arch issue shows a message.

- **Top bar:** ← back (to the view underneath; `Esc`), kind tag, `project#iid`, open/closed pill, ←/→ previous/next in the list it was opened from (also the arrow keys), Open in GitLab, **Nudge…** (open actions assigned to someone else: a popover with the message; posts the comment and pushes the follow-up 3 days), **Mark done / Mark adopted / Close** or Reopen.
- **Title** (renames on blur or Enter) and a property line: Owner (`#users` datalist; Enter reassigns; an unknown username is refused with a toast), Follow-up chip, From <meeting>, Created by … · N days ago.
- **Meeting:** Outcomes (`ItemList`) with "Prepare next session →", and "Also updated: …" from `### Updated`. **Standard to write:** a banner with "Draft this standard →".
- **Description card:** read mode renders the description (task ticks save at once, as in the quick look; `#123` opens that item). **Edit** (or double-click, or `E` from the quick look) switches to the editor: Write / Preview / Changes, status ("Unsaved changes · draft kept HH:MM"), Cancel (inline confirmation when there are changes), Save (`Ctrl/⌘+S`, also outside the text). Markers are hidden while editing and re-attached on save (`lib/markers.ts`).
  - **Conflict-safe save:** before writing, the description is re-read. If it differs from the text the edit started from, a red banner offers **Compare versions** (Changes shows their version → yours), **Save mine anyway**, or **Load their version** (yours is kept as a draft under `<key>:mine`).
  - The draft is kept per item (`desc:<projectId>:<iid>`); reopening the item with a draft resumes editing, with a warning if GitLab changed meanwhile.
- **Activity:** comments oldest first, rendered; then the **comment composer**: a compact editor with Write/Preview and ⤢ Expand, `@`/`#`/`/` completions, options **Push follow-up +3 days** and **Close the action** (or Mark adopted) for open trackable items; `Ctrl/⌘+Enter` posts. The button reads Comment, or Update/Close when only an option is ticked. Drafts are kept per item (`comment:<projectId>:<iid>`).
- **Rail:** Follow-up (date, relative text, today/+1d/+3d/+1w/+2w, date picker); Linked (meeting, the standard of an adoption issue, every `#iid` in the description that is a loaded item); History (GitLab system notes, newest first, plus "Created in <meeting>").

### 8.4 Capture (`Capture.tsx`): meeting notes, full screen

- **Top bar:** ← Meetings (the notes stay as a draft), meeting title (datalist of known series; Enter jumps to the notes), date (reference date for relative `due:` tokens), "recurring, session N" when the title matches a series (else "one-off meeting"), Write / Split / Preview / Changes, draft status ("Draft saved HH:MM"), **Cancel** (inline confirmation, discards the draft), **Save to GitLab** (`Ctrl/⌘+S`, also outside the text).
- **Attendees row:** chips. Each comma-separated name is resolved with `resolveAttendees` against known users (avatar and full name) or shown as a guest. Enter or comma adds, × removes, Backspace in the empty box removes the last. Stored as the same comma-separated `attendees` string. "Started from the agenda · N open items carried over" when the notes came from Prepare.
- **Toolbar:** the editor toolbar (§8.9) plus an **ARCH** group: **+ Action** (`ACTION @` and the people list), **+ Decision**, **+ Standard**, **Update item ▾** (DONE / UPDATE / PUSH / DROP / ADOPTED `#` and the item list), **Due date ▾** (the `due:` tokens with their dates, or a date picker); and Wrap, Lines, Panel (with the error count).
- **Editor:** meeting mode: keywords, `@people`, `#refs` and `due:` dates are highlighted (unknown users and unreadable dates underlined in red, closed actions struck through); `/` offers the Arch lines first.
- **Preview** ("as it will be saved", `meetingPreview.ts`): Markdown, with every new item as a card (kind, title, owner name, due date, details) and every update as a card (op, item title, new date, note, problem); unticked lines are dimmed. Ticking an agenda checkbox in the preview ticks it in the source, which turns it into a DONE card.
- **Changes:** the notes compared with the agenda they started from (`base`), or with nothing.
- **Side panel:** **Items** (Will create / Will update with checkboxes, as before: updates with an `err` problem start unticked; skips keyed by `line:title`; clicking a row jumps to its line), **Outline**, **Checks** (§8.9; meeting checks: unknown `@user` as an error, unreadable `due:`, updates that can't apply, update keywords without a number, a due date on a decision), **Keys**.
- **Status bar:** line/column, words, lines, "N new · M updates", problems, target project.
- `@usernames` are validated against GitLab (debounced 450 ms). Saving is not blocked by problems; failing items are reported as before.
- The form is autosaved to `arch.capture-draft.v1` (with `base` and `at`) 400 ms after each change and cleared after a successful save. **Save** runs `captureMeeting`, toasts `Meeting saved: N new, M updated` (and any failures), reloads, goes to Meetings and opens the new meeting in the quick look.

### 8.5 Settings (`SettingsView.tsx`)

The fields are listed in §9. "Test connection" checks `/user`, the follow-ups project, and, if a standards repository is set, that repository and its wiki target (with a hint that group wikis need Premium, or that the project wiki may be disabled). A "Failed to fetch" error gets a hint about VPN or CORS. "Try it with demo data" switches to demo settings. In demo mode, a banner offers "Reset demo data".

Teams are entered as a textarea, one per line: `Name | @team-handle | @usual-responsible` (handle and responsible optional). Categories as `folder | Label` (an empty list restores the defaults). Wiki: kind (project or group), path (empty = the standards repository), folder.

### 8.6 Visual design

- CSS variables in `:root`, dark theme via `prefers-color-scheme`. Dark navigation sidebar and warm off-white content. Accent `#c2410c`.
- Kind colours: action orange, decision green, standards and adoption purple, meeting blue.
- Layout: grid with a 228 px nav, content, and a 460 px quick look when open. Below 1100 px the quick look becomes an overlay and the board/stats reflow. Full-screen editors are fixed overlays over the shell (`.fs`); below 1100 px their side panel floats over the text and the item rail moves under the main column.

### 8.7 Prepare (`Prepare.tsx`, logic in `lib/prep.ts`)

Goal: walk into a meeting knowing what's open with the people in it, then run the meeting from that agenda.

**Inputs (left panel)**
- **Meeting** (text with a datalist of known series).
  - A *series* is all meetings whose title, without the trailing ` (YYYY-MM-DD)`, matches case-insensitively with whitespace collapsed (`seriesKey`). Sessions are sorted by the title date, newest first.
  - A hint shows whether the title matched a series (number of sessions, link to the last one).
  - When a series matches and no attendees are set, attendees are filled from the last session's `**Attendees:**` line.
- **Date** of the upcoming session (default today). It becomes the capture date.
- **Attendees**: chips.
  - Typing a name and pressing Enter or `,` (or leaving the field) resolves it with `resolveAttendees` against `ctx.userMap`: exact username, then exact full name, then a first name only one known user has.
  - Unmatched names stay as italic "guest" chips: they appear in the agenda but don't drive matching.
  - The current user is never added as an attendee. Backspace in an empty field removes the last chip.
- **Teams in the room** (if teams are configured): adds their open adoption issues.
- **Other topics**: free lines, added to the agenda as `### Other topics`.

**Sections (`buildPrep`)**, each item listed once, in this priority order:

| Section | Rule |
|---|---|
| Open from previous sessions | Open actions whose `meetingIid` is any session of the series |
| Waiting on attendees | Other open actions assigned to an attendee |
| On my side | Other open actions that are mine (`isMine` rule) **and** involve an attendee: the attendee authored it, it mentions `@attendee` in title/description, or it came from a meeting whose attendee line resolves to that attendee |
| Standard adoption | Open adoption issues from a session of the series, assigned to an attendee, or of a selected team |
| Decisions from <last session date> | Decisions created in the last session, to read back |

- Actions are sorted `byDue`; decisions by IID.
- Empty sections are hidden. If everything is empty, a single message says so.
- Every row has a checkbox (unticked = left off the agenda), and the title opens the quick look.

**Outputs (sticky bar)**
- **Copy agenda** (`agendaMarkdown`): `## <title> — <date>`, attendees, one `###` per non-empty section, then other topics.
  - Actions are `- [ ] <project>#<iid> <title> — @assignee, <humanDue>`.
  - Adoption issues are listed like actions (they are closed with a tick, `DONE` or `ADOPTED`). Decisions are plain refs.
  - Full `group/project#iid` references link correctly when pasted anywhere in GitLab.
- **Post on last session** (only when a series matched): posts `**Agenda for the next session**` plus the agenda as a comment on the last session's issue. @mentions in it notify people; the button's tooltip says so.
- **Start meeting notes →**: writes the capture draft (`title`, `date`, attendee names joined by `, `, `notes = agendaNotes(...)`) and opens Capture.
  - `agendaNotes` uses short `#iid` refs and annotations in parentheses without `@`, so nobody gets assigned or notified by accident. Every line is inert until ticked or prefixed (§6.4).
  - It ends with an empty `### Discussion` section for new items.
  - If Capture already holds unsaved notes, the first click only warns and the button changes to "Replace unsaved notes →". The second click replaces them.

### 8.8 Standards (`Standards.tsx`)

Without a standards repository in Settings the screen only links to Settings. Otherwise it loads the catalog (§4) on first visit.

**Catalog (list)**
- Toolbar: search (title, id, tags and body), repository name, reload, **+ New standard**. Category chips (configured categories plus any folder found in the repo) with counts.
- Banners: the wiki could not be read (`wikiError`); or N standards are newer than the wiki, with **Publish to wiki** (publishes those and the index).
- **Proposed**: open merge requests for new standards (link to the MR, "in review", version).
- One section per category; each row: title, id, tags, "deprecated", "vX in review" for open changes, the latest adoption cycle (`v1.0: 1/3 adopted · 1 overdue`, red when overdue), the wiki state (`wiki ✓`, `wiki v1.0` or `not on wiki`) and the version.

**Detail panel** (right of the list, sticky; stacks below 1100 px)
- Category, version, deprecated; title; owner, last update, tags; links: Wiki (when published), Source, History.
- **Wiki**: up to date, or "the wiki still shows vX" / "not on the wiki yet" with **Publish vY**.
- **Changes**: open merge requests for this standard; **Propose change** and **Deprecate…** (the editor with status set to deprecated and a major bump).
- **Adoption**: one block per cycle (newest first): team, responsible, deadline while open, and adopted / open / superseded / dropped; a row opens the adoption issue in the quick look. A hint when the current version is a major step from the last cycle. **Start adoption of vX…** opens the cycle form; it is hidden, with "Every team is in the vX cycle", when every configured team already has an open or adopted issue for the current version. Deprecated standards don't offer cycles.
- **Versions**: the changelog; **Show commits** loads the file's git history.
- **Content**: the body as plain text.

**Cycle form**: one row per configured team: checkbox (disabled with a note if the team already has an open issue for this version), responsible (default: the team's lead; required) and deadline (default `today + adoptionDays`); "Close open issues for older versions as superseded" (default on); **Create N issues**, then a toast with the count and another listing per-team errors.

**Editor** (`StandardEditor.tsx`, full screen over the list)
- **Top bar:** ← Standards (the draft stays), category tag, title, `vX → vY` (or "new · v1.0") and the file path, Write / Split / Preview / Changes, draft status, Cancel (discard the draft, keep it and leave, or keep editing), **Open merge request** (`Ctrl/⌘+S`; its tooltip lists what's missing).
- **Toolbar:** the editor toolbar with Insert extended by MUST / SHOULD / MAY rules and a do/don't example, and a **RULES** group: + MUST, + SHOULD, + Example, **Sections ▾** (Context, The standard, Rationale, Examples, Exceptions, How to adopt; "already there" when present).
- **Banner** when other merge requests change the same standard: "Another change to this standard is in review: !N vX … Yours starts from vY on main; whoever merges second will be asked to rebase", with a button per merge request.
- **Changes:** the body compared with the version on the default branch; **Include header and changelog** compares the whole file as it would be committed (`renderStandardFile(nextVersion(...))`, or `newStandardDoc` for a new one).
- **Side panel:** **Change** (Minor/Major with the resulting versions and what each means, "What changed" for the changelog, Active/Deprecated; for a new standard the changelog note), a **merge request preview** (title, branch → default branch, file) and the list of problems that block it (no title, empty body, no note for a change, nothing changed, id already used, unknown owner); **Details** (category, owner, tags, id; moving category moves the file); **Outline**; **Checks** (Markdown checks plus: no "The standard" or "How to adopt" section, lower-case rule keywords, template placeholders left); **Keys**.
- Drafts per standard (`std:<id>` or `std:new`) keep the body and every field; reopening restores them, with a warning if the version on main changed meanwhile.
- **Open merge request** → `proposeNew` / `proposeChange` (unchanged), toast `Merge request !N opened for review`, draft dropped, catalog reload, back to the list with the standard selected.

### 8.9 The editor (`src/editor/`, ported from GitLab Everything)

The editor core is copied from GitLab Everything's wiki editor (`src/wiki/editor/*`, `src/lib/markdown/render.ts`, `src/lib/wiki/{checks,diff,tables}.ts`) and adapted; it is not a shared package. When fixing a bug in one, check the other.

- **CodeMirror 6** with Markdown, history, search panel (`Ctrl/⌘+F`, `Ctrl/⌘+H`), bracket matching and closing, multiple cursors, active-line highlight, lint gutter, optional line numbers and wrapping. The theme uses Arch's CSS variables (light and dark).
- **Keys:** `Ctrl/⌘+B/I/E/K`, `Ctrl/⌘+Shift+X/8/7/9/.`, `Ctrl/⌘+Alt+0…6` (headings), `Ctrl/⌘+Shift+D` (duplicate line), `Tab`/`Shift+Tab` (accept a completion, next/previous table cell, indent lists), `Ctrl/⌘+S` save, `Ctrl/⌘+Enter` post (composer) or save, `Ctrl/⌘+Alt+P` toggle preview.
- **Toolbar:** undo/redo, Heading ▾, bold, italic, strikethrough, code, bulleted/numbered/task lists, quote, link, Table ▾ (size picker and row/column operations), Code block ▾ (language), + Insert ▾ (callouts, collapsible section, flowchart, footnote, table of contents, date, keyboard key), Find. A compact variant is used in the description card and the composer.
- **Completions:** `/` blocks and Arch lines for the editor's mode (meeting, description, comment, standard); `@` people — attendees first ("In the room"), then known users and project members (`GET /projects/:id/members/all?query=`, cached per query for the page load); `#` items (open first, then closed); `!` open merge requests of the standards repository (standard editor); `§` standards (links to their wiki pages); `due:` date tokens with their dates.
- **Highlighting** (`ArchKnowledge`): Arch keywords at line start (meeting notes only), `@mentions` (red wavy for users GitLab doesn't know), `#refs` (struck through when a finished action, red when unknown), `due:` tokens (red when unreadable).
- **Checks** run 400 ms after typing and show in the gutter, as underlines and in the Checks tab: heading jumps, duplicate headings, missing space after `#`, links/images without target or text, `javascript:` links, `<script>`, table rows with the wrong cell count, unclosed code blocks; plus the mode's own checks (§8.4, §8.8).
- **Views:** Write, Split (preview scrolls with the source and back, "Scroll together"), Preview, Changes (line diff, unchanged runs collapsed with 3 lines of context). View, side panel, wrap, line numbers and scroll sync are remembered per browser.
- **Rendering** (`markdown.ts`): a GitLab Flavored Markdown subset: headings, emphasis, strikethrough, highlight, inline and fenced code, tables with alignment, nested and task lists, quotes, GitLab alerts (`> [!NOTE]` …), `<details>`, `[[_TOC_]]`, footnotes, reference links, autolinks, images (http(s) and `data:image` only), `#123` (links to loaded items), `!12`, `@user`, a small set of inline tags. Mermaid and math are shown as code (GitLab renders them). Every top-level block carries `data-line` for scroll sync and task toggles. `MarkdownView` passes the HTML through DOMPurify before it reaches the DOM.
- **Drafts** (`drafts.ts`): unsaved text per document, written 400 ms after a change; dropped on save or discard. A `beforeunload` warning protects unsaved description edits.

## 9. Settings & browser storage

| localStorage key | Content |
|---|---|
| `arch.settings.v1` | `Settings` JSON |
| `arch.capture-draft.v1` | In-progress meeting notes: `{ title, date, attendees, notes, base?, at? }` (`base` = the agenda it started from) |
| `arch.drafts.v1` | Editor drafts by key: `desc:<pid>:<iid>`, `desc:<pid>:<iid>:mine`, `comment:<pid>:<iid>`, `std:<id>`, `std:new` → `{ content, base, at, extra? }` |
| `arch.editor-prefs.v1` | `{ view, side, wrap, lineNumbers, syncScroll }` |
| `arch.demo-db.v3` | Fake GitLab database (demo mode only). v3 adds seeded comments and a task list; older databases are ignored |

**Legacy migration:** `migrateLegacyStorage()` runs in `main.tsx` before the first render. For each old `loose-ends.*` key it copies the value to the matching `arch.*` key, unless the new key already exists, and then removes the old key.

```ts
interface Settings {
  baseUrl: string;            // https://gitlab.example.com (trailing slashes stripped by client)
  token: string;              // PAT, scope `api`
  followupsProject: string;   // full path
  standardsProject: string;   // full path, optional (the Standards screen needs it)
  standardsFolder: string;    // default 'standards'; files at <folder>/<category>/<id>.md
  wikiKind: 'project' | 'group';   // default 'project'
  wikiPath: string;           // '' = the standards project's wiki
  wikiPrefix: string;         // default 'standards'; wiki folder and index page slug
  categories: { key: string; label: string }[];   // default: api, react, devops, security, architecture, data
  crews: { name: string; handle?: string; lead?: string }[];   // teams; lead = usual responsible for adoption
  adoptionDays: number;       // default 30
  defaultFollowUpDays: number;// default 7
  demo: boolean;
}
```

New keys are filled from `defaultSettings` when an older settings object is loaded. Bump the key suffix (`.v2`) and migrate in `loadSettings` if the shape changes incompatibly.

---

## 10. Demo mode & tests

### Fake GitLab (`lib/demo.ts`)

`createFakeGitLab(initialDb?, persist=false)` returns `{ fetch, db, merge(projectId, mrIid) }`. It implements:

```
GET  /user
GET  /users?username=
GET  /projects/:idOrPath
GET  /projects/:id/members/all?query=
GET|POST /projects/:id/labels
GET  /projects/:id/issues?state&labels(AND)&updated_after&per_page&page   (sets x-next-page)
POST /projects/:id/issues
GET  /projects/:id/issues/:iid
PUT  /projects/:id/issues/:iid   (title, description, due_date, assignee_ids, labels, add_labels, remove_labels, state_event)
GET|POST /projects/:id/issues/:iid/notes
POST /projects/:id/issues/:iid/links          (no-op)
GET  /projects/:id/repository/tree?path&ref   (blobs only; 404 for a missing folder)
GET  /projects/:id/repository/files/:path/raw?ref   (ref may be a branch or a commit id)
GET  /projects/:id/repository/commits?path&ref_name
POST /projects/:id/repository/commits         (branches copied from start_branch; create/update/move/delete; changes recorded per branch)
POST /projects/:id/merge_requests
GET  /projects/:id/merge_requests?state       (paged)
GET  /projects/:id/merge_requests/:iid
GET|POST       /projects|groups/:id/wikis      (?with_content=1; POST derives the slug from the title)
GET|PUT|DELETE /projects|groups/:id/wikis/:slug
```

`merge()` applies a merge request's branch changes to its target and moves its commits there. In demo mode, merge requests created in the app merge automatically 30 s after creation (when listed or read), so the publish and adoption flow can be tried; seeded ones don't.

```
```

Anything else returns 404 `Demo does not implement …`.

`seedDb(today, {labels})` builds a realistic dataset relative to `today`:
- users: `marco` (the current user), `anna.keller`, `jonas.weber`, `sofia.ricci`, `lukas.brunner`, `priya.nair`
- two meetings
- three decisions
- seven actions: overdue, due today, upcoming, waiting on others, and one closed
- four adoption issues and one closed old action
- the standards repository with four standards (API, React, DevOps, Security), their commit history, an open change (React 1.1 in review), and a project wiki that is up to date except the container baseline (wiki 1.0, file 2.0)
- an adoption cycle for API error format v1.0 (Payments adopted, Onboarding overdue, Data open) and one for Container image baseline v2.0 (Payments)
- a group `architecture` (id 20) with an empty group wiki

Projects: `architecture/follow-ups` (id 11) and `architecture/standards` (id 12).

### Tests (`tests/*.test.ts`)

- `dates`: every token form against a fixed Wednesday, `2026-11-18`.
- `parser`: assignee forms, defaults, decisions, standards to write, false-positive guard, details collection.
- `model`: marker idempotence.
- `service` (against the fake): label bootstrap; end-to-end meeting capture (a STANDARD line becomes a "Write standard" action); unknown-assignee resilience; nudge.
- `standards.test.ts`: versions; file round trip (quoting, owner normalisation, lenient parsing); paths and slugs; wiki page and index; catalog with wiki state and proposals; new standard → merge → publish → index; change with major bump and category move (old wiki page removed) and history; stale-version refusal; adoption cycles (per-team issues, what changed, unknown user, superseding, duplicate refusal); group wiki; unreadable wiki; CI sync (publish, prune, no-op, force, missing token).
- `prep.test.ts`:
  - every update form, plus lines that must *not* parse as updates
  - `updateNote` stripping
  - `parseMeeting` separating items from updates
  - series naming and attendee resolution
  - `buildPrep` for a recurring meeting and for a 1:1 with teams (adoption issues)
  - agenda and notes rendering, including that untouched agenda notes parse to nothing
  - a capture that creates and updates at once, covering every op (ADOPTED on an adoption issue) and a 404
  - the rejection cases
  - quick-add updates with reassignment
- `migration.test.ts`: legacy storage keys.
- `editor.test.ts`: renderer (blocks, escaping, markers dropped, item references, alerts, tables, line offsets, outline, word count); diff and collapsing; tables; Markdown, meeting and standard checks; marker split/join and task toggling (including moved lines and a vanished task); meeting preview cards; slash menu per mode and `due:` suggestions; ticking a task against the fake while someone edited the issue, with markers and history notes kept.

**Rule:** new parser or date behaviour needs a unit test. A new service use case needs a fake-backed test, and any new endpoint must be added to the fake.

### Browser tests (`e2e/`, Playwright)

They run against the built app in demo mode, so they need neither GitLab nor network. `e2e/fixtures.ts` gives every test:
- a fresh demo workspace (new browser context, "Try it with demo data") with the clock fixed at **2026-11-26 09:00, Europe/Zurich**, so the seeded follow-up dates are always the same;
- `demo`, which reads and changes the fake GitLab's database through `window.__archDemo` (demo mode only), e.g. to edit an issue "in GitLab" behind the app's back;
- an automatic guard that fails the test if the page logs an error or throws;
- helpers `typeAtEnd` (type into a CodeMirror editor), `editorText`, `toast` and `pick` (click a completion: CodeMirror ignores Enter for a moment after the list opens, so tests click).

Covered:
- `meeting.e2e.ts`: capture with attendee chips, the Arch toolbar, `@` completion, card preview, Items tab, status bar and `Ctrl/⌘+S`, then the meeting in Meetings and the issues in "GitLab"; an unknown `@user` (highlight, Checks tab, panel badge, partial save with the failure reported); notes from Prepare (series hint, Changes against the agenda, ticking an agenda item in the preview turns it into DONE and closes the item); the draft surviving a reload, and Cancel discarding it.
- `items.e2e.ts`: quick look task tick (saved, markers kept); ↑/↓, Enter, ←/→ and Esc; `E` opening the description editor without typing the key, `#` completion, save with markers and history; the edit conflict (Compare, Load their version; Save mine anyway); a comment that pushes the follow-up and closes the action; nudge; deep links and an unknown number.
- `standards.e2e.ts`: a major change with a rule from `/`, the version shown, the body and whole-file diffs, the merge request in "GitLab"; refusal without a changelog note; the banner for another open proposal; a new standard's draft kept when leaving.

Selectors are the ids and `data-*` attributes the screens already have (`#capture`, `#cap-editor`, `#item-screen[data-iid]`, `#desc-save`, `#std-submit`, `[data-view]`, `[data-tab]`, …): keep them stable, or update the tests with them.

**In GitLab CI/CD** (`.gitlab-ci.yml`): two parallel jobs on merge requests and branch pushes. `unit` runs on `node:22` (unit tests with a JUnit report, then `npm run build:sync`); `e2e` runs on `mcr.microsoft.com/playwright:v1.65.1-noble`, which already contains the browser, and keeps `test-results/` (traces and screenshots of failures) for a week. Both reports appear in the merge request's test summary. Constraints:
- The runner needs the Docker executor. Where runners can't reach Docker Hub or `mcr.microsoft.com`, use the company registry's mirror or dependency proxy (e.g. `image: $CI_DEPENDENCY_PROXY_GROUP_IMAGE_PREFIX/node:22`).
- The Playwright image tag must equal the `@playwright/test` version, which is therefore pinned exactly in `package.json`; upgrade both together.
- `npm ci` needs the npm registry (or the company's npm mirror via `.npmrc`).

Not covered yet: a real GitLab instance; Firefox and Safari; narrow windows and dark mode.

---

## 11. Invariants & conventions for contributors

1. **Data compatibility first.** These are read back from existing data: label names (§3.1); the marker format and keys (§3.2); a meeting's `### Updated` lines; the standard file format (front matter keys, `## Changelog` table) and paths (§3.4); the wiki page marker `<!-- arch:standard id=… version=… -->`; the merge request marker `<!-- arch:proposal … -->`. Changing them needs backward-compatible parsing or an explicit migration. `lib/standards.ts` is also bundled into the CI sync that runs in the standards repo, so keep it dependency-free and keep the CI script and the app on the same version.
2. **GitLab is the only store.** Don't add a backend or database. Per-browser conveniences may use localStorage (wrapped in try/catch) with a versioned key.
3. **Security.**
   - Issue content can be written by anyone with project access, and the page holds a PAT. It is rendered only through `editor/markdown.ts` (which escapes everything first and emits a fixed set of tags; links only `http(s):`/`mailto:`, images only `http(s):`/`data:image`) **and** `MarkdownView`, which passes the result through DOMPurify. Never put issue text into `dangerouslySetInnerHTML` any other way.
   - If you add GitLab's `POST /markdown` as a renderer, sanitise its HTML the same way (GitLab Everything's `sanitizeGitLabHtml` is the model).
   - Never send the token anywhere except `settings.baseUrl`.
4. **Pure core.** Keep `parser`, `dates` and `model` free of I/O and React. Put GitLab orchestration in `Service`. Components call the service through `run(...)` and merge results with `upsert(...)`.
5. **Single assignee.** Code reads `assignees[0]` and writes `assignee_ids: [id]`. Multi-assignee support is a deliberate enhancement (§13), not an accident to "fix" piecemeal.
6. **Local dates only.** Use `todayIso()` and the `dates.ts` helpers. Never use `toISOString().slice(0,10)` for calendar dates (UTC drift).
7. **No UI library.** Extend `ui.tsx` and `styles.css`; use the CSS variables; keep both light and dark themes working.
8. **No blocking dialogs** (`alert`, `confirm`, `prompt`). Use the double-click pattern or inline confirmation.
9. Keep `README.md` (user-facing) and this spec (contributor-facing) in sync with behaviour.

---

## 12. Known limitations / technical debt

| # | Limitation | Notes |
|---|---|---|
| L1 | Closed actions and adoption issues older than 90 days are not loaded | By design for speed. Cycles of old versions may look incomplete. A history/search view would need a separate paged query |
| L2 | Single assignee only | §11.5 |
| L3 | ~~Descriptions are plain text~~ | Fixed in v0.4: rendered Markdown (§8.9). The renderer is a subset: Mermaid and math are shown as code |
| L4 | Editing a saved meeting's notes doesn't create items | The notes can be edited full screen since v0.4, but new `ACTION:` lines there are just text; new items must be added via Quick add, which isn't linked to the meeting |
| L5 | Quick-add items have no meeting link | Could offer "attach to meeting" |
| L6 | No polling or live updates | Manual ↻. The Waiting view can be stale if people close issues in GitLab |
| L7 | `captureMeeting` creates items sequentially | ~3 requests per item; fine for <30 items. Could be parallelised with a concurrency limit |
| L8 | Partial failure leaves a meeting with fewer outcomes | Errors are reported, but there is no retry UI for failed drafts |
| L9 | Teams are matched by **name** | Renaming a team in Settings starts a new history: earlier adoption issues keep the old name, so "what changed since the last adopted version" restarts. A stable team id in the `team` marker would fix it |
| L10 | The PAT lives in localStorage | Acceptable for a personal tool. OAuth (PKCE) would be better for wider use |
| L11 | ~~`GitLab.projectMembers` is unused~~ | Used since v0.4 by `@` completions. The Owner field and attendee chips still use the `#users` datalist (users seen in loaded items) |
| L12 | The "overdue" stat tile has no click target | Could filter Focus to overdue only |
| L13 | Never exercised against a real GitLab instance (browser tests exist since v0.4.1, against the fake) | First real run may surface CORS or permission issues (e.g. `links` API, label creation needs Maintainer) |
| L14 | `tsconfig` includes tests; `vite.config.ts` casts `test` with `as any` | Could switch to `vitest/config` `defineConfig` |
| L15 | Decision supersession isn't modelled | "We changed our mind" is just a new decision |
| L16 | Series are matched by title only | Renaming a recurring meeting starts a new series. A `fu:series=<key>` marker would make this explicit |
| L17 | Attendee resolution only knows users seen in loaded items | New people must be typed as a username or stay guests. Fix with `projectMembers` autocomplete (backlog 6) |
| L18 | "On my side" is a heuristic | It can miss items (no author, mention or shared meeting) and include loosely related ones; the user unticks them |
| L20 | Comments can't be edited or deleted in Arch | Do it in GitLab |
| L21 | The editor adds ~200 kB gzipped (CodeMirror with the HTML/CSS/JS grammars that Markdown embeds) | Split into its own cached chunk; could be lazy-loaded on first edit |
| L22 | No image or file upload in the editors | GitLab Everything has paste/drop upload; Arch would need `POST /projects/:id/uploads` in the client and the fake |
| L19 | The meeting's own notes keep the agenda text as typed | `- [x] #7` stays in the notes; the authoritative record is `### Updated` and the comments on each item |

---

## 13. Enhancement backlog (suggested priority)

Each entry: **goal**, then a sketch of the approach. Effort: S = hours, M = a day or two, L = more.

### P1: makes daily follow-up better

1. **Weekly digest (M).** A "Prepare digest" view that builds markdown for overdue items, waiting-on-others per person, standards adoption status and decisions made this week. Copy it, or post it as a note on a configurable "weekly digest" issue. A later version could make this a scheduled GitLab CI job using the same `lib/` code in Node.
2. ~~**Per-person 1:1 view**~~: done in v0.2 as Prepare with "Prepare 1:1" (§8.7). Possible follow-up: a `#/person/<username>` deep link that opens Prepare for that person.
3. **Browser reminders (S).** Use the Notification API while the tab is open: alert once a day for items due today and overdue. Keep "last notified" per IID in localStorage.
4. **Add to existing meeting (S).** On the meeting's full screen, an editor in meeting mode with the capture syntax (new items *and* updates, via `parseMeeting`) that creates or updates items linked to that meeting and appends them to its Outcomes section (fixes L4/L5).
5. **Retry failed drafts (S).** After a partial capture failure, keep the failed drafts in the capture screen with the error, so you can fix `@user` and retry against the same meeting (fixes L8).
6. **Assignee autocomplete from project members (S).** Partly done in v0.4 (`@` completions in every editor). Still to do: the Owner field and the attendee chips in Prepare and Capture (L11, L17).
6a. **Explicit series (S).** Write `<!-- fu:series=<key> -->` on meetings created from Prepare, and let Prepare rename or merge series (L16).
6b. **Agenda as a pre-meeting issue (S).** Optionally create the upcoming meeting's issue at prep time, in the open state with the agenda, and let Capture fill that issue instead of creating a new one.

### P2: richer standards and decisions

7. **ADR export for decisions (M).** "Write ADR" on a decision: a template pre-filled from the decision and its meeting, proposed through the same branch + merge request flow into a configurable `adr/` folder (`NNNN-slug.md`). Generalise `StandardsService.openProposal` into a document-proposal helper.
8. **Decision supersession (S).** A `fu:supersedes=<iid>` marker plus a UI action "Supersede…". The log shows superseded decisions struck through with a link to the replacement.
9. **Adoption evidence and exceptions (S).** Let a team close its adoption issue with a link to the MR that adopted it, or ask for an exception (a label or marker `outcome=exception` with a reason), shown in the cycle.
10. **Adoption issues in the teams' own projects (M, optional).** Create each adoption issue in the team's project (a project per team in Settings), linked back, so it lands on their board. The catalog would then query several projects.
11. **Read-only catalogue for teams (S).** A public page (or the wiki index, which exists since v0.3) listing standards by category with versions and each team's adoption state.

### P3: platform & scale

12. ~~**Markdown rendering**~~: done in v0.4 with the ported renderer (§8.9). Possible follow-up: GitLab Everything's "Portal / GitLab" renderer switch using `POST /api/v4/markdown`, for Mermaid, math and exact GitLab output.
13. **Multi-assignee (M)** for Premium instances: model `assignees: GlUser[]`; Waiting groups by each assignee (L2).
14. **Background refresh (S).** Refetch open items every N minutes while visible (`document.visibilityState`), and on window focus (L6).
15. **History & search (M).** A paged search across all closed items, using GitLab `search` or `issues?search=` (L1).
16. **OAuth PKCE login (M)** as an alternative to the PAT (L10).
17. **Integration into GitLab Everything (M).** The `lib/` folder is framework-free, so it can be published as an internal package or copied as a module in Marco's existing GitLab portal.
18. ~~**E2E tests**~~: done in v0.4.1 (§10). Possible follow-ups: Prepare, Waiting and the adoption-cycle form; Firefox/WebKit projects; a narrow-window and dark-mode pass with screenshots.
20. **Uploads in the editors (S).** Paste or drop images and files, as in GitLab Everything (L22).
21. **Lazy-load the editor (S).** `import()` the editor chunk on first use of a full-screen screen (L21).
19. **Import from calendar (L).** Pre-fill meeting title, date and attendees from an Outlook/ICS export or a connector.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Team (crew) | A delivery team that may have to adopt standards; configured in Settings with an optional handle and usual responsible person |
| Follow-up date | The GitLab `due_date` of an action: when Marco should next check on it, not necessarily the assignee's deadline |
| Waiting on others | An open action or adoption issue assigned to someone other than the current user |
| Nudge | A GitLab comment that @-mentions the assignee, plus pushing the follow-up date out |
| Draft (parser) | An item parsed from text but not yet created in GitLab |
| Outcomes | The list of items appended to a meeting issue's description |
| Series | Meetings sharing a title (without the date), e.g. every "Architecture Board" |
| Standard | A versioned document in the standards repository, mirrored to the wiki. Independent of adoption |
| Adoption cycle | The adoption issues of one version of a standard, one per team |
| Proposal | An open merge request that creates or changes a standard |
| Update (parser) | A line that changes an existing item: DONE / DROP / UPDATE / PUSH / ADOPTED `#iid` |
| Agenda | Output of Prepare: shareable markdown, or notes that seed Capture |

---

## 15. Changelog

| Version | Date | Changes |
|---|---|---|
| v0.4.1 | 2026-11-27 | Browser tests with Playwright in demo mode (`npm run test:e2e`, `e2e/`): meeting notes, quick look and item full screen, standard editor; fixed date and timezone, page-error guard. GitLab CI/CD pipeline (`.gitlab-ci.yml`) running unit tests, the CI sync build and the browser tests. `@playwright/test` pinned to the version of the CI image. |
| v0.4 | 2026-11-26 | Full-screen editing everywhere, built on GitLab Everything's CodeMirror editor (ported into `src/editor/`): meeting notes (toolbar with Arch lines, attendee chips, card preview, Items/Outline/Checks/Keys panel, Changes against the agenda), item page `#/item/<iid>` (description editor with conflict-safe save and drafts, comment composer with push/close options, rail with follow-up, links and history), standard editor (Change/Details/Outline/Checks panel, merge request preview, whole-file diff, other-proposal banner). The drawer became a read-only quick look (task ticks save at once; ↑/↓, Enter, E, C). `@` completions use project members; Markdown is rendered and sanitised with DOMPurify. Fake GitLab writes system notes; demo database v3 with comments. New storage keys `arch.drafts.v1`, `arch.editor-prefs.v1`. |
| v0.3 | 2026-11-26 | **Breaking for standards** (never used against a real GitLab): issue-based standards (`fu::standard`, `fu-std::*`, adoption checklists) replaced by documents in the standards repo (front matter, major.minor versions, changelog, categories), proposed in merge requests, mirrored to a project or group wiki with an index page, with optional per-team adoption cycles as `fu::adoption` issues. Standards screen (catalog, detail, editor, cycle form). `STANDARD:` lines create "Write standard" actions; `ADOPTED #id` closes adoption issues. Settings for wiki, categories, team leads and adoption deadline. Optional CI wiki sync (`npm run build:sync`). Demo database v2. |
| v0.2 | 2026-11-19 | Prepare screen (series, attendees, crews, agenda copy/post, start notes from the agenda). Update syntax for existing items in notes and Quick add. `### Updated` in meeting outcomes. Entry points from Meetings, the meeting drawer and Waiting on others. `p` shortcut. |
| v0.1.1 | 2026-11-19 | Renamed Loose Ends → Arch, arch icon, storage-key migration |
| v0.1 | 2026-11-18 | Initial build |
