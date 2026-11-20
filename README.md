<p align="center"><img src="public/arch.svg" width="96" alt="Arch"></p>

# Arch

Follow-ups, decisions and standards for a software architect. The app runs only in your browser and keeps everything in GitLab issues.

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
2. (Optional) Create a standards repository, for example `architecture/standards`, where standard documents get merged.
3. Create a personal access token with the `api` scope. Give it a short expiry.
4. In **Settings**, fill in the URL, token, both project paths and your crews. You can add a GitLab handle per crew, for example `Payments | @platform/crew-payments`, so the crew can be notified. Click **Test connection**.
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
| `STANDARD`, `STD` | a standard with an adoption checklist for every configured crew |

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
ADOPTED #14 Payments, Data            (ticks crews on a standard)
```

Each update posts a comment on the item that links back to the meeting. The meeting lists them under *Outcomes → Updated*.
The preview flags problems before saving, for example `DONE` on a standard or an unknown crew.

Notes are autosaved in the browser while you type. The **Quick add** bar at the top (shortcut `/`) takes the same syntax for one-off items and updates.
`n` opens the capture screen, `p` opens Prepare, and `Esc` closes the side panel.

## How it maps to GitLab

| Thing | GitLab representation |
|---|---|
| Meeting | Issue labelled `fu::meeting`, closed. The description holds the notes and an *Outcomes* list with links to each item. |
| Action | Issue labelled `fu::action`, with an assignee and a due date (the follow-up date) |
| Decision | Issue labelled `fu::decision`, closed |
| Standard | Issue labelled `fu::standard` plus a status label `fu-std::draft` / `review` / `published` / `adopted`. Adoption is a task list under `## Adoption`. |
| Link to meeting | Hidden marker `<!-- fu:meeting=N -->` in the description, a "From meeting #N" line, and a *relates to* issue link |

Because everything is plain GitLab issues, you can also use the GitLab boards, email notifications, issue search and your existing integrations. People reply in GitLab, and the replies appear in the app's Activity panel.

## Preparing a meeting

Open **Prepare meeting** (or **Prepare next** on a meeting, or **Prepare 1:1** on a person in *Waiting on others*). Then:

1. Pick a recurring meeting or type a title, and add attendees. A recurring meeting fills in who came last time.
2. Arch gathers:
   - what's still open from earlier sessions
   - what the attendees owe you, and what you owe them
   - standards from that meeting, or still pending for the crews in the room
   - the decisions from the last session, to read back
3. Untick what you don't want and add other topics.
4. **Copy agenda** to send it ahead, or **Post on last session** to put it on GitLab (mentioned people are notified).
5. **Start meeting notes** opens the capture screen with the agenda in it. During the meeting, tick items or prefix them with `DONE`, `UPDATE`, `PUSH`, `DROP` or `ADOPTED`, and add new items under *Discussion*. Saving does both: it creates the new items and updates the old ones.

## Views

- **Focus**: what's overdue, due today and due in the next 7 days, plus counters.
- **My actions**: everything assigned to you, sorted by follow-up date.
- **Waiting on others**: open items grouped by person. **Copy list** / **Copy full digest** copy markdown you can paste into a 1:1 or a crew-sync agenda.
  **Nudge** posts a comment that @-mentions the assignee, so GitLab notifies them, and moves the follow-up date to +3 days.
- **Standards**: a board with Draft → In review → Adopting → Adopted columns.
  - From a draft, edit the generated document and click **Open merge request**. This creates a branch with the file in the standards repo and opens an MR.
  - When the MR is merged, the standard moves to *Adopting* automatically the next time you open it.
  - Tick crews off as they adopt. **Notify pending crews** posts a comment mentioning only the crews that haven't adopted yet.
  - When every crew has adopted, the issue closes.
- **Decision log**: searchable, grouped by month.
- **Meetings**: each meeting with its outcomes, the items it updated, and how many are still open.

## Code map

```
src/lib/parser.ts    meeting-notes syntax → drafts
src/lib/dates.ts     due-date tokens
src/lib/model.ts     label conventions, issue → Item mapping, adoption checklist helpers
src/lib/gitlab.ts    minimal REST v4 client (fetch + PAT)
src/lib/service.ts   use cases: capture meeting, apply updates, nudge, publish standard, adoption…
src/lib/prep.ts      meeting preparation: series, attendees, agenda
src/lib/demo.ts      in-memory fake GitLab (demo mode + tests)
src/components/      React views (no UI library)
```

## Contributing / AI agents

The full product and technical specification is in [`docs/SPEC.md`](docs/SPEC.md). It covers the GitLab data contract, architecture, invariants, known limitations and a prioritized enhancement backlog. Agents should start with [`AGENTS.md`](AGENTS.md).
