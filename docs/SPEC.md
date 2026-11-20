# Arch: Product & Technical Specification

> Audience: engineers and AI coding agents extending this codebase.
> Status: v0.2 (2026-11-19: meeting preparation and in-meeting updates; see §15 Changelog). This document describes **what exists today**. §12 lists known gaps and §13 a prioritized enhancement backlog.
> Keep this file current: any change to behaviour, data contracts or architecture must update the matching section in the same change.

---

## 1. Purpose

Marco is a software architect who has many meetings where decisions are made. Each meeting leaves "loose ends" that must be followed up:

1. **Actions**: something assigned to him or to someone else, which he must chase.
2. **Decisions**: something agreed, which must stay findable later ("when did we decide X, and why?").
3. **Standards**: a rule that must be written up, published, and then **adopted by every crew** (delivery team).

Arch is a capture-and-follow-up tool on top of **GitLab**, which the organisation already uses. GitLab issues are the system of record. The app adds:

- fast capture of meeting notes, with inline syntax that turns lines into issues
- views organised around *following up* (overdue, waiting on others, per person) rather than around projects
- **meeting preparation**: an agenda gathered from earlier sessions and the attendees' open items, which becomes the meeting's notes and updates those items in place
- a lifecycle for standards: draft → merge request → published → adopted by each crew

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
│  components/*  (views, drawer, capture)                                                    │
│        │  React context `AppCtx` (components/ctx.tsx)                                      │
│        ▼                                                                                   │
│  lib/service.ts  ── use cases (capture meeting, nudge, publish standard, adoption…)        │
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
- **Dependency rule:** `components → service → (parser, model, dates, gitlab)`. `lib/*` must not import React. `parser`, `model` and `dates` are pure and synchronous.
- **Testability:** the `GitLab` class takes a `FetchFn`. Tests and demo mode pass `createFakeGitLab().fetch`. Any new endpoint added to `gitlab.ts` **must** also be implemented in `demo.ts`.

### Tooling

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (http://localhost:5173) |
| `npm test` | Vitest, node environment, `tests/**/*.test.ts` |
| `npm run build` | `tsc -b && vite build` → static `dist/` (relative `base: './'`, so it can be hosted under any path, e.g. GitLab Pages) |

TypeScript is `strict` with `noUnusedLocals` and `noUnusedParameters`. There is no ESLint config yet, although the source contains a couple of `eslint-disable` comments for future use.

### File map

| Path | Responsibility |
|---|---|
| `src/lib/settings.ts` | `Settings` type, defaults, demo settings, localStorage load/save, `isConfigured`, `migrateLegacyStorage` |
| `src/lib/gitlab.ts` | REST client + GitLab types (`GlIssue`, `GlUser`, `GlNote`, `GlProject`, `GlMergeRequest`), pagination, user lookup cache |
| `src/lib/dates.ts` | ISO local-date helpers, `resolveDate` (due-date tokens), `humanDue` |
| `src/lib/parser.ts` | Meeting-notes syntax → new items (`Draft`) and updates (`UpdateDraft`): `parseLine`, `parseUpdate`, `parseMeeting`, `parseNotes`, `updateNote` |
| `src/lib/model.ts` | Label constants, `Item` domain type, `toItem` mapping, hidden markers, standard description helpers, view predicates, `slugify`, `updateProblem`, `meetingUpdates` |
| `src/lib/prep.ts` | Meeting preparation: series detection, attendee resolution, `buildPrep`, agenda and notes rendering |
| `src/lib/service.ts` | `Service`: all use cases that touch GitLab |
| `src/lib/demo.ts` | Fake GitLab (`createFakeGitLab`, `seedDb`, `resetDemo`) |
| `src/App.tsx` | Shell: settings/connection lifecycle, nav, routing, toasts, `QuickAdd`, context provider |
| `src/components/ctx.tsx` | `AppCtx` / `useApp()`, `View` union |
| `src/components/Views.tsx` | Focus, Mine, Waiting, Decisions, Standards board, Meetings |
| `src/components/Capture.tsx` | Meeting capture screen with live preview of new items and updates; capture-draft storage helpers |
| `src/components/Prepare.tsx` | Prepare screen (§8.7) |
| `src/components/Drawer.tsx` | Right-hand detail panel for any item |
| `src/components/ItemRow.tsx` | `ItemRow`, `ItemList` |
| `src/components/SettingsView.tsx` | Settings form, connection test, demo switch |
| `src/components/ArchMark.tsx` | The app's arch logo as an inline SVG component |
| `public/arch.svg` | Favicon (same geometry as `ArchMark`) |
| `src/components/ui.tsx` | Small presentational pieces (KindTag, Avatar, Due, Progress, Section, Empty) and label text maps |
| `src/styles.css` | All styling. CSS variables, light theme plus `prefers-color-scheme: dark` |
| `tests/core.test.ts` | Unit tests (dates, parser, model) and service tests against the fake GitLab |
| `tests/prep.test.ts` | Update syntax, prep gathering, agenda rendering, applying updates against the fake GitLab |
| `tests/migration.test.ts` | Legacy storage-key migration |

---

## 3. GitLab data contract (stable; treat as a public API)

Everything lives in **one GitLab project**, `settings.followupsProject`. Existing user data depends on these conventions. **Do not rename labels or markers without writing a migration** (see §11).

### 3.1 Labels

| Label | Meaning | Colour |
|---|---|---|
| `fu::meeting` | Meeting record | `#6699cc` |
| `fu::action` | Action / follow-up | `#d9534f` |
| `fu::decision` | Decision record | `#5cb85c` |
| `fu::standard` | Standard to publish & adopt | `#8e44ad` |
| `fu-std::draft` | Standard: drafting | `#bdc3c7` |
| `fu-std::review` | Standard: MR in review | `#f0ad4e` |
| `fu-std::published` | Standard: published, crews adopting | `#5bc0de` |
| `fu-std::adopted` | Standard: adopted by all crews | `#2ecc71` |

- Scoped labels (`::`) replace each other automatically only on Premium/Ultimate. On Free they are plain labels. The code never relies on that exclusivity: it always removes the other `fu-std::*` labels explicitly.
- **Kind resolution** (`model.kindOf`) checks labels in priority order meeting > standard > decision > action. Issues carrying none of these labels are ignored by the app.
- **Standard status** (`model.stdStatusOf`) checks in the order adopted > published > review > draft, and defaults to draft.
- `LABEL_DEFS` in `model.ts` is the single source for label names, colours and descriptions. On connect, `Service.init()` computes `missingLabels`; the UI shows a banner whose button calls `ensureLabels()`.

### 3.2 Hidden markers in issue descriptions

The format is `<!-- fu:<key>=<value> -->`, each on its own line. The value must not contain spaces. Helpers: `getMarker`, `setMarker` (replaces the marker if present, otherwise appends it).

| Key | Value | Set on | Purpose |
|---|---|---|---|
| `meeting` | meeting issue IID | actions, decisions, standards created from a meeting | Back-link; drives "from meeting #N" and the meeting's Outcomes |
| `mr` | `<standardsProjectId>:<mrIid>` | standards after publish | MR status sync |
| `path` | repo file path, e.g. `standards/api-error-format.md` | standards after publish | Where the document lives |

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
  ### Standards
  - #20 Trace context propagation headers
  ### Updated
  - #7 Share load-test results — done
  - #10 Review the migration plan — follow-up → 2026-11-28
  ```
  Each `### ...` sub-section appears only if non-empty. `## Outcomes` is appended in a second `PUT`, together with `state_event: close`, after all items are created and all updates applied.
  - `### Updated` lines have the fixed shape `- #<iid> <title> — <summary>`. `model.meetingUpdates()` reads them back for the meeting drawer, so **treat this shape as part of the data contract**.
  - Summaries: `done`, `dropped`, `updated`, `updated, follow-up → <date>`, `follow-up → <date>`, `adopted by <crews>`, each optionally followed by ` · → @<user>` when reassigned.
- The meeting is linked (`relates_to`) to every item it created **and** every item it updated.

**Comments written by updates** (on the updated issue; `#M` is the meeting, omitted for quick-add updates):

| Op | Comment |
|---|---|
| done | `✅ Done in #M[: note]` |
| drop | `🚫 Dropped in #M[: note]` |
| push | `⏭️ Follow-up moved to <date> in #M[: note]` |
| note | `📝 Update in #M: <note>` (no comment if only the date or assignee changed) |
| adopted | per crew, the standard's usual `✅ <Crew> adopted` comment (from `toggleAdoption`) |

**Action** (`fu::action`)
- Exactly one assignee: the resolved `@user`, or the current user.
- `due_date` = follow-up date (explicit `due:`, or `today + settings.defaultFollowUpDays`).
- Description: `From meeting #N` + indented details + `meeting` marker; or just the details for quick-add items.
- Open = still to follow up; closed = done.

**Decision** (`fu::decision`)
- Created, then immediately closed by a second `PUT` (`state_event: close`). A decision is a record, not a task.
- No assignee and no due date.
- Closed decisions are still loaded (§5) and are never shown struck through.

**Standard** (`fu::standard` + one `fu-std::*`)
- The assignee is the standard's owner (the `@user`, or the current user). The `due_date` is the adoption target date. Standards do **not** get a default follow-up date.
- Description template (`model.standardDescription`):
  ```
  From meeting #N                  (only when created from a meeting)

  ## Summary
  <indented details, or "_To be written._">

  ## Document
  _Not published yet._             (replaced on publish by "[path](blobUrl) — review in <mrUrl>")

  ## Adoption
  - [ ] Payments — @platform/crew-payments
  - [ ] Data
  <!-- fu:meeting=N -->
  ```
- **The adoption checklist is the source of truth for crew adoption.** It is parsed from the `## Adoption` section: lines matching `- [ ] Name` / `- [x] Name`, where an optional ` — @handle` suffix is stripped from the name. Parsing stops at the next `## ` heading. Because these are GitLab task lists, people can also tick them in the GitLab UI and the app picks the change up on refresh.
- Crews are snapshotted from `settings.crews` when the standard is created. Changing settings later does not change existing standards; use "Add crew" in the drawer.

### 3.4 Standards repository (`settings.standardsProject`)

Publishing a standard (`Service.publishStandard`):
1. `GET /projects/:standardsProject` to get the id, `default_branch` and `web_url`.
2. `POST /repository/commits` with `branch: standard/<file-stem>-<Date.now() base36>`, `start_branch: <default>`, and one `create` action at `<settings.standardsFolder>/<slug(title)>.md`. The path can be edited in the UI.
3. `POST /merge_requests` with source = that branch, target = default branch, title `Standard: <title>`, description `Tracks <followupsProject>#<iid>`, and `remove_source_branch: true`.
4. Update the issue: set the Document section, add the `mr` and `path` markers, add a note with the MR link, and move the status to `review`.

`Service.syncStandard` runs `GET /merge_requests/:iid`. If the MR state is `merged` and the status is `review`, the status moves to `published`. The drawer calls it automatically when it opens a standard that is in review.

---

## 4. Domain model (`lib/model.ts`)

```ts
type Kind = 'action' | 'decision' | 'standard' | 'meeting';
type StdStatus = 'draft' | 'review' | 'published' | 'adopted';

interface Item {
  iid; projectId; kind; title; description /* raw, with markers */;
  open: boolean;              // state === 'opened'
  assignee?: GlUser;          // FIRST assignee only
  author: GlUser;
  due?: string;               // 'YYYY-MM-DD'
  labels; webUrl; createdAt; updatedAt; closedAt?; notesCount;
  meetingIid?: number;        // from marker
  std?: { status; adoption: {name, done}[]; mr?: {projectId, iid}; path? };
}
```

### View predicates (single source of truth; reuse them, don't re-implement)

| Predicate | Rule |
|---|---|
| `isTrackable(it)` | `open && kind ∈ {action, standard}` |
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
| `STANDARD`, `STD` | standard |

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
| `ADOPTED #14 Payments, Data` | adopted | Tick those crews on a standard (names are case-insensitive and must exist on that standard) |

- Any case is accepted; the keyword may be followed by `:`. The optional list and checkbox prefixes of §6.1 are allowed, so `- [ ] PUSH #9` works.
- `@user` written **directly after** `#iid` reassigns the item (`UPDATE #7 @anna: she takes it`). `@me` or your own username means you. Mentions elsewhere in the text are only text.
- `due:<token>` anywhere in the line sets the follow-up date (§6.3).
- **Note text** (`updateNote(text, title)`): the remaining text, after removing a leading copy of the issue's own title, an agenda annotation in parentheses `(…)`, and leading `:`/`—`/`-`. So prefixing an untouched agenda line (`DONE #7 Share load-test results (jonas.weber, 2d overdue)`) adds no comment text, while `…: shared on the wiki` does.
- Untouched agenda lines (`- [ ] #7 Title (…)`, `- #14 Title (…)`) are not updates and not items. A bare `#7 was discussed` is plain text.

**Validation** (`model.updateProblem`, using the loaded items; shown in the capture preview and Quick add):

| Case | Level |
|---|---|
| Item not loaded (e.g. closed > 90 days ago) | warn; looked up in GitLab when applied |
| Target is a meeting; `done` on a standard; `adopted` on a non-standard; unknown crew; `adopted` with no crew; `note` with nothing to change | err; skipped unless the user ticks it explicitly |
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
| `applyUpdate(update, meetingIid?)` | `GET` the issue, validate (§6.4), one `PUT` for state/due/assignee, then the comment, then link it to the meeting. For `adopted`, calls `toggleAdoption` per crew (which can close or reopen the standard). Returns `{ item, summary }` |
| `postAgenda(meetingIid, markdown)` | Adds the agenda as a comment on a meeting issue (used for "Post on last session") |
| `close / reopen / setDue / assign / rename` | Single `PUT`; return the mapped `Item` |
| `addNote / notes` | Issue notes; the UI hides `system` notes |
| `nudge(item, msg, pushDays=3)` | Posts `@assignee <msg>` (GitLab notifies them) and sets `due = today + pushDays` |
| `setStdStatus(item, status, extra?)` | `add_labels` for the target status and `remove_labels` for all other `fu-std::*`; `extra` is merged into the PUT (e.g. `state_event`) |
| `toggleAdoption(item, crew, done)` | Rewrites the checklist line and adds a note (`✅ Crew adopted` / `↩️ Crew not adopted yet`). If **all crews are done**, the status becomes `adopted` and the issue closes. If a crew is unticked while the status is `adopted`, the status goes back to `published` and the issue reopens |
| `addCrew(item, name, handle?)` | Appends a checklist line at the end of the Adoption section |
| `publishStandard(item, path, content)` | §3.4 |
| `syncStandard(item)` | §3.4 |
| `notifyCrews(item, msg)` | Posts a note that mentions the handles (from `settings.crews`, matched by **name**) of crews not yet adopted. Returns the number of handles mentioned |

---

## 8. UI specification

### 8.1 Shell (`App.tsx`)

- **Connection lifecycle:**
  - Settings are loaded from localStorage.
  - If they are configured, a `Service` is built. In demo mode it is backed by `createFakeGitLab(undefined, persist=true)`.
  - Then `init()` and `loadItems()` run.
  - Status moves `idle → loading → ready | error`. On error, or when settings are missing, the setup screen is shown.
- **Routing:** location hash `#/<view>`, where `View = focus | mine | waiting | decisions | standards | meetings | capture | settings`. Settings render in the setup layout, not the shell.
- **Nav:** a "+ Meeting notes" button and the views, including **Prepare meeting** (always opens an empty Prepare screen). Badges show: Focus = overdue + due today (accent colour); Mine; Waiting; Standards = open standards.
- **Top bar:** view title, **Quick add**, refresh button and busy spinner. The missing-labels banner appears under it.
- **Quick add:** the same syntax as one line. An update line (`parseUpdate`, §6.4) is tried first. It is applied with no meeting reference after validation, and a toast shows its summary. Otherwise `parseLine` runs; if the text doesn't parse, it is retried as `TODO: <text>`, so any text becomes an action for me. A preview pops up under the input. Enter applies or creates and opens the item; Esc clears.
- **Keyboard:** `/` focuses Quick add; `n` opens Capture; `p` opens an empty Prepare screen (all three are ignored while typing in an input); `Esc` closes the drawer.
- **`ctx.prepare(preset?)`** opens Prepare pre-filled with `{ title?, attendees?, crews? }`. The screen is re-mounted (keyed) on every call, so it never keeps stale state from an earlier preparation.
- **`ctx.userMap`**: every GitLab user seen in the loaded items (assignees, authors), plus me. It is used to resolve attendee names.
- **Feedback:** `run(label, fn)` wraps every mutation. It counts busy operations, shows a success toast (`label`, if non-empty), and shows any error as a red toast for 8 s.
- **Datalist `#users`:** every assignee and author seen in `items`, used for reassignment autocomplete.

### 8.2 Views (`Views.tsx`)

| View | Content |
|---|---|
| **Focus** | Five stat tiles: on my plate, waiting on others, overdue, standards in flight, decisions in the last 30 days. Tiles navigate on click, except overdue. Then sections over trackable items: Overdue, Follow up today, Next 7 days, No follow-up date |
| **My actions** | Trackable items where `isMine`, sorted `byDue` |
| **Waiting on others** | Trackable items where `isWaiting`, grouped by assignee username, largest group first. "Prepare 1:1" per person opens Prepare with title `1:1 <Name>` and that person as attendee. "Copy list" per person and "Copy full digest" copy markdown: `**@user**\n- <project>#<iid> <title> — <humanDue>` |
| **Standards** | A four-column board (Draft / In review / Adopting / Adopted). Cards show the due date (except in Adopted) and, in Adopting/Adopted, a progress bar and crew chips |
| **Decision log** | Full-text filter over title and description; grouped by month of `createdAt`, newest first |
| **Meetings** | Newest first. Per meeting: counts of outcomes by kind, and a pill with the number of open non-decision items, or "all closed". On hover, "Prepare next" opens Prepare for that meeting's series |

`ItemRow`:
- Actions have a round checkbox that toggles done/reopen. Other kinds show a kind tag.
- Meta line: `#iid`, "from meeting #N", comment count, and the standard status.
- Standards with crews show adoption progress.
- Actions and standards show `+1d` / `+1w` snooze on hover, a due chip (overdue in red, today in accent, ≤2 days in amber), and the owner avatar. The avatar has an amber ring when the item is waiting on someone else.
- Decisions show their creation date.

### 8.3 Drawer (`Drawer.tsx`)

Opens on the right (fixed overlay below 1100 px width) for any item, selected by IID so it always reflects the latest `items`.

- **Header:** kind tag, `project#iid` link to GitLab, open/closed pill, close button.
- **Title:** editable inline; renames on blur or Enter.
- **"From <meeting>"** link when `meetingIid` is set.
- **Actions and standards:** Owner (text input with `#users` datalist; Enter reassigns), Follow up (due chip, date input, quick buttons today/+1d/+3d/+1w/+2w), State (Mark done / Reopen).
- **Decision:** a "Recorded <date> by <author>" line with a Close/Reopen link.
- **Nudge box:** only for open actions assigned to someone else. Editable message; the Nudge button calls `service.nudge`.
- **Standard:**
  - Status stepper.
  - **Draft:** a publish box with the file path (default `<folder>/<slug(title)>.md`) and a markdown editor pre-filled from `docTemplate()`, which uses the Summary section, owner, tracking ref and adoption deadline. "Open merge request" publishes; "Skip to adoption" sets `published` without an MR.
  - **Review:** MR link and state, "Check MR status", "Mark published".
  - **Crew adoption** (all statuses): checklist toggles, Add crew. **Published only:** the notify message and "Notify pending crews".
- **Meeting:** a "Prepare next session →" button, the Outcomes list (an `ItemList` of items with this `meetingIid`), and "Updated in this meeting" (from `meetingUpdates(description)`), showing each item's current title and the summary.
- **Details/Notes:** the description shown as **plain text** (markers, "From meeting" and `## Outcomes` stripped; `**Key:**` simplified). Hidden for standards, whose content is shown in their own sections.
- **Activity:** add-note box and non-system notes, newest first.

### 8.4 Capture (`Capture.tsx`)

- Fields: Meeting title (required), Date (defaults to today; used as the reference date for relative `due:` tokens), Attendees (free text), Notes (monospace textarea with a syntax placeholder).
- The form is autosaved to localStorage key `arch.capture-draft.v1` on every change and cleared after a successful save.
- **Live preview:** each parsed draft shows its kind, title, assignee (`me` or `@user`), due date, whether it has details, and its line number.
  - A second list, **Will update**, shows each update line with an op badge, the item's current title, the new follow-up date, reassignment, note text and any validation problem (§6.4).
  - Updates with an `err` problem start unticked; ticking one forces it.
  - Every draft has a checkbox; unticked drafts are skipped. Skips are keyed by `line:title`.
  - `@usernames` are validated against GitLab, debounced by 500 ms. Unknown users are shown in red with "(unknown user)", but saving is not blocked; those items fail individually and are reported.
- **Save:** runs `captureMeeting` with the selected drafts and updates, showing progress text, then toasts `Meeting saved: N new, M updated`. If some items or updates failed, an error toast lists them. Then the app reloads, navigates to Meetings and opens the new meeting.
- **Clear:** needs two clicks within 3 s, with a toast hint after the first. `window.confirm` is avoided on purpose so browser automation isn't blocked.

### 8.5 Settings (`SettingsView.tsx`)

The fields are listed in §9. "Test connection" checks `/user`, the follow-ups project and the standards project (if set). A "Failed to fetch" error gets a hint about VPN or CORS. "Try it with demo data" switches to demo settings. In demo mode, a banner offers "Reset demo data".

Crews are entered as a textarea, one per line: `Name | @handle` (the handle is optional).

### 8.6 Visual design

- CSS variables in `:root`, dark theme via `prefers-color-scheme`. Dark navigation sidebar and warm off-white content. Accent `#c2410c`.
- Kind colours: action orange, decision green, standard purple, meeting blue.
- Layout: grid with a 228 px nav, content, and a 460 px drawer when open. Below 1100 px the drawer becomes an overlay and the board/stats/capture reflow.

---

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
- **Crews in the room** (if crews are configured): adds standards still pending for them.
- **Other topics**: free lines, added to the agenda as `### Other topics`.

**Sections (`buildPrep`)**, each item listed once, in this priority order:

| Section | Rule |
|---|---|
| Open from previous sessions | Open actions whose `meetingIid` is any session of the series |
| Waiting on attendees | Other open actions assigned to an attendee |
| On my side | Other open actions that are mine (`isMine` rule) **and** involve an attendee: the attendee authored it, it mentions `@attendee` in title/description, or it came from a meeting whose attendee line resolves to that attendee |
| Standards | Open standards from a session of the series, owned by an attendee, or **published** and still pending for a selected crew |
| Decisions from <last session date> | Decisions created in the last session, to read back |

- Actions are sorted `byDue`; decisions by IID.
- Empty sections are hidden. If everything is empty, a single message says so.
- Every row has a checkbox (unticked = left off the agenda), and the title opens the drawer.

**Outputs (sticky bar)**
- **Copy agenda** (`agendaMarkdown`): `## <title> — <date>`, attendees, one `###` per non-empty section, then other topics.
  - Actions are `- [ ] <project>#<iid> <title> — @assignee, <humanDue>`.
  - Standards are `- <ref> <title> — pending: <crews>`. Decisions are plain refs.
  - Full `group/project#iid` references link correctly when pasted anywhere in GitLab.
- **Post on last session** (only when a series matched): posts `**Agenda for the next session**` plus the agenda as a comment on the last session's issue. @mentions in it notify people; the button's tooltip says so.
- **Start meeting notes →**: writes the capture draft (`title`, `date`, attendee names joined by `, `, `notes = agendaNotes(...)`) and opens Capture.
  - `agendaNotes` uses short `#iid` refs and annotations in parentheses without `@`, so nobody gets assigned or notified by accident. Every line is inert until ticked or prefixed (§6.4).
  - It ends with an empty `### Discussion` section for new items.
  - If Capture already holds unsaved notes, the first click only warns and the button changes to "Replace unsaved notes →". The second click replaces them.

## 9. Settings & browser storage

| localStorage key | Content |
|---|---|
| `arch.settings.v1` | `Settings` JSON |
| `arch.capture-draft.v1` | In-progress capture form |
| `arch.demo-db.v1` | Fake GitLab database (demo mode only) |

**Legacy migration:** `migrateLegacyStorage()` runs in `main.tsx` before the first render. For each old `loose-ends.*` key it copies the value to the matching `arch.*` key, unless the new key already exists, and then removes the old key.

```ts
interface Settings {
  baseUrl: string;            // https://gitlab.example.com (trailing slashes stripped by client)
  token: string;              // PAT, scope `api`
  followupsProject: string;   // full path
  standardsProject: string;   // full path, optional (publishing disabled if empty)
  standardsFolder: string;    // default 'standards'
  crews: { name: string; handle?: string }[];
  defaultFollowUpDays: number;// default 7
  demo: boolean;
}
```

Bump the key suffix (`.v2`) and migrate in `loadSettings` if the shape changes incompatibly.

---

## 10. Demo mode & tests

### Fake GitLab (`lib/demo.ts`)

`createFakeGitLab(initialDb?, persist=false)` returns `{ fetch, db }`. It implements:

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
POST /projects/:id/repository/commits         (stores files in db.files)
POST /projects/:id/merge_requests
GET  /projects/:id/merge_requests/:iid        (auto-transitions to "merged" 30 s after creation, so the demo shows the flow)
```

Anything else returns 404 `Demo does not implement …`.

`seedDb(today, {labels})` builds a realistic dataset relative to `today`:
- users: `marco` (the current user), `anna.keller`, `jonas.weber`, `sofia.ricci`, `lukas.brunner`, `priya.nair`
- two meetings
- three decisions
- seven actions: overdue, due today, upcoming, waiting on others, and one closed
- two standards: one draft, one published with 2/3 crews adopted

Projects: `architecture/follow-ups` (id 11) and `architecture/standards` (id 12).

### Tests (`tests/*.test.ts`)

- `dates`: every token form against a fixed Wednesday, `2026-11-18`.
- `parser`: assignee forms, defaults, decisions, standards, false-positive guard, details collection.
- `model`: standard description build, adoption toggle and add, document section, marker idempotence.
- `service` (against the fake): label bootstrap; end-to-end meeting capture; unknown-assignee resilience; full standards lifecycle (publish → merge → notify → adopt all → close → untick → reopen); nudge.
- `prep.test.ts`:
  - every update form, plus lines that must *not* parse as updates
  - `updateNote` stripping
  - `parseMeeting` separating items from updates
  - series naming and attendee resolution
  - `buildPrep` for a recurring meeting and for a 1:1 with crews
  - agenda and notes rendering, including that untouched agenda notes parse to nothing
  - a capture that creates and updates at once, covering every op, a 404 and the closing of the standard
  - the rejection cases
  - quick-add updates with reassignment
- `migration.test.ts`: legacy storage keys.

**Rule:** new parser or date behaviour needs a unit test. A new service use case needs a fake-backed test, and any new endpoint must be added to the fake.

Not covered yet: React components (no DOM tests) and a real GitLab instance.

---

## 11. Invariants & conventions for contributors

1. **Data compatibility first.** Label names (§3.1), the marker format and keys (§3.2), and the `## Adoption` / `## Document` / `## Summary` headings are read back from existing issues. Changing them needs backward-compatible parsing or an explicit migration action in Settings.
2. **GitLab is the only store.** Don't add a backend or database. Per-browser conveniences may use localStorage (wrapped in try/catch) with a versioned key.
3. **Security.**
   - Issue content can be written by anyone with project access and is rendered **as text**, never as `dangerouslySetInnerHTML`, because the page holds a PAT.
   - If you add markdown rendering, use GitLab's `POST /markdown` (which returns sanitised HTML) or a sanitiser such as DOMPurify.
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
| L1 | Closed actions and standards older than 90 days are not loaded | By design for speed. A history/search view would need a separate paged query |
| L2 | Single assignee only | §11.5 |
| L3 | Descriptions are plain text | §11.3 |
| L4 | Meeting notes can't be edited in-app after saving | Edit in GitLab; new items must be added via Quick add, which isn't linked to the meeting |
| L5 | Quick-add items have no meeting link | Could offer "attach to meeting" |
| L6 | No polling or live updates | Manual ↻. The Waiting view can be stale if people close issues in GitLab |
| L7 | `captureMeeting` creates items sequentially | ~3 requests per item; fine for <30 items. Could be parallelised with a concurrency limit |
| L8 | Partial failure leaves a meeting with fewer outcomes | Errors are reported, but there is no retry UI for failed drafts |
| L9 | `notifyCrews` matches crews by **name** against current settings | Renaming a crew in settings breaks the handle lookup for existing standards. The ` — @handle` suffix stored in the checklist could be used instead |
| L10 | The PAT lives in localStorage | Acceptable for a personal tool. OAuth (PKCE) would be better for wider use |
| L11 | `GitLab.projectMembers` is implemented but unused | Intended for assignee autocomplete from real project members |
| L12 | The "overdue" stat tile has no click target | Could filter Focus to overdue only |
| L13 | No DOM or e2e tests; never exercised against a real GitLab instance | First real run may surface CORS or permission issues (e.g. `links` API, label creation needs Maintainer) |
| L14 | `tsconfig` includes tests; `vite.config.ts` casts `test` with `as any` | Could switch to `vitest/config` `defineConfig` |
| L15 | Decision supersession isn't modelled | "We changed our mind" is just a new decision |
| L16 | Series are matched by title only | Renaming a recurring meeting starts a new series. A `fu:series=<key>` marker would make this explicit |
| L17 | Attendee resolution only knows users seen in loaded items | New people must be typed as a username or stay guests. Fix with `projectMembers` autocomplete (backlog 6) |
| L18 | "On my side" is a heuristic | It can miss items (no author, mention or shared meeting) and include loosely related ones; the user unticks them |
| L19 | The meeting's own notes keep the agenda text as typed | `- [x] #7` stays in the notes; the authoritative record is `### Updated` and the comments on each item |

---

## 13. Enhancement backlog (suggested priority)

Each entry: **goal**, then a sketch of the approach. Effort: S = hours, M = a day or two, L = more.

### P1: makes daily follow-up better

1. **Weekly digest (M).** A "Prepare digest" view that builds markdown for overdue items, waiting-on-others per person, standards adoption status and decisions made this week. Copy it, or post it as a note on a configurable "weekly digest" issue. A later version could make this a scheduled GitLab CI job using the same `lib/` code in Node.
2. ~~**Per-person 1:1 view**~~: done in v0.2 as Prepare with "Prepare 1:1" (§8.7). Possible follow-up: a `#/person/<username>` deep link that opens Prepare for that person.
3. **Browser reminders (S).** Use the Notification API while the tab is open: alert once a day for items due today and overdue. Keep "last notified" per IID in localStorage.
4. **Add to existing meeting (S).** In the meeting drawer, a text box with the capture syntax (new items *and* updates, via `parseMeeting`) that creates or updates items linked to that meeting and appends them to its Outcomes section (fixes L4/L5).
5. **Retry failed drafts (S).** After a partial capture failure, keep the failed drafts in the capture screen with the error, so you can fix `@user` and retry against the same meeting (fixes L8).
6. **Assignee autocomplete from project members (S).** Use `projectMembers(query)` in the Owner field, the capture preview and Prepare's attendee chips (L11, L17).
6a. **Explicit series (S).** Write `<!-- fu:series=<key> -->` on meetings created from Prepare, and let Prepare rename or merge series (L16).
6b. **Agenda as a pre-meeting issue (S).** Optionally create the upcoming meeting's issue at prep time, in the open state with the agenda, and let Capture fill that issue instead of creating a new one.

### P2: richer standards and decisions

7. **ADR export for decisions (M).** "Write ADR" on a decision: a template pre-filled from the decision and its meeting, published via the same commit+MR flow into a configurable `adr/` folder (`NNNN-slug.md`). Reuse `publishStandard`'s mechanics by refactoring them into a generic `publishDocument(projectPath, path, content, issue)`.
8. **Decision supersession (S).** A `fu:supersedes=<iid>` marker plus a UI action "Supersede…". The log shows superseded decisions struck through with a link to the replacement.
9. **Per-crew adoption deadlines and evidence (M).** Extend checklist lines to `- [x] Payments — @handle — 2026-12-01 — !123`, i.e. a deadline and an MR or link as evidence. Parsing must stay backward compatible with the current format.
10. **Crew-side issues (M, optional).** Instead of comments, create one issue per crew in that crew's own project, linked back, and derive the checkbox state from those issues' open/closed state. Needs a crew → project mapping in settings.
11. **Standards catalogue (S).** A read-only list of published/adopted standards with links to their documents (`fu:path`), for sharing with crews.

### P3: platform & scale

12. **Markdown rendering (S).** Render descriptions and notes through `POST /api/v4/markdown` (`gfm: true`, `project`), and cache by content hash (L3).
13. **Multi-assignee (M)** for Premium instances: model `assignees: GlUser[]`; Waiting groups by each assignee (L2).
14. **Background refresh (S).** Refetch open items every N minutes while visible (`document.visibilityState`), and on window focus (L6).
15. **History & search (M).** A paged search across all closed items, using GitLab `search` or `issues?search=` (L1).
16. **OAuth PKCE login (M)** as an alternative to the PAT (L10).
17. **Integration into GitLab Everything (M).** The `lib/` folder is framework-free, so it can be published as an internal package or copied as a module in Marco's existing GitLab portal.
18. **E2E tests (S).** Playwright against `npm run preview` in demo mode, covering the capture → meeting → drawer → nudge and standards publish flows (L13).
19. **Import from calendar (L).** Pre-fill meeting title, date and attendees from an Outlook/ICS export or a connector.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Crew | A delivery team that must adopt standards |
| Follow-up date | The GitLab `due_date` of an action: when Marco should next check on it, not necessarily the assignee's deadline |
| Waiting on others | An open action or standard assigned to someone other than the current user |
| Nudge | A GitLab comment that @-mentions the assignee, plus pushing the follow-up date out |
| Draft (parser) | An item parsed from text but not yet created in GitLab |
| Outcomes | The list of items appended to a meeting issue's description |
| Series | Meetings sharing a title (without the date), e.g. every "Architecture Board" |
| Update (parser) | A line that changes an existing item: DONE / DROP / UPDATE / PUSH / ADOPTED `#iid` |
| Agenda | Output of Prepare: shareable markdown, or notes that seed Capture |

---

## 15. Changelog

| Version | Date | Changes |
|---|---|---|
| v0.2 | 2026-11-19 | Prepare screen (series, attendees, crews, agenda copy/post, start notes from the agenda). Update syntax for existing items in notes and Quick add. `### Updated` in meeting outcomes. Entry points from Meetings, the meeting drawer and Waiting on others. `p` shortcut. |
| v0.1.1 | 2026-11-19 | Renamed Loose Ends → Arch, arch icon, storage-key migration |
| v0.1 | 2026-11-18 | Initial build |
