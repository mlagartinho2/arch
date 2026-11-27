<p align="center"><img src="public/arch.svg" width="96" alt="Arch"></p>

# Arch

Follow-ups, decisions and standards for a software architect. The app runs only in your browser. Meetings, actions and decisions are GitLab issues; standards are versioned documents in a GitLab repository, mirrored to a wiki.

You type meeting notes the way you normally would. Lines that start with a keyword become tracked GitLab issues, linked back to the meeting. The app then shows what's due, what you're waiting on and from whom, and which crews have adopted each standard.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # parser, model and service tests against an in-memory fake GitLab
npm run build      # static files in dist/, host anywhere (GitLab Pages works)
```

On first start, click **Try it with demo data** to explore without a token. Demo data is stored in your browser's localStorage. You can reset it from Settings.

## Connect to GitLab

1. Create a project for the issues, for example `architecture/follow-ups`. A dedicated project keeps the issue list clean. You can make it private and add your crew leads as Reporters so they can see and comment on what's assigned to them.
2. (Optional) Create a standards repository, for example `architecture/standards`. Standards are markdown files there, changed through merge requests, and mirrored to its wiki (or to a group wiki on Premium). Enable the wiki on that project.
3. Create a personal access token with the `api` scope. Give it a short expiry.
4. In **Settings**, fill in the URL, token and project paths. For standards, also set the wiki, your categories, and your teams: one per line, as `Payments | @platform/crew-payments | @priya.nair`, with the team's GitLab handle and the person usually responsible for adoption (both optional). Click **Test connection**.
5. If labels are missing, the app shows a **Create labels** banner. Click it once.

The token is stored only in this browser's localStorage and is sent only to your GitLab. The browser calls the GitLab API directly, and GitLab allows cross-origin API calls with a token by default. If **Test connection** says "Failed to fetch", check your VPN, the URL, or any reverse proxy that strips CORS headers.

## Meeting-notes syntax

```
Free text is kept as the meeting's notes.

DECISION: Kafka for all async domain events
    RabbitMQ stays for legacy until 2027        ← indented lines become the item's details
ACTION @jonas.weber: share load-test results due:fri
TODO: write the ADR for Kafka adoption          ← no @ = assigned to you
ask @sofia.ricci: list services still on RabbitMQ due:+3d
STANDARD: API error format (RFC 7807) due:15.12
```

| Keyword | Becomes |
|---|---|
| `ACTION`, `TODO`, `AI:`, `ask:` | an action. The first `@user` is the assignee; with no `@user`, it's assigned to you. With no `due:`, it gets a follow-up date N days out (default 7, set in Settings). |
| `DECISION`, `DECIDED`, `DEC` | a decision record, closed as soon as it's created, in the searchable decision log |
| `STANDARD`, `STD` | a standard **to write**: an action "Write standard: …". Its **Draft this standard** button opens the standards editor pre-filled |

`due:` accepts `today`, `tomorrow`, `fri`, `+3d`, `2w`, `eow`, `eom`, `nw` (next Monday), `15.12`, `15.12.2026` and `2026-12-15`.
`fu:` and `by:` work as aliases for `due:`.

Lowercase keywords count only when followed by `:` or `@`, so prose like "Decision makers were absent" is not picked up.
The preview shows every item before anything is saved. You can untick items, and unknown `@users` are flagged.

### Updating existing items

Refer to an existing item by its number to update it from your notes or from Quick add:

```
- [x] #7                              ← ticked checkbox = done
DONE #7: shared on the wiki
UPDATE #8: halfway, 4 services left   (add @user right after #8 to reassign)
PUSH #9 due:fri                       (no due: = +7 days)
DROP #10: superseded
ADOPTED #14: rolled out                (closes an adoption issue as adopted)
```

Each update posts a comment on the item that links back to the meeting. The meeting lists them under *Outcomes → Updated*.
The preview flags problems before saving, for example `ADOPTED` on an item that is not an adoption issue.

Notes are autosaved in the browser while you type. The **Quick add** bar at the top (shortcut `/`) takes the same syntax for one-off items and updates.
`n` opens the meeting notes, `p` opens Prepare.

## Editing

Every text in Arch is written full screen, with the Markdown editor from GitLab Everything:

- **Meeting notes** (`n`): attendee chips, a toolbar with **+ Action**, **+ Decision**, **+ Standard**, **Update item** and **Due date**, and Write / Split / Preview / Changes. The preview shows each item as the card it will become. The side panel lists what will be created and updated (untick to leave a line out), the outline, checks (unknown `@user`, unreadable `due:`, updates that can't apply) and shortcuts. Changes compares your notes with the agenda you started from.
- **Items**: clicking a row opens a read-only **quick look**. You can tick tasks there (saved at once), snooze or mark done. `↑`/`↓` move through the list, `Enter` (or a double-click) opens the item full screen, `E` opens it editing the description, `C` in the comment box, `Esc` closes. Full screen, the description editor checks before saving that nobody changed it in GitLab meanwhile, and offers to compare, overwrite or load their version. The comment box can also push the follow-up by 3 days or close the action. `#/item/<number>` links straight to an item.
- **Standards**: proposing a change opens the standard full screen, with the version bump, changelog note and status in the side panel, a preview of the merge request, and a Changes view against the version on main (optionally the whole file, front matter and changelog included).

While typing: `/` opens the insert menu (Arch lines, rules, tables, callouts…), `@` suggests people (attendees first, then project members), `#` suggests items, and `due:` suggests dates. `Ctrl/⌘+S` saves, `Ctrl/⌘+Enter` posts a comment. Unsaved text is kept in the browser, per document, until you save or discard it.

## How it maps to GitLab

| Thing | GitLab representation |
|---|---|
| Meeting | Issue labelled `fu::meeting`, closed. The description holds the notes and an *Outcomes* list with links to each item. |
| Action | Issue labelled `fu::action`, with an assignee and a due date (the follow-up date) |
| Decision | Issue labelled `fu::decision`, closed |
| Adoption | Issue labelled `fu::adoption`: one team adopting one version of a standard, assigned to the team's responsible person, due by the deadline. Closed = adopted |
| Standard | **Not an issue**: a markdown file `<folder>/<category>/<id>.md` in the standards repository (see *Standards* below) |
| Link to meeting | Hidden marker `<!-- fu:meeting=N -->` in the description, a "From meeting #N" line, and a *relates to* issue link |

Because everything is plain GitLab issues, you can also use the GitLab boards, email notifications, issue search and your existing integrations. People reply in GitLab, and the replies appear in the app's Activity panel.

## Preparing a meeting

Open **Prepare meeting** (or **Prepare next** on a meeting, or **Prepare 1:1** on a person in *Waiting on others*). Then:

1. Pick a recurring meeting or type a title, and add attendees. A recurring meeting fills in who came last time.
2. Arch gathers:
   - what's still open from earlier sessions
   - what the attendees owe you, and what you owe them
   - open adoption issues of the teams in the room, or assigned to attendees
   - the decisions from the last session, to read back
3. Untick what you don't want and add other topics.
4. **Copy agenda** to send it ahead, or **Post on last session** to put it on GitLab (mentioned people are notified).
5. **Start meeting notes** opens the capture screen with the agenda in it. During the meeting, tick items or prefix them with `DONE`, `UPDATE`, `PUSH`, `DROP` or `ADOPTED`, and add new items under *Discussion*. Saving does both: it creates the new items and updates the old ones.

## Standards

A standard is a document first. Adoption is optional and separate.

- **Document.** Each standard is a markdown file in the standards repository, at `standards/<category>/<id>.md`. A small header holds its title, category, tags, version (`major.minor`), status and owner, and the file ends with a changelog. Git keeps every version.
- **Changes go through merge requests.** **+ New standard** and **Propose change** open the editor; **Open merge request** creates a branch and a merge request. Pick **Minor** for clarifications and **Major** for changes teams must act on, and describe the change for the changelog. You review and merge in GitLab as usual.
- **Wiki.** Merged versions are mirrored to the wiki, one page per standard under `standards/<category>/` plus an index page. When the wiki is behind, Arch shows a **Publish to wiki** banner. To keep the wiki current without opening Arch, add the optional CI job to the standards repository (see below).
- **Adoption (optional).** On any version, **Start adoption** creates one GitLab issue per team you pick, assigned to the responsible person with your deadline, listing what changed since that team's last adopted version. These issues show up in Focus and Waiting on others like any action, and teams close them when done. Arch suggests a new cycle after a major version. Starting one closes the team's open issues for older versions as superseded.
- **Deprecate…** retires a standard through the same kind of merge request.

### Optional: keep the wiki in sync from CI

1. In this repo, run `npm run build:sync`, and copy `dist-sync/sync-standards-wiki.mjs` to `ci/` in the standards repository.
2. Add the job from [`docs/ci/standards-wiki-sync.gitlab-ci.yml`](docs/ci/standards-wiki-sync.gitlab-ci.yml) to the standards repository's `.gitlab-ci.yml`, and adjust its variables to match your Settings.
3. Create a project (or group) access token with the `api` scope and at least the Developer role, and add it as a masked CI/CD variable `ARCH_WIKI_TOKEN`.

After every merge the job publishes new versions, refreshes the index and removes pages of deleted standards.

## Views

- **Focus**: what's overdue, due today and due in the next 7 days, plus counters.
- **My actions**: everything assigned to you, sorted by follow-up date.
- **Waiting on others**: open items grouped by person. **Copy list** / **Copy full digest** copy markdown you can paste into a 1:1 or a crew-sync agenda.
  **Nudge** posts a comment that @-mentions the assignee, so GitLab notifies them, and moves the follow-up date to +3 days.
- **Standards**: the catalog by category, with search. See below.
- **Decision log**: searchable, grouped by month.
- **Meetings**: each meeting with its outcomes, the items it updated, and how many are still open.

## Code map

```
src/lib/parser.ts    meeting-notes syntax → drafts
src/lib/dates.ts     due-date tokens
src/lib/model.ts     label conventions, issue → Item mapping, adoption issues
src/lib/gitlab.ts    minimal REST v4 client (fetch + PAT)
src/lib/service.ts   use cases: capture meeting, apply updates, nudge…
src/lib/standards.ts          standard documents: front matter, versions, changelog, wiki pages
src/lib/standardsService.ts   catalog, merge requests, wiki publishing, adoption cycles
scripts/sync-standards-wiki.ts   the optional CI wiki sync (npm run build:sync)
src/lib/prep.ts      meeting preparation: series, attendees, agenda
src/lib/demo.ts      in-memory fake GitLab (demo mode + tests)
src/editor/          the Markdown editor (CodeMirror 6), renderer, checks and completions, ported from GitLab Everything
src/components/      React views (no UI library)
```

## Contributing / AI agents

The full product and technical specification is in [`docs/SPEC.md`](docs/SPEC.md). It covers the GitLab data contract, architecture, invariants, known limitations and a prioritized enhancement backlog. Agents should start with [`AGENTS.md`](AGENTS.md).
