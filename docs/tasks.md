# Tasks and databases

A design and a plan. It decides how nib replaces a to-do app and a database app: every
feature Todoist sells, for free, on the notes the reader already has, and every database
feature of Obsidian Bases and Notion that earns its place, on the same notes. One engine
answers both, because a task is a row too. Section 7 is the plan the lanes build from.

Emil, 2026-10-03:

> Todoist is not free. I want to provide every bit of functionality Todoist provides, but
> free, and integrated nicely, so e.g. my agent in here can directly edit my todos. I don't
> want 1000 applications for all the different things. My aim is for nib to be all in one.

And, the same day:

> I'd want databases then. You can probably reuse the Obsidian format. I want every single
> database feature that could be useful (that Obsidian and Notion have), but think about
> how to realize it best so it is useful for users and gives the best possible experience
> and integration in nib.

Read with `docs/agent-native.md` (the verbs and grants), `docs/ai-sidebar.md` (the panel and
its commands), `docs/sync-v2.md` (how a file moves) and `docs/design.md` (the shapes).
Nothing here loosens any of them.

## The short version

1. **A task is a line in a note.** `- [ ] Call the bank 📅 2026-10-06`, in the Obsidian
   Tasks plugin's own emoji format, so a space opened in Obsidian with Tasks installed reads
   every date, priority and recurrence nib wrote. What Tasks has no field for (a time of day,
   a duration, a deadline, a reminder, an assignee) is a Dataview inline field, `[time::
   16:00]`, which Dataview reads and Tasks keeps as words. No store of nib's own, ever.
2. **A project is a note, a section is a heading, a label is a tag, a sub-task is an
   indented task.** Comments and descriptions are the indented lines under a task, and an
   attachment is an embed there. Each space has an `Inbox.md`. Nothing has to be learned:
   the markdown already said all of it.
3. **One index, built in the pass that already reads the space.** The crate's link scan
   carries every task line and every note's front matter back with the links; the window
   keeps them as rows and re-reads only the note that changed. 10,000 tasks answer a view in
   a frame.
4. **One engine for tasks and databases**, a new pure package, `@nib/bases`: rows, Obsidian's
   Bases expression language, filters, formulas, sort, group, summaries. A note is a row whose
   columns are its front matter; a task is a row whose columns are its fields. Todoist's
   filter language (`today & #work | overdue`) compiles to the same tree.
5. **Views are `.base` files**, Obsidian's format, with nib's additions under one key, `nib:`,
   that Obsidian leaves alone. Table, list, cards, board, calendar, timeline and chart; the
   built-in Inbox, Today and Upcoming are bases nib ships and a reader can copy and change.
6. **A Tasks panel on the left** beside the files and the search: Inbox, Today, Upcoming,
   then the reader's saved views, projects and labels, each with its count. A row opens its
   view in a tab, the way the graph opens. The panel is navigation, the tab is the work.
7. **Quick add from anywhere**: a global key opens a one-line field over whatever is in
   front, and the palette has the same field. `Call mum tomorrow 4pm #family p1 every
   sunday` becomes chips as it is typed, in English and German, and a chip pressed turns
   back into words.
8. **Every view edits.** A box ticks, a cell edits the front matter through the one write
   path every other surface uses, a card dragged to another column changes the property the
   board is grouped by, a task dragged to another day changes its date. One edit, one undo.
9. **Reminders fire with nib closed.** Desktop notifications are handed to the system
   scheduler (Windows scheduled toasts, macOS notification triggers), the phone schedules
   local alarms, nib stays in the tray while a reminder exists, and the Worker pushes to
   a phone that has not opened nib since (8.5).
10. **The agent works the list.** `nib mcp` and the account connector gain `list_tasks`,
    `add_task`, `update_task`, `query_base`, `add_row` and `edit_base`; the AI sidebar gets
    `/tasks` and `/today` (plan my day), and its background-work command becomes `/jobs`.
11. **Todoist comes in whole**: projects, sections, sub-tasks, labels, priorities, recurring
    rules, deadlines, durations, reminders and comments, through its API with a token the
    reader pastes, or from its CSV and backup files.
12. **Parity, counted**: of Todoist's 98 features in section 3, 58 are must, 25 should, 10
    later and 5 dropped, each with its reason. Of the 92 database features in section 4,
    57 are must, 24 should, 9 later and 2 dropped.

---

## 1. What it is for

Three readers, one need. Somebody who uses Todoist today and would rather not pay for it or
keep a second app; somebody who already writes `- [ ]` in their notes and wants those tasks
to have dates and a Today list; and somebody who keeps reading lists, contacts, projects or
bugs as notes with front matter and wants to see them as a table or a board. Each of them
wants their things where their writing is, on every device, readable by an agent, and still
plain files.

What matters to them, in order:

1. **Capture in two seconds** from wherever they are, without choosing where it goes.
2. **Today is right.** Everything due today or overdue, from every note and every space, in
   one list that never misses a task because it was written in the wrong place.
3. **Nothing is ever lost or locked in.** The task is a line they can see, edit, grep, sync
   and open in another app.
4. **It reminds them**, on the device in their hand, even when nib is not open.
5. **It scales without slowing the editor down.** Ten thousand tasks and five thousand notes
   cost nothing while typing.
6. **The views do the editing.** A board, a calendar and a table are where things are moved,
   not pictures of a file somebody has to edit elsewhere.

## 2. What others do

### 2.1 Todoist, feature by feature

Todoist's own help centre, read 2026-10-03. The plan column is what Todoist charges for it
([pricing][td-pricing]): Beginner is free with 5 projects, 3 filters, one week of activity
and no calendar layout.

| feature | what Todoist does | plan | done well | done badly |
| --- | --- | --- | --- | --- |
| Quick Add | one field; `#Project`, `/Section`, `%label` (`@` until the end of 2026), `p1`-`p3`, `+assignee`, `!reminder`, `{deadline}`, `for 30 min`, dates and recurrences in natural language; a recognised word is highlighted and a click makes it plain text again ([quick add][td-quickadd]) | all; `!` and `{}` Pro | the highlight-as-you-type, the one-click undo of a misread word, a global shortcut on the desktop | `@` changing meaning to `%` in 2026 broke muscle memory; tokens only in some languages |
| Dates | `tomorrow at 4 PM`, `every other Tuesday starting March 3`; a date is when you plan to start ([dates][td-dates]) | all | reads like speech | no start date, no "later": a date is the only way to hide a task |
| Recurring | `every`, `every!` (from completion), `every other`, `every workday`, `every last day`, `every 2, 15, 27`, `starting`/`until`/`for 3 weeks`; only future dates ([recurring][td-recurring]) | all | `every!` is the feature people miss elsewhere | completing an occurrence leaves no line behind; history is only in the activity log |
| Deadlines | `{next Friday}`, beside the date, one-off only ([deadlines][td-deadlines]) | Pro | separates "when I do it" from "when it must be done" | not recurring, Pro only |
| Duration | `for 45 min`, needs a time, at most 24 h ([duration][td-duration]) | Pro | feeds the calendar's time blocks | Pro only |
| Reminders | automatic at the due time, custom absolute or relative, recurring, push, desktop and email ([reminders][td-reminders]); location on arrive or leave, phones only ([location][td-location]) | custom ones Pro | arrives on every device, actions in the notification | location needs persistent location access |
| Inbox, Today, Upcoming | the three fixed views; Today folds in overdue; Upcoming is days with a week strip ([glossary][td-glossary]) | all | Today with overdue on top is the daily habit | Upcoming is a list, not a planner, until the calendar layout |
| Filters | `today & %email`, `(p1 \| p2) & 7 days`, `#Work`, `##Work` with sub-projects, `/Section`, `assigned to: me`, `created before:`, `recurring`, `subtask`, `search:`, `,` for several lists ([filters][td-filters]) | 3 free, 150 Pro | a small language people actually learn; `,` to stack lists | 3 on the free plan; Filter Assist only in English and Spanish |
| Layouts | list, board, calendar (week, 3 days, month, a no-date sidebar, drag to reschedule) on any project, label, filter, Today or Upcoming ([calendar][td-calendar]) | calendar Pro | one layout switch for every view | calendar Pro; no time grid beyond the week |
| Projects, sections, sub-tasks | 5 projects free, 300 Pro; sections split a project; sub-tasks nest | | sections as columns on the board | everything lives in Todoist's database |
| Comments, attachments | a thread per task, files 5 MB free, 100 MB Pro | | | a note's worth of context squeezed into a comment box |
| Productivity, Karma | daily and weekly goals, streaks, vacation mode, Karma levels ([productivity][td-productivity]) | all | | gamification many turn off |
| Activity | who did what; one week free, full on Pro | | | the only record of a recurring task's past |
| Templates | projects exported and imported as CSV (`TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT, ...`), a gallery ([CSV][td-csv]) | shared templates Business | CSV is a real format | the CSV is the only portable shape Todoist offers |
| Collaboration | shared projects, assignees, a team workspace with roles and guests | Business | | |
| Email to task | a project's address; the subject becomes the task, the body a comment; Email Assist turns mail into tasks ([email][td-email]) | Assist Pro | | |
| Ramble | dictation that writes tasks as you speak, "actually I meant", 40+ languages, Wear OS ([ramble][td-ramble]) | 10 sessions a month free | correcting by speaking | metered |
| Assist | Filter Assist (words to a filter), Task Assist (break down, reword) ([assist][td-assist]) | Pro | | |
| API, MCP | REST and `/sync` ([API][td-api]); an official MCP server at `ai.todoist.net/mcp` | all | an agent can already reach Todoist | the agent's tools are Todoist's, outside the notes |
| Offline, mobile, widgets | every platform, widgets, a share sheet | all | | offline edits wait for the server's word |

### 2.2 The others

| product | does well | does badly |
| --- | --- | --- |
| **TickTick** ([features][tt]) | timeline (Gantt) with drag; Eisenhower matrix; Pomodoro and habits in the same app; calendar subscriptions | Premium for the views that matter; a crowded interface |
| **Things 3** ([concepts][things]) | When (Today, This Evening, Someday) apart from Deadline; Anytime and Someday as places a task waits; headings in projects; a Logbook; Quick Entry with Autofill from the app in front; a beautiful, calm interface | Apple only; no collaboration; repeating to-dos live in a separate template |
| **Apple Reminders** ([organize][apple-rem], [smart lists][apple-smart]) | sections shown as columns; smart lists by tag, date, location, flag and priority; reminders in the Calendar app; auto-categorised grocery lists; free | Apple only; no real query language; no export |
| **Microsoft To Do** ([My Day][mstodo]) | My Day resets every night and suggests what to add: overdue, due soon, left over from yesterday | steps are one level; no board or calendar; the Planned list is all it has for dates |
| **Obsidian Tasks** ([emoji format][tasks-emoji], [Dataview format][tasks-dv], [recurring][tasks-recur], [queries][tasks-query]) | tasks are lines in notes; a written format with created, start, scheduled, due, done and cancelled dates, five priorities, `🔁 every week when done`, ids and dependencies; queries with `group by` and `sort by`; recurrence leaves the done line behind as history | no times, durations or reminders; the emoji make the source hard to read; queries are code blocks a reader writes by hand; views are lists only |
| **Logseq** ([queries][logseq]) | `TODO`/`DOING`/`NOW`/`LATER` markers on any block; `SCHEDULED` and `DEADLINE`; the journal shows what is due | Datalog queries for anything beyond the defaults; tasks are blocks in an outliner other apps cannot read |
| **Notion tasks** ([dependencies][notion-deps]) | a task is a page in a database with status, assignee, dates, sub-items and blocked-by; timeline with dependency arrows and date shifting | a database page is heavy for "buy milk"; no natural-language capture; online first |

### 2.3 Databases

**Obsidian Bases** ([syntax][bases-syntax], [views][bases-views], [functions][bases-functions],
[cards][bases-cards], [create][bases-create]). A core plugin since 1.9. A `.base` file is YAML
with `filters` (nested `and`, `or`, `not` of expressions), `formulas`, `properties` (display
names), `summaries` and `views` (each with its own `type`, `name`, `filters`, `order`,
`sort`, `groupBy`, `limit` and `summaries`). The rows are notes, the columns their
properties plus `file.*` (name, path, folder, ext, size, ctime, mtime, tags, links,
backlinks, embeds) and `formula.*`. The expression language has `if`, `now`, `today`,
`date`, `duration`, `link`, `list`, `number`, `file`, `image`, `icon`, `max`, `min`,
`html`, and methods per type (`contains`, `format`, `relative`, `filter`, `map`, `reduce`,
`asFile`, `linksTo`, `hasTag`, `inFolder`, `hasLink`, `matches`...). Views: table, cards,
list, map (with the Maps plugin) and, since 1.14, a kanban board where dragging a card
writes the grouped property ([1.14][obsidian-114]). Embedded with `![[File.base]]`,
`![[File.base#View]]` or a ` ```base ` block, where `this` is the embedding note.

- **Does well**: the data stays in the notes; the file format is small and readable; one
  expression language for filters and formulas; `this` makes one base work in every note
  that embeds it; summaries per column.
- **Does badly** ([review][kanban-review]): one level of grouping; tasks inside notes are not
  rows, so a board of to-dos needs a note per card; no manual order of cards; new cards land
  in the vault's root rather than where the filter points; no calendar, timeline or chart
  without plugins; no relations beyond links.

**Notion databases** ([properties][notion-props], [views][notion-views],
[relations][notion-rel], [templates][notion-templates], [forms][notion-forms],
[automations][notion-auto], [charts][notion-charts], [timelines][notion-timeline],
[feeds][notion-feed], [maps][notion-map], [dashboards][notion-dash]). Twenty-two property
types: text, number (with currency and progress-bar formats), select, multi-select, status
(grouped as to-do, in progress, complete), date (ranges, a time, reminders), person, files,
checkbox, URL, email, phone, formula, relation (one-way, two-way, self, limited to one page),
rollup (count, sum, average, median, min, max, range, earliest, latest, percent checked...),
created and edited time and by, a unique ID with a prefix, button and place. Views: table,
board, timeline, calendar, list, gallery, chart (bar, line, donut, number), feed, form, map
and dashboard. Filter groups nest three deep; sorts; a group and a sub-group; calculations
under every column; templates, the default one per view, and repeating templates on a
schedule; sub-items and dependencies with date shifting; locked views; automations on page
added, property edited or a schedule; forms that write rows.

- **Does well**: every property has a real control; relations and rollups make a set of
  databases a system; views share one dataset; forms and automations close the loop.
- **Does badly**: everything is in Notion's cloud and its own format, and an export is a
  folder of CSVs that is no longer a database; a two-way relation is two stored columns that
  can drift; it is slow with thousands of rows; the free plan limits charts, automations and
  history; offline is recent and partial.

### 2.4 What nib takes, and what it leaves

- **Takes**: Todoist's quick add with clickable chips, `every!`, Today with overdue, Upcoming,
  the filter language and layouts on any view; Things' When apart from Deadline and its
  start date that hides a task until it matters; Apple's sections as columns; To Do's
  "suggested for today"; the Tasks plugin's file format and its done line as history; Bases'
  file format and expression language, whole; Notion's property controls, board, calendar,
  timeline, gallery, chart, relations, rollups, sub-groups, calculations, templates, forms,
  buttons and automations, built on the notes.
- **Leaves**: Karma and streak games; a team admin console; a hundred integrations, where one
  MCP server, a CLI and `nib://` links are the integration; dashboards as a separate thing
  (a note embedding several views is a dashboard); anything that needs a store nib owns.

## 3. Todoist parity: every feature, mapped

**must** ships in the first round of lanes, **should** in the same lanes after the musts,
**later** waits for a reason given, **drop** is a decision.

| # | Todoist feature | nib | mark | why |
| --- | --- | --- | --- | --- |
| 1 | Quick Add in the app | the quick add field from the palette and its key (5.6) | must | the core habit |
| 2 | Global Quick Add shortcut | a system-wide key opens a small quick add window over any app (5.6) | must | capture from anywhere is the point |
| 3 | Natural-language dates and times | `tomorrow 4pm`, `next fri`, `in 3 days`, `end of month`, `16:00` (5.6) | must | |
| 4 | Dates in other languages | English and German first; the grammar is a table per language, more follow by adding rows | must for en and de, later for the rest | 40 catalogues cannot all have a date grammar on day one |
| 5 | Click a recognised word to keep it as text; turn smart dates off | a chip pressed becomes words; Settings has the switch | must | misreads happen |
| 6 | `#Project` and `/Section` | `>Note /Heading`, with completion; `#` stays a tag | must | `#` is a tag in every markdown file (decision 8.1) |
| 7 | Labels (`%`, `@`) | `#tag`; `%` and `@` typed in quick add are read as tags too | must | |
| 8 | Priorities `p1`-`p4` | `p1` 🔺, `p2` ⏫, `p3` 🔼, `p4` none; Tasks' 🔽 and ⏬ read as low | must | |
| 9 | `+assignee` | `+Name` from the members of a shared space, `[assignee:: Name]` | should | only meaningful in shared spaces |
| 10 | `!reminder` in quick add | `!30m`, `!9:00`, `!tomorrow 9am` | should | the time already reminds by default |
| 11 | `{deadline}` | `{fri}`, `[deadline:: 2026-10-10]` | should | Pro in Todoist, rarely used, but real |
| 12 | `for 30 min` duration | `for 30m`, `[duration:: 30m]` | should | feeds the calendar |
| 13 | Description while adding | Shift+Enter opens a second line, written indented under the task | must | |
| 14 | Ramble | the microphone in quick add: dictation through the existing recorder, the same parser, and with a model connected the AI splits a ramble into several tasks | should | dictation exists; the split needs a provider |
| 15 | Forward email to a project or a task | a private address per account; the Worker appends the mail to the Inbox note | later | needs inbound mail routing on the Worker (8.5) |
| 16 | Browser extension: add a page as a task | the clipper's menu gains "As a task", a line in the Inbox with the link | should | the clipper exists |
| 17 | Share sheet on the phone | "Add as task" beside the existing share into a note | should | |
| 18 | Widgets | the Android widget gains a Today list with boxes | should | the widget exists |
| 19 | Quick settings tile | "Add task" tile next to New note | should | three lines of Kotlin |
| 20 | Wear OS | none | drop | no watch build; the glasses are nib's wearable |
| 21 | Siri, Google Assistant | an App Shortcut on Android for "add task" | later | needs an intent filter per assistant |
| 22 | Inbox | `Inbox.md` at each space's root, made on the first quick add | must | |
| 23 | Projects | a note with tasks is a project; the panel lists them (5.5) | must | |
| 24 | Sub-projects and folders | folders, and a note's tasks under its folder | must | the tree already is this |
| 25 | Sections | the headings of a project note | must | |
| 26 | Sub-tasks | indented tasks, to any depth | must | |
| 27 | Labels view | a view per tag (5.5) | must | |
| 28 | Priorities shown and sorted | the flag's colour on the box, sort and filter by `p1`-`p4` | must | |
| 29 | Favorites | bookmarks hold notes, views and tags; the panel shows them first | must | bookmarks exist |
| 30 | Project colours and icons | the note's icon and colour | must | they exist |
| 31 | Archive a project | the archive that exists; archived notes leave every view | should | |
| 32 | Reorder by dragging | drag a task within a note or a view grouped by note; one move of lines | must | |
| 33 | Move a task to another project | drag onto a note in the tree or panel; `>Note` in the edit field; the line moves with its sub-tasks and lines | must | |
| 34 | Duplicate a task | the row's menu | should | |
| 35 | Comments | the indented non-task lines under a task, shown folded under it in views | must | a comment is a line of the note |
| 36 | Attachments | an embed under the task; a drop on a task row puts the file beside the note and the embed under the task | should | assets exist |
| 37 | Description | the first indented paragraph under the task | must | |
| 38 | Templates (project CSV, gallery) | a note is a template (5.13); Todoist's CSV imports as a note | should, gallery drop | a template gallery is content, not code |
| 39 | Links and markdown in task names | the line is markdown | must | free |
| 40 | Due date | `📅 2026-10-06` | must | |
| 41 | Due time | `[time:: 16:00]` with the due date | must | Tasks has no time field |
| 42 | `every` recurrence | `🔁 every week on Monday` | must | |
| 43 | `every!` | `🔁 every 3 months when done` (Tasks' own words for it) | must | |
| 44 | `starting`, `until`, `for N times` | in the rule: `every day until 2026-12-24`; `starting` sets the first date | should | |
| 45 | Deadlines | `[deadline:: date]`, its own chip and sort, warned in Today from three days before | should | |
| 46 | Duration | `[duration:: 45m]` | should | |
| 47 | Time zones | a time is floating (local wherever you are) unless written with a zone, `[time:: 16:00 Europe/Zurich]` | should | travelling readers |
| 48 | Reschedule: drag, postpone, all overdue to today | a date chip's menu (today, tomorrow, next week, pick), drag in Upcoming and the calendar, "Overdue to today" in Today's head | must | |
| 49 | Skip an occurrence; stop a recurrence | the box's menu: skip (moves the date, no done line), end (removes `🔁`) | should | |
| 50 | Today, with overdue | the built-in Today view (5.4) | must | |
| 51 | Upcoming | the built-in Upcoming view, days with a week strip, drag between days | must | |
| 52 | Filter query language | Todoist's language, compiled to the engine's tree (5.8) | must | people know it |
| 53 | Saved filters | a filter saved is a `.base` file; unlimited | must | |
| 54 | Label view | yes | must | |
| 55 | Project list layout | the note itself, and the project view (5.5) | must | |
| 56 | Board layout | for every view; tasks grouped by section, status, priority, date or any field (5.9) | must | |
| 57 | Calendar layout | month, week, three days and day, a no-date tray, drag (5.9) | must | free here |
| 58 | Group and sort per view | by date, priority, note, folder, tag, assignee, status, any property; manual order within a note | must | |
| 59 | Show completed | a toggle on every view; done tasks dim and sink | must | |
| 60 | Search tasks | the search's `task:`, `task-todo:`, `task-done:` (they exist) | must | |
| 61 | Filter Assist | `/tasks` with words in the AI sidebar writes the filter | should | needs a provider |
| 62 | Completed tasks | a Logbook view over `✅` dates | must | the done line is the record |
| 63 | Automatic reminder at the due time | on for every task with a time; a setting for how long before | must | |
| 64 | Custom reminders, several per task | `[remind:: 15m, 2026-10-06 09:00]` | must | |
| 65 | Recurring reminders | a reminder on a recurring task moves with it; a reminder that recurs on its own | later | rare beyond the first case, which is must with 42 |
| 66 | Location reminders | none | later | needs background location on phones nib does not ask for |
| 67 | Desktop notifications | the system's, with Done and Snooze (5.10) | must | |
| 68 | Mobile notifications | local alarms the phone holds (must); push from the Worker (should, 8.5) | must, should | |
| 69 | Email reminders | the Worker mails the reader's own verified address | later | after push, if asked |
| 70 | Snooze or complete from the notification | Done, Snooze 15 min, Tomorrow | should | |
| 71 | Shared projects | a shared space or a shared note (they exist) | must | |
| 72 | Assignees | `+Name`, a view per person, "assigned to me" | should | |
| 73 | Comments with mentions and notifications | none beyond the note's own words | later | needs per-person notifications |
| 74 | Activity history | the note's versions with who wrote each, and the done lines | should | versions exist |
| 75 | Team workspace, roles, guests | the sharing roles that exist | drop | nib shares spaces and notes; an admin console is another product |
| 76 | Productivity: completed per day and week, goals | a Logbook header with counts per day | later | after the views |
| 77 | Karma | none | drop | points for ticking boxes is the opposite of calm |
| 78 | Vacation mode, days off | none | drop | belongs to Karma |
| 79 | Calendar sync (Google, Outlook) | an ICS feed of dated tasks from the Worker, read-only | later | a feed is cheap; two-way is a product |
| 80 | 100+ integrations | `nib mcp`, the account connector, the CLI and `nib://` | drop | one surface agents and scripts already use |
| 81 | API | the CLI's `tasks` verbs and `nib://add-task` (5.15) | must | |
| 82 | MCP server | `nib mcp` and the account connector (5.15) | must | Emil's ask |
| 83 | Offline | files | must | free |
| 84 | Sync | nib sync, tasks being notes | must | free |
| 85 | Mobile apps | the phone build with the panel and quick add | must | |
| 86 | Themes | the theme store | must | exists |
| 87 | Keyboard shortcuts | the keys of 5.16, rebindable | must | |
| 88 | Backups | versions, Recently deleted, the files | must | exist |
| 89 | Import from Todoist | API and CSV (5.17) | must | the way in |
| 90 | Export CSV | any view's menu: Copy as CSV, Save as CSV | should | Bases has it |
| 91 | Undo a completion | Ctrl+Z, and the toast's Undo | must | exists |
| 92 | Task Assist (break down, reword) | the AI sidebar on a task: "Break down" writes sub-tasks into the note for review | should | needs a provider |
| 93 | Email Assist | none | later | after 15 |
| 94 | Interface languages | the 40 catalogues | must | exists |
| 95 | Manual order within Today | Today keeps its own order per day in the device's store, by task anchor | later | a list across notes has no single file to order |
| 96 | Time blocking | drag a task onto an hour in the calendar's week or day; it gets `[time::]` and keeps its duration | should | |
| 97 | Collapse sub-tasks; hide completed sub-tasks | a twist on every parent row | must | |
| 98 | Counts in the sidebar, overdue marked | every panel row has its count; overdue in the danger tone | must | |

**Count: 58 must, 25 should, 10 later, 5 drop** (rows 4, 38 and 68 counted at their first
mark). All of it is free. Of the musts, Todoist charges for the calendar layout, more than 3
filters, more than 5 projects and custom reminders; of the shoulds, for durations,
deadlines, a full activity log, unlimited dictation and the AI features.

## 4. Database parity: every feature

One table, Obsidian's and Notion's features side by side. "Bases" and "Notion" say whether
each has it (✓), partly (~) or not (-).

| feature | Bases | Notion | nib | how |
| --- | --- | --- | --- | --- |
| **Rows and files** | | | | |
| a row is a note | ✓ | ✓ (a page) | must | the rows index (5.3) |
| a row is a task line | - | ~ (a page) | must | `nib: { rows: tasks }` on a view (5.11) |
| a base as a file | ✓ `.base` | - | must | Obsidian's YAML, read and written without losing a key nib does not know |
| a base inside a note | ✓ ` ```base ` | ✓ inline database | must | the fence, drawn in the editor and the reading view |
| embed a base or one view | ✓ `![[x.base#View]]` | ✓ linked view | must | the embed widget |
| new row from a view | ✓ | ✓ | must | a note made in the folder the filter names, with the filter's properties written in (the bug Bases has) |
| a row opened in a side peek | - | ✓ | should | a click opens the note in a split on the right; Ctrl+click in a tab |
| **Properties (columns)** | | | | |
| text | ✓ | ✓ | must | the Properties panel's controls, in the cell |
| number, with formats (currency, percent, progress bar) | ✓ (number) | ✓ | must, formats should | `nib.properties.<key>.format` |
| checkbox | ✓ | ✓ | must | |
| date, date and time | ✓ | ✓ | must | |
| date range | - | ✓ | should | two properties, or `start`/`end` named in the view; one bar on the timeline |
| list | ✓ | ✓ multi-select | must | chips |
| select with options and colours | ~ (text) | ✓ | must | `nib.properties.<key>.options`, colours from the six tones |
| status with groups | - | ✓ | must | a select whose options are in three groups; tasks have it by their box |
| person | - | ✓ | should | a property whose values are members of the shared space |
| files and media | ~ (link) | ✓ | must | a link or embed; the gallery's cover |
| URL, email, phone | ~ (text) | ✓ | should | text that opens the link, the mail, the dialler |
| tags | ✓ | - | must | `file.tags` and `tags` |
| formula | ✓ | ✓ | must | Bases' expression language (5.12) |
| relation, one-way | ~ (a link) | ✓ | must | a property holding wikilinks |
| relation, two-way | - | ✓ | must | the reverse is the link index's backlinks, never a second stored column |
| relation limited to one | - | ✓ | should | `nib.properties.<key>.one: true` |
| rollup | ~ (formula) | ✓ | must | a formula over the related notes, built from a picker (5.12) |
| created time, edited time | ✓ `file.ctime`, `file.mtime` | ✓ | must | |
| created by, edited by | - | ✓ | later | from sync v2's per-version author, once it is kept per file |
| unique ID with a prefix | - | ✓ | should | `nib.id: { property: id, prefix: BUG }`; the next number is written into a new row |
| button | - | ✓ | should | a column whose press runs a palette command or sets properties (5.13) |
| place | ✓ (Maps) | ✓ | later | with the map view |
| verification | - | ✓ (wikis) | drop | a wiki workflow, not a database feature |
| AI autofill of a property | - | ✓ | should | the AI sidebar fills a column for review (5.15) |
| property display names | ✓ | ✓ | must | Bases' `properties.<key>.displayName` |
| hide, reorder, resize columns | ✓ | ✓ | must | `order`, and `nib` widths |
| **Views** | | | | |
| table | ✓ | ✓ | must | virtualised rows |
| list | ✓ | ✓ | must | |
| cards / gallery, with a cover | ✓ | ✓ | must | Bases' image property, fit and ratio |
| board / kanban, drag changes the property | ✓ (1.14) | ✓ | must | |
| manual card order within a column | - | ✓ | should | `nib.order: [paths]` per column, kept in the base |
| board columns for empty groups, hidden groups, column order | ~ | ✓ | must | the group's options decide the columns, not the rows present |
| calendar (month, week, day) | - | ✓ | must | `type: calendar` (nib) |
| timeline / Gantt | - | ✓ | must | `type: timeline` (nib) |
| dependency arrows on the timeline | - | ✓ | should | Tasks' `🆔` and `⛔` for tasks, a `blocked-by` relation for notes |
| chart (bar, line, donut, number) | - | ✓ | should | `type: chart` (nib), drawn as SVG |
| feed | - | ✓ | later | a list of whole notes, one under the other; the reading view can almost do it |
| form | - | ✓ | should | `type: form` (nib): fields for the view's properties; Submit makes the note |
| public form | - | ✓ | later | through publishing, answers come in through the Worker |
| map | ✓ (plugin) | ✓ | later | tiles are a third party: loads on a press, and needs a place property |
| dashboard | - | ✓ | drop | a note that embeds several views is a dashboard already |
| **Filtering** | | | | |
| and, or, not, nested | ✓ | ✓ (three deep) | must | any depth |
| filters on the base and on each view | ✓ | ✓ | must | |
| functions in filters | ✓ | ~ | must | |
| `this`, the embedding note | ✓ | ~ (self-referencing templates) | must | |
| a quick search inside a view | ✓ | ✓ | must | the view's own field, words only |
| Todoist filter language | - | - | must | compiled to the same tree (5.8) |
| filter builder without typing | ~ | ✓ | must | rows of property, operator, value; the YAML underneath |
| **Sorting, grouping, summaries** | | | | |
| several sorts | ✓ | ✓ | must | |
| group by | ✓ | ✓ | must | |
| sub-group | - | ✓ | should | `nib.subGroupBy` |
| collapse groups, hide empty, reorder groups | ✓ (1.14) | ✓ | must | |
| limit, load more | ✓ | ✓ | must | |
| summaries under columns (count, sum, average, median, min, max, range, earliest, latest, checked, empty, filled, unique) | ✓ | ✓ | must | Bases' defaults and custom summary formulas |
| summaries per group | ~ | ✓ | should | the same row under each group |
| conditional colour | - | ✓ | should | `nib.colour: <expression returning a tone>` per view |
| wrap cells, row height, freeze the first column | - | ✓ | should | view options |
| **Templates, buttons, automations** | | | | |
| templates for new rows | - (core Templates) | ✓ | must | a note in the templates folder; Obsidian's `{{date}}`, `{{time}}`, `{{title}}` |
| a default template per base and per view | - | ✓ | must | `nib.template: "[[Templates/Bug]]"` |
| repeating templates | - | ✓ | should | a template with `🔁` makes a note on its schedule when nib runs (5.13) |
| buttons in a page | - | ✓ | should | the button column, and a ` ```button ` fence later |
| automation: property set when another changes | - | ✓ | should | rules in `nib.automations`, run where nib runs |
| automation: notification | - | ✓ | should | a reminder to the reader |
| automation: webhook, Slack, mail | - | ✓ | later | needs the Worker to run it while nib is closed |
| automation on a schedule | - | ✓ | later | with repeating templates on the Worker |
| **Structure** | | | | |
| sub-items | - | ✓ | must | nested tasks; for notes a `parent` relation, shown as a tree |
| dependencies, blocked-by | - | ✓ | should | as above; a blocked task dims and says why on hover |
| shift dependent dates | - | ✓ | later | after the timeline lands |
| lock a view or a base | - | ✓ | should | `nib.locked: true`; edits to the view ask first |
| copy as CSV, save as CSV | ✓ | ✓ | should | |
| import CSV as a base | - | ✓ | should | each row a note, columns as properties (CSV import exists) |
| duplicate a view | ✓ | ✓ | must | |
| **Formula language** | | | | |
| arithmetic, comparison, `&&`, `\|\|`, `!` | ✓ | ✓ | must | |
| date arithmetic `+ "1d"`, `relative()` | ✓ | ✓ | must | |
| `if`, `now`, `today`, `date`, `duration`, `number`, `list`, `link`, `file`, `max`, `min` | ✓ | ✓ | must | |
| string, number, list, date, link, file, object and regexp methods | ✓ | ✓ | must | the functions page, every one |
| `image`, `icon`, `html` | ✓ | ~ | must, html should | `html` is escaped outside the reader's own spaces (trust.ts) |
| `let`, `lets`, user functions | - | ✓ | later | Bases has none; a nib-only formula would not open in Obsidian |
| `random` | ✓ | - | must | |
| **Platform** | | | | |
| 10,000 rows | ~ | ~ | must | 5.17 |
| offline | ✓ | ~ | must | files |
| on the phone | ✓ | ✓ | must | the views at phone width (5.18) |
| agents read and edit | - | ✓ (Notion AI) | must | 5.15 |
| sync and share | ✓ (Sync) | ✓ | must | they are notes |
| version history | ✓ | ✓ | must | the note's versions |

**Count: 57 must, 24 should, 9 later, 2 drop** (where a row has two marks, its first).

## 5. The design

### 5.1 Where tasks live

**In notes, as lines.** A task is a list item with a box, as nib already reads it
(`packages/markdown/src/tasks.ts`), with its fields written after its words in the
[Tasks emoji format][tasks-emoji]:

```md
## Errands
- [ ] Call the bank about the card [time:: 16:00] [remind:: 15m] #admin ⏫ 📅 2026-10-06
  Their number is on the back of the old card.
  - [ ] Find the old card
- [ ] Water the plants 🔁 every 3 days when done 📅 2026-10-04
- [x] Water the plants 🔁 every 3 days when done 📅 2026-10-01 ✅ 2026-10-01
- [/] Draft the talk [duration:: 2h] [deadline:: 2026-10-20] ⏳ 2026-10-08
- [-] Renew the gym ❌ 2026-09-30
```

Why this and not a store of nib's own:

- **Portability is the promise.** Obsidian with the Tasks plugin reads every date, priority
  and recurrence; Dataview reads the bracket fields; every editor shows the words. A space
  that leaves nib loses nothing.
- **The emoji are hidden.** nib's live preview already hides the marks markdown is made of;
  a task's fields are marks too. The editor draws the line as its words and a row of quiet
  chips (5.7), and the source is one caret away, as every other mark is.
- **Context is free.** A task written in a meeting note sits under the meeting's heading, next
  to the paragraph that explains it. Todoist has to copy that into a comment.

**The fields.** nib reads all of the Tasks format and Dataview's bracket form, and writes
one canonical form so a round trip through Obsidian changes no byte.

| field | written | read too | notes |
| --- | --- | --- | --- |
| status | `[ ]` open, `[x]` done, `[/]` doing, `[-]` cancelled | any one character, as the box already reads it | `[>]` and others are kept and shown as open with their mark |
| due date | `📅 2026-10-06` | `[due:: 2026-10-06]` | Todoist's date |
| scheduled | `⏳ 2026-10-08` | `[scheduled:: ]` | "do it on", Things' When |
| start | `🛫 2026-10-08` | `[start:: ]` | hidden from Today and Upcoming until then, Things' Anytime |
| created | `➕ 2026-10-03` | `[created:: ]` | written by quick add when Settings says so (off by default) |
| done | `✅ 2026-10-03` | `[completion:: ]` | written on ticking |
| cancelled | `❌ 2026-10-03` | `[cancelled:: ]` | written on cancelling |
| priority | `🔺` p1, `⏫` p2, `🔼` p3, none p4 | `🔽`, `⏬`, `[priority:: ]` | the two low ones are kept and sort last |
| recurrence | `🔁 every week on Monday`, `... when done` | `[repeat:: ]` | always written in English, the words Tasks parses; shown in the reader's language |
| id, depends on | `🆔 a1b2c3`, `⛔ a1b2c3` | `[id:: ]`, `[dependsOn:: ]` | written when a dependency is drawn |
| tags | `#admin` | | Todoist's labels |
| time | `[time:: 16:00]` | `[time:: 16:00 Europe/Zurich]` | nib's; the due or scheduled date's time |
| duration | `[duration:: 45m]` | `1h30m`, `90m` | nib's |
| deadline | `[deadline:: 2026-10-20]` | | nib's; Todoist's deadline |
| reminders | `[remind:: 15m, 2026-10-06 09:00]` | | nib's; relative to the due time, or absolute |
| assignee | `[assignee:: Lucile]` | `+Lucile` in quick add | nib's |

**Order on the line**: words, then nib's bracket fields, then tags, then the emoji fields in
Tasks' own order. Tasks reads its fields from the end of the line backwards and stops at the
first thing it does not know, so nib's fields go before its own and every Tasks field stays
readable. A test holds the writer to the Tasks plugin's own examples.

**Projects, sections, sub-tasks, comments.**

- A **project** is a note. Every note with a task is one, and the panel lists the ones with
  open tasks (5.5). A folder is a group of projects, as Todoist's folders are.
- A **section** is the nearest heading above the task. A board of a project groups by it.
- A **sub-task** is a task indented under a task. Ticking a parent ticks its open sub-tasks
  in the same edit, as Todoist completes them with it; one Ctrl+Z opens all of them again.
- A **description** is the first indented paragraph under a task; a **comment** is any other
  indented line that is not a task; an **attachment** is an embed among them. Views fold them
  under the row and show a count.
- The **Inbox** is `Inbox.md` at the root of each space, made by the first quick add that
  names no note. It is an ordinary note, so it syncs and can be renamed; the space keeps
  which note is its inbox in its own settings (`inbox:` in the space's settings file), so a
  renamed inbox stays the inbox.

**Notes that are tasks.** Notion's way, a page per task, is also supported: a note whose front
matter has `status`, `due`, `priority` or `assignee` is a row like any other, and a view can
take notes, task lines or both (5.11). A reading list is notes; groceries are lines.

### 5.2 Recurrence and completion

Ticking a recurring task does what the Tasks plugin does, so both apps agree on the file:

1. A new open line with the next dates is written **above** the ticked one (Tasks'
   default), with every date moved by the same step so the gaps between them stay.
2. The ticked line gets `✅` and today's date and stays where it is. **That line is the
   history**: a Logbook view of `✅` dates is every occurrence ever done, synced and greppable,
   which Todoist keeps only in its paid activity log.
3. `every` steps from the old date; `when done` (Todoist's `every!`) steps from today.
   Past occurrences are skipped, as Todoist skips them and Tasks does not: a daily task
   overdue a week moves to tomorrow, not to six days ago. The line written is still one Tasks
   reads; only the date differs from the one Tasks would have picked.
4. **Skip** moves the dates without a done line; **End** removes `🔁`; **Complete forever**
   ticks it and removes `🔁` in one edit.
5. Sub-tasks of a recurring task come with it, open again, and their done lines stay under
   the done parent.

One edit to the document per tick, so one Ctrl+Z restores both lines. The rule's grammar is
the Tasks plugin's (`every 2 weeks on Monday, Friday`, `every month on the last Friday`,
`every year on 3 March`, `every weekday`, `until`, `when done`), parsed into an RRULE-shaped
value inside `@nib/bases` and written back as the same English words.

### 5.3 The index

**One pass, rows not files.** `scan_links` in `apps/desktop/src-tauri/src/links.rs` already
reads every note of a space once per launch, off the main thread, and the window keeps the
answer in `apps/desktop/src/lib/link-index.svelte.ts`, re-reading only the note that was
saved. The rows ride on that pass:

- the crate adds, per note, its **raw front matter block** and its **task lines** (the line
  number, the indentation, the box's character, the text, and the heading path above it).
  Raw, because one parser is enough: the window parses fields with `@nib/markdown` and
  properties with `packages/markdown/src/properties.ts`, so the crate and the window cannot
  disagree about a field. `apps/desktop/src/lib/scan-note.ts` does the same for the browser
  build;
- the window turns them into **rows** (`lib/rows/`), one per note and one per task, with
  parsed values and a stable anchor (path, line, and a hash of the words for re-finding a line
  that moved);
- every file operation (`apps/desktop/src/lib/workspace/file-ops.ts`) and every save updates
  the rows of that file and nothing else, and tells the views which rows changed.

**Every space, not only the open one.** Today has to see a task wherever it was written. The
open space is scanned first, as now; the other spaces are scanned once after the launch order
finishes, one at a time with a breath between them (`breathe.ts`), and kept current by the
space watcher. A space nobody opened this session costs one scan in idle time.

**No proprietary store, and no sidecar in the space.** The index is rebuilt from the files.
If a launch with a big space measures the Today view arriving later than 300 ms after the
first frame, the lane adds a cache in the app's own data folder (rows per file, keyed by size
and modification time), never in the space and never synced, so deleting it loses nothing.
Measure first.

**What it costs.** The pass reads the files it already reads; parsing a task line is a regex
and a split. Budget for 5,000 notes and 10,000 tasks on the reference machine: under 40 ms
added to the scan, under 4 MB of rows, under 2 ms to update one note's rows after a save.
`scan-note.perf.test.ts` gains the case.

**As built** (lane 2). The scan's note carries `front` (the lines between the fences, or
null), `tasks` (`{ line, indent, mark, text, section }`, `text` being everything after
the box, outside code and front matter, at most 5,000 a note and 2,000 characters a line)
and `stamp` (`{ size, mtime, ctime }` in milliseconds, off the handle the note was read
through); `@nib/bases/scan` (`packages/bases/src/scan.ts`) is the browser's twin, and its tests are the crate's cases. The
rows store is `lib/rows/`: `@nib/bases/rows` makes a note's rows (`readTask`, `noteValues`,
`taskHash`; `parent` is the nearest less indented task above under the same heading),
`store.ts` keeps them per space and file, `write.ts` is the one write path and `inbox.ts`
the inbox. `rows.svelte.ts` is the app's instance, fetched at the launch order's last turn:
the open space's rows are the link index's own scan (`links.held()`), the other spaces are
scanned after it one at a time, every save in any space reaches the rows through
`links.hearSaves`, and every file operation through `workspace.fileOps`. A change is told
per file, `{ root, space, path, removed, added }`, and `path` is null when a whole space
was read, renamed or forgotten. `rows.write(row, { note?, task? })` edits front matter keys
and task fields through `replaceInNotes`, finding a task's line again by its anchor's hash
where lines above it moved. An edit made outside nib reaches the rows exactly where it
reaches the link index, and no other way: the rows add no watcher of their own.

### 5.4 One engine: rows, queries, views

`@nib/bases` (new package, pure, no DOM) is the one place a question about rows is answered.

- **A row** is a note or a task. Its columns: `file.*` (Bases' own list), `note.*` (the front
  matter; for a task, its note's), `task.*` for a task (`text`, `status`, `done`, `due`,
  `scheduled`, `start`, `time`, `duration`, `deadline`, `priority`, `recurrence`, `tags`,
  `assignee`, `section`, `parent`, `line`, and the answers every view asks: `open`, `date`,
  `at`, `started`, `mine`, `subtask`; the full list is in 7.1), and `formula.*`.
- **An expression** is Bases' language, parsed once into a tree and compiled to a closure;
  evaluating 10,000 rows is a loop, not a parse.
- **A filter** is Bases' `and`/`or`/`not` of expressions. Todoist's filter language (5.8)
  compiles into the same tree, so a saved Todoist filter and a hand-written base are one
  thing.
- **A view** is the base's filters, the view's filters, sort, group, sub-group, limit and
  summaries, applied in that order, answering groups of rows with their summaries.
- **Incremental**: when rows change, a view re-evaluates those rows and moves them between
  groups; it never re-runs the whole space on an edit.

The built-in views are bases the app carries:

| view | rows | filter | group, sort |
| --- | --- | --- | --- |
| Inbox | tasks | open, in a space's inbox note | by space; note order |
| Today | tasks | open, due or scheduled on or before today, started | Overdue first, then Today; priority, time |
| Upcoming | tasks | open, dated after today, started | by day; time, priority |
| Logbook | tasks | done or cancelled | by `✅` day, newest first |
| Project | tasks | in this note | by heading; note order |
| Label | tasks and notes | carry this tag | by note |
| Assigned to me | tasks | assignee is the signed-in person | by date |

"Copy to a base" on any of them writes it as a `.base` file the reader then changes.

### 5.5 Where the views live

**A Tasks panel**, a new left panel (`'tasks'` beside `'tree'` and `'search'` in the `Panel`
type of `apps/desktop/src/lib/workspace.svelte.ts`), with its tab in the panel strip. It is
navigation, never a list of tasks itself, the way Todoist's sidebar is:

```
┌ Notes ▾ ──────────────────────┐
│ [Files] [Search] [Tasks]       │
├────────────────────────────────┤
│  ⊕  Add task          Ctrl+…  │   the quick add row, a field on press
│  ▢  Inbox                  4   │
│  ◷  Today                  7   │   7 in the danger tone if any are overdue
│  ▦  Upcoming                   │
│  ✓  Logbook                    │
│ VIEWS                          │
│  ▤  Reading list           31  │   a .base file, its own icon
│  ▥  Bugs board             12  │
│ PROJECTS                       │
│  ◻  Thesis                  9  │   notes with open tasks, by last edit
│  ◻  Moving flat             5  │
│  ◻  Errands                 3  │
│     More                       │   past seven, the rest
│ LABELS                         │
│  #  admin                   6  │
│  #  family                  2  │
└────────────────────────────────┘
```

- **Rows** are `.nib-row`s with the existing section labels; counts are the badge shape; no
  sentence anywhere. Bookmarked views, notes and tags come first, as favourites.
- **A row opens its view in a tab** of its own kind (a view tab, as the graph is a tab):
  full width, so a board and a calendar have the room they need, splittable beside a note,
  restored with the session. A project row opens the note itself; the note's menu has
  "Open as board" and "Open as calendar" for its own tasks.
- **Saved views** are the `.base` files in the space, listed here as well as in the file
  tree. A Todoist filter typed in a view's field and saved becomes one.
- **On the right instead**: the panel can be moved right like any panel; a reader who wants
  Today next to the note they write in moves it there and gets Today as a list in the panel
  (the panel draws the view's list layout when it is on the right).
- **On a phone** it is the drawer's third tab; a row opens the view as the page.

Why both a panel and tabs: the panel answers "where are my things" in one glance with counts,
the way Todoist's sidebar does, and stays out of the way of writing; a board, a calendar or a
long table needs the width of the window, which only a tab has.

**A view tab**:

```
┌ ◷ Today ─────────────────────────────────────────────────────────────────┐
│ Today  ▾ List   [Filter] [Sort] [Group]          ⌕ Search      ⊕        │
├──────────────────────────────────────────────────────────────────────────┤
│ OVERDUE · 2                                         Reschedule to today  │
│  ◯ Renew passport            Thesis › Admin     Fri 26    ⏫             │
│  ◯ Pay the dentist           Errands            Mon 29                    │
│ TODAY · 5                                                                │
│  ◯ Call the bank             Errands › Errands  16:00  🔔  ⏫            │
│      Their number is on the back of the old card.          1 ▸            │
│  ◯ Water the plants          Home               ↻                         │
│  ◑ Draft the talk            Talks              2h   ⚑ Oct 20            │
│  ◯ Review Lucile's PR        Work               +Lucile                   │
│  ◯ Gym                       Health             18:30  ↻                  │
└──────────────────────────────────────────────────────────────────────────┘
```

The head is the view's name (a menu: rename, copy to a base, open the file, delete), the
layout switch (list, board, calendar, timeline, table, cards, chart), three toolbar buttons,
the view's own search and its add button. A row is the box, the words (markdown drawn
inline), where it lives (note › heading, muted, a press opens the note at the line), and
its chips. A circle is a task box (Todoist's shape, with the priority's colour); half-filled
is doing.

### 5.6 Quick add

**Where**: the `Add task` row in the panel; the palette's `Add task` row, which turns the
palette's field into the quick add field; a key inside the app; a global key outside it; the
add button on any view (prefilled with what that view filters on: its note, its tag, its
day); the phone's plus held down, its tile, its widget and its share sheet.

```
┌───────────────────────────────────────────────────────────────┐
│ Call mum [tomorrow 16:00] [#family] [p1] [every Sunday]       │
│                                                               │
│  ▢ Inbox ▾      📅 Tomorrow 16:00   ⚑   🔔   ⏱      🎙   Add  │
└───────────────────────────────────────────────────────────────┘
```

- **Typed words become chips as they are recognised**, in the accent's tint, and stay where
  they were typed. A chip pressed is words again (Todoist's undo); Backspace into a chip
  takes it apart. The row under the field shows the result as controls (where, date,
  priority, reminder, duration), each one a picker for somebody who would rather click.
- **The grammar**, English and German, one table per language in `@nib/bases`:

  | what | English | German |
  | --- | --- | --- |
  | day | `today`, `tod`, `tomorrow`, `tmr`, `mon`...`sunday`, `next fri`, `in 3 days`, `next week`, `wednesday next week`, `next weekend`, `end of month`, `on the 15th`, `oct 6`, `6/10`, `2026-10-06` | `heute`, `morgen`, `übermorgen`, `Mo`...`Sonntag`, `nächsten Fr`, `in 3 Tagen`, `nächste Woche`, `Mittwoch nächste Woche`, `nächstes Wochenende`, `Monatsende`, `am 15.`, `6. Okt`, `6.10.` |
  | time | `16:00`, `4pm`, `at 4`, `noon`, `tonight`, `tomorrow morning at 7` | `16:00`, `16 Uhr`, `um 4`, `um 15.30`, `mittags`, `heute Abend`, `am Abend` |
  | repeat | `every day`, `every weekday`, `every other week`, `every 2nd week`, `every 2nd monday`, `every first monday`, `every 3 months`, `every morning`, `every!` | `jeden Tag`, `werktags`, `jede zweite Woche`, `jede 2. Woche`, `alle zwei Wochen`, `jeden 2. Montag`, `jeden ersten Montag`, `alle 3 Monate`, `jeden Morgen`, `jeden!` |
  | priority | `p1`...`p4`, `!!!` | the same |
  | where | `>Note`, `>Note /Heading`, `>Folder/Note` | the same |
  | tag | `#tag`, `@tag`, `%tag` | the same |
  | assignee | `+Name` | the same |
  | reminder | `!30m`, `!9am`, `!tomorrow 9am` | `!30m`, `!9 Uhr` |
  | deadline | `{fri}` | `{Fr}` |
  | duration | `for 45m`, `for 1h30` | `für 45 Min`, `1,5 Std` |

  The grammar is nib's own table rather than a library: [chrono][chrono], the usual one,
  has German only in part and no recurrences at all, and a table is what a third language
  is added to.

  Which language: the app's, then English, both always tried, so a German reader typing
  "tomorrow" is understood too. Dates are ambiguous across locales (`6/10`); the app's
  language decides the order, and the chip shows the result spelled out, so a misread is
  seen before Enter.
- **Enter** writes the line, the field stays open for the next (Todoist's habit); **Escape**
  closes; **Shift+Enter** a second line for the description; **Ctrl+Enter** writes and opens
  the note at the line. No toast: the new row slides into whatever view is open.
- **Where it lands**: the `>` note if named, else the note the add button belongs to, else
  the inbox of the space in front. A `>` with a name no note has makes the note, as a link
  does.
- **The global key** opens a small window of its own, the quick add and nothing else, over
  whatever app is in front, through `tauri-plugin-global-shortcut` (already a dependency,
  `apps/desktop/src-tauri/src/agents/shell.rs`). Registered after the launch order, never in
  the first paint. Default **Ctrl+Alt+Space** (Ctrl+Option+Space on a Mac, where
  Cmd+Ctrl+Space is the emoji picker), rebindable in Settings > Keyboard, and switched off
  there with one switch. It needs nib running, so the
  tray question is 8.6.
- **Inside the app** the key is the same, and **Q** in a view or the panel, Todoist's key,
  where no field has the keyboard.
- **Voice**: the microphone in the row records through the existing recorder, the words land
  in the field and are parsed like typing; with a provider connected, a long ramble is split
  into several tasks shown as rows to keep or drop (Ramble's correction by speech comes free:
  the words are editable before Enter).

**As built** (lane 3). The grammar is `@nib/bases/language`, its own entry so nothing that
never adds a task loads it: `grammar.ts` is a table's shape, `en.ts` and `de.ts` are the two
tables, `when.ts` reads a day and a time, `repeat.ts` a rule (English handed to the Tasks
plugin's own reader after Todoist's ways of saying one are said its way, German built into the
same `Rule`), and `parse.ts` is `parseQuickAdd(text, langs, now, { keep, notes })`, which
answers the words, the fields, `>Note` and `/Heading`, and every chip as a span of the line.
Where two phrases say the same field the last one is it and the earlier stays words; a day and
a time said apart both count; a time alone is today's, or tomorrow's once today's has gone by;
a rule with no day gets its first occurrence, `starting` its own. The ambiguous words are held
to a word in front that asks for a day: `sun`, `sat`, `wed` and every German two-letter day
(`am Do`, `nächsten Fr`), `Tom` is never tomorrow, a month's name alone is never a date, a
bare hour only after `at` or `um` (1 to 7 read as the afternoon), and `6/10` reads day first
except in `en-US`. The tests are a row each of the table above in both languages, and the
sentences that must stay words.

The app's half is `lib/quick-add/`. `QuickAdd.svelte` is the field: a plain input over a layer
that draws the same letters, so a chip wears the accent's tint without the field becoming a
rich-text editor; a press on a chip adds its span to `keep` and it is words again, and the
spans follow an edit (`field.ts`). The controls row is where, day, priority, reminder and
duration, each a popover of `pickers.ts`'s rows; a pick takes the words that said the same
field out of the line. `entry.ts` writes the line (`taskLine`) and the description under it
and says where it goes (`placeIn`: the end of the note's last list, a list of its own after a
paragraph, the end of a heading's section, a heading made where there is none); `write.ts`
resolves the note (`>` names one by path or name, made where it is missing; else the inbox
through `rows.inbox`) and writes through `replaceInNotes`, one undo. `QuickAddSheet.svelte` is
it inside the app, at the palette's place; **`showQuickAdd(prefill)` in `surfaces.svelte.ts`
is the entry lane 4's panel row and a view's add button call**, with `{ note, tags, due }` as
the view knows them, and the palette's Add task row is the same call. Settings, General has
Smart dates and From any app.

The global window is `quick-add.html` with `Window.svelte`, a page of its own carrying none of
the app, made by `src-tauri/src/quick_add.rs` on the first press of the key and hidden rather
than closed after it. The key is `app.quick-add`, registered by the window that holds the
`nib-quick-add-answering` lock after the launch order (`anywhere.svelte.ts`); the window asks
that page for the space's notes and hands it the task over a broadcast channel (`channel.ts`),
so it is granted nothing and writes nothing itself. The global shortcut plugin is added once
for it and the agents' stop (`hotkeys.rs`). A probe never registers the reader's key: under
`NIB_OFF_SCREEN` the key is `NIB_QUICK_ADD_KEY` or none. Neither quick add nor the rows store
is in the glasses' plugin, whose package had ten kilobytes to spare.

### 5.7 A task in the editor

The editor draws a task line as words and chips, hiding its fields the way it hides marks:

```
  ◯ Call the bank about the card   Mon 16:00 · 🔔 · #admin · ⏫
  ◯ Water the plants               ↻ every 3 days · Sat
  ◉ Water the plants               ↻ · Oct 1 · done Oct 1          (dimmed)
```

- Chips are a widget after the words (`packages/editor/src/live-preview/widgets.ts`), quiet
  (`--muted`, the small size), one per field: the date as a weekday within a week and a
  short date after, red when overdue; ↻ for recurrence; the flag for priority; 🔔 when a
  reminder is set; ⏱ and the duration; ⚑ and the deadline; the assignee's initial.
- **The caret on the line shows the source**, as every mark does, and the chips give way to
  the emoji and brackets as written.
- **A chip pressed** opens its picker as a small layer (`.nib-layer`): the date chip a
  calendar with Today, Tomorrow, Next week, No date and the time; the repeat chip the rule
  in words with presets. Every pick is one edit of exactly the characters that change.
- **Typing a date in words at the end of a task** (`... tomorrow`) offers the chip in the
  completion menu, as `[[` offers a note; Tab takes it. The source is never rewritten
  without the reader asking.
- **Ticking** (the box, Ctrl+Enter, or a view) writes `x` and `✅ date` in one edit, and for a
  recurring task the new line as well (5.2). The tick animates: the box fills, the words
  dim over `--dur-*`.
- The search's `task:` operators and the ` ```query ` fence keep working and keep their live
  boxes; a ` ```tasks ` fence (the Tasks plugin's) is drawn by the engine as a list view
  instead of as code, so Obsidian's query blocks come alive in nib.

**As built** (lane 3). `packages/editor/src/live-preview/task-chips.ts`, hooked in from
`decorate.ts` where a box is drawn, hides every field the Tasks plugin or nib writes as a mark
(dimmed with the caret on the line) and draws the chips after the words; tags stay words, and
so does an inline field nib has no name for. The module and the grammar behind it are fetched
the first time a line on screen has a field, and the note is drawn again when they land, as an
emoji is. Days are `task-days.ts`, shared with quick add. What only the app can do comes in on
the note index as `tasks` (`TaskHelp`): `tick`, the engine's (`tick` in `@nib/bases`, now
exported), used by the box, by Ctrl+Enter (`task-tick.ts`, one transaction, so one undo takes
back the done line and the next occurrence), by `rows.write({ task: { done } })` and by every
box in search and fence rows (`toggleTaskAt`); `pick`, a chip's choices in the app's menu out
of quick add's lists, written back as the edit of the characters that change; and `dayAtEnd`,
quick add's grammar over the words. A typed date is offered as a quiet hint after the caret
rather than in the completion menu, because a menu answers Enter and Enter at the end of a task
is the next task; Tab takes it (`task-hint.ts`, arriving with the completions). The
` ```tasks ` fence is answered by `lib/tasks-block.ts` (`readTasksQuery` and `answer` over the
open space's rows) in the query fence's own rows and boxes, in the editor and the reading view.

### 5.8 Filters: Todoist's language on the engine

A view's filter field takes Todoist's language as typed, and `@nib/bases` compiles it to the
expression tree; the toolbar's Filter button shows the same tree as rows to click. Saved, it
is written as Bases YAML, so Obsidian reads the filter as well.

| Todoist | nib reads it as |
| --- | --- |
| `today`, `tomorrow`, `overdue`, `od`, `no date`, `7 days`, `next 7 days`, `next week` | due (or scheduled) on, before or within |
| `date: oct 6`, `date before: fri`, `date after: today` | the same, on the due date |
| `deadline: ...`, `no deadline`, `deadline before: ...` | on `[deadline::]` |
| `p1`...`p4`, `no priority` | priority |
| `#Note`, `##Folder` | in that note; under that folder |
| `/Heading` | under that heading |
| `%tag`, `@tag`, `#tag` where no note has that name, `no labels` | tags |
| `assigned to: me`, `assigned to: Lucile`, `assigned`, `shared` | assignee; in a shared space |
| `created: ...`, `created before: ...` | the `➕` date, else the note's creation time |
| `recurring`, `!recurring`, `subtask`, `!subtask` | recurrence; has a parent task |
| `search: words` | the words of the line |
| `&`, `\|`, `!`, `( )`, `*`, `\` | and, or, not, grouping, wildcard, escape |
| `a, b` | two lists, one under the other, each with its own head (Todoist's comma) |

`#` in a filter means a note when a note has that name and a tag otherwise, with the chip
saying which, because filters are where Todoist users will type `#Work` from habit. Quick
add does not guess (5.6, 8.1).

### 5.9 The layouts

All views share the head of 5.5; the layout switch is one segmented control that swaps the
body with the app's swap motion. Each layout is a component over the engine's answer, so a
layout never filters or sorts.

**List**: the rows of 5.5, grouped, with twists for groups and parents. Drag to reorder
within a note (moves the lines, sub-tasks and comments with them), onto another group to
change what the view groups by, onto a note in the tree to move it there.

**Table**: a row per row, a column per property, virtualised with
`apps/desktop/src/lib/row-window.ts` (every row one row tall, so nothing is measured). A cell
edits in place with the Properties panel's control for its type
(`apps/desktop/src/lib/PropertiesPanel.svelte`, `apps/desktop/src/lib/property-choices.ts`).
Column headers sort on press, resize on drag, reorder on drag; the summary row sits under
the last row. Arrow keys move between cells, Enter edits, Escape leaves, as a spreadsheet.

**Board**: a column per group, in the order the property's options say (empty columns
kept, hideable from the column's menu, the Bases bug fixed). Dragging a card to another
column writes the grouped property, one edit; dragging within a column keeps the base's own
manual order. Group by status gives the classic To do, Doing, Done for task lines (`[ ]`,
`[/]`, `[x]`), and by heading gives Apple's sections as columns. A sub-group splits columns
into swimlanes.

```
┌ ▥ Bugs board ──────────────────────────────────────────────────────────┐
│ Bugs ▾ Board  [Filter] [Sort] [Group: status]          ⌕       ⊕       │
├──────────────────────────────────────────────────────────────────────────┤
│ TO DO · 5           DOING · 2           REVIEW · 1          DONE · 14   │
│ ┌────────────────┐  ┌────────────────┐  ┌────────────────┐             │
│ │ Sync loses a   │  │ Glass on Linux │  │ PDF search     │   ▸ folded  │
│ │ rename         │  │ ⏫  BUG-41      │  │ BUG-37  +Emil  │             │
│ │ ⏫ BUG-44 Oct 9│  └────────────────┘  └────────────────┘             │
│ └────────────────┘                                                      │
│ ⊕                   ⊕                   ⊕                               │
└──────────────────────────────────────────────────────────────────────────┘
```

**Cards**: Bases' cards, a cover from the image property (fit, ratio, size as Bases names
them), the title and a few chosen properties. A cover from the web loads only as the rule
for third-party content allows; a local picture loads at once.

**Calendar**: month, week, three days and day. Tasks and notes sit on their date property
(due by default for tasks; chosen per view for notes). A task with a time sits at its hour
in the week and day grids, as tall as its duration; dragging moves the date, dragging an
edge changes the duration, dragging from the no-date tray gives a date (Todoist's no-date
sidebar). A recurring task shows its future occurrences faded (Todoist shows them on Pro).
Today is marked with the accent.

```
┌ ▦ Upcoming ──────────────────────────────────────────────────────────────┐
│ ‹ Oct 2026 ›  Today    Month  Week  3 days  Day                 ⊕       │
├────────┬──────────┬──────────┬──────────┬──────────┬──────────┬─────────┤
│ No date│ Mon 5    │ Tue 6    │ Wed 7    │ Thu 8    │ Fri 9    │ Sat 10  │
│ ◯ Taxes│ ◯ Gym    │ ◯ Bank   │          │ ◯ Talk ▒ │ ⚑ BUG-44 │ ↻ Plants│
│ ◯ Paint│          │   16:00  │          │   2h   ▒ │          │         │
└────────┴──────────┴──────────┴──────────┴──────────┴──────────┴─────────┘
```

**Upcoming**: the built-in view's own layout is Todoist's: a week strip across the top, then
days as groups down the page, each with its add row; dragging a row onto another day or
onto the strip reschedules it. Its calendar layout is the one above.

**Timeline**: rows down, time across (days, weeks, months, quarters), a bar from a start
property to an end property (or a date and its duration), dragged to move, edges dragged to
resize; dependency arrows from `⛔` and `blocked-by`; a table of the rows beside it, as
Notion's. For notes (projects, a reading plan) more than for tasks.

**Chart**: bar (vertical, horizontal), line, donut and a single number, over a group and an
aggregation (count, sum, average, earliest, latest) with an optional cumulative line, drawn
as SVG in the theme's six tones (`docs/design.md`, "Which colour"). Read-only, as Notion's.
The Logbook's header is a chart of tasks done per day.

**Form**: the view's properties as fields; Submit makes a note in the base's folder with
those properties and the base's template. In the app first; a published form is later.

**Phone**: list and board at full width; table becomes a list of rows with the first three
properties under the title; calendar defaults to agenda; timeline is not offered under 600
px. Every drag is a long press then a move, as on the canvas.

**As built** (lane 4). Everything is `lib/views/`, fetched behind doors
(`viewSurface`, `tasksPanel` in surfaces.svelte.ts, `views/mount` from the link index
and the reading view), so the first paint carries the panel's tab mark and nothing else.

- **The panel** is `TasksPanel.svelte`, the `'tasks'` panel between Search and Links,
  on `Mod-Shift-y` (`app.tasks`). Inbox, Today and Upcoming are counted by the engine
  answering the very bases their tabs open (`panel.ts`), so a count and its rows cannot
  disagree. Saved views are the open space's `.base` files, each counted by its first
  view. A project's menu opens it as a board or a calendar. Moved right, it is Today's
  list. Every add row and Q (`tasks.quick-add`) open quick add (`openQuickAdd` in
  `add.ts`, `showQuickAdd`) with what the view knows: its note, Today's day, a label's
  tag, the column's day. A column that stands for a section, a priority or a status is
  more than quick add's prefill carries, so there the row's own field takes the words
  and writes them with those fields.
- **The view tab** is `TabKind` `'view'`; its words are a `ViewSpec` (`spec.ts`): a
  built-in and what it is about, or, for a `.base` tab, which of its views. A built-in
  view keeps its changes in the tab (`yaml`) until "Copy to a base" writes a file; a
  base file's changes are written into it with `writeBase`, every unknown key kept, as
  one undoable write. One tab per view per pane (`open.ts`). `workspace.documentAt`
  passes over a view tab, so the file under it is read and written as a closed file.
  The crate and the browser's tree list `.base` files (`is_base` in paths.rs).
- **One write path.** A cell, a drop and a key go through `rows.write`; a tick through
  the engine's `tick`, so a recurring task writes its next occurrence; moving whole
  lines (Alt+↑/↓, Tab, a drag within a note, onto a heading, into another note) is
  `lines.ts` and `act.ts`, one write of the notes it touches, and "Reschedule to today"
  is one write of every overdue note. Ctrl+Z in a view is `undoFileAction`.
- **What a drop means** is `drop.ts`: one question per grouping. A status column ticks
  (Done), opens again (To do) or writes the box; a day writes the date the task is
  placed by; Today's two halves move a task to today; a heading moves the lines; a note
  property writes the property. A board also keeps its manual order per column
  (`nib.order`), and a sub-group draws swimlanes.
- **The layouts** draw the engine's answer and never filter: `ListLayout` (windowed,
  sub-tasks under parents, the keys of 5.16), `TableLayout` (windowed, Obsidian's
  `columnSize`, header sort, drag to reorder, summaries, spreadsheet keys, cells in
  `Cell.svelte` with the Properties panel's own control, `properties/PropertyValue`),
  `CardsLayout` (Bases' `image`, `imageFit`, `imageAspectRatio`, `cardSize`; a cover on
  the web is the host's name until the reader opens it), `BoardLayout` (every card one
  height, each column windowed), `CalendarLayout` (month, week, three days, day; the
  tray; hours with duration; a pulled edge writes the duration; repeats faded),
  `UpcomingLayout`, `TimelineLayout` (start to due, or `nib.date` to `nib.end`;
  dependency arrows from `⛔`), `ChartLayout` (settings under the view's `nib:`). A
  phone gets `PhoneRows`, `AgendaLayout`, and no timeline.
- **Builders**: `FilterBuilder` reads Todoist's language into the tree (`fromTodoist`)
  and the tree into rows of property, operator and value (`filter-rows.ts`); a filter it
  cannot show stays as written. `ArrangeBuilder` is the sort and the group with its
  sub-group.
- **In a note**: the editor's `BaseWidget` and `EmbedBaseWidget` hand a box to
  `mountBase` on the note index; the reading view leaves a `[data-base-code]` box and the
  base card, and `mountBases` draws into them. A fence's changes are written back into
  the fence; `this` is the note.
- **Measured** (test/e2e/tasks.py, headless Chromium on the Snapdragon X Elite): see
  the numbers the drive prints for a board of 2,000 cards.
- **Not built here**: the comments count under a row (the rows carry no description
  lines), conditional colour, row height and frozen columns (lane 7's view options),
  Assigned to me in the panel.

### 5.10 Reminders

What a reminder is: a time, from `[remind::]` or from the due time when the task has one
and the automatic reminder is on (Settings: at the time, 5, 15, 30 or 60 minutes before,
or off). Location reminders are later (row 66).

**The scheduler** is a window store over the rows index (`lib/reminders/`): it keeps the next
reminders across every space (the next 64 per device, the limit iOS sets and a sane one
elsewhere), and whenever rows change it computes the difference and hands it on. Idempotent:
a reminder's key is the task's anchor plus its time, so editing a task moves its reminder
rather than adding a second one.

**Where it fires**:

| where | nib running | nib closed |
| --- | --- | --- |
| Windows | a toast from the notification plugin | **scheduled toasts**: the scheduler hands each to the system (`ToastNotifier.AddToSchedule` under nib's app id, through the `windows` crate already in the build), which shows it at the time with nib not running; the actions start nib |
| macOS | a notification | a `UNCalendarNotificationTrigger` request, which the system fires with nib quit |
| Linux | a notification | nothing unless nib is in the tray (8.6); said once in Settings |
| Android | a notification | **local alarms**: the page hands the list to Kotlin, which sets `AlarmManager` alarms, keeps the list in the app's own storage and sets them again after a reboot. No sync and no credential in Kotlin, so `docs/mobile.md`'s rule against a second sync implementation holds |
| browser build | a Web Notification while the tab is open | push from the Worker (8.5) |
| Even glasses | the phone's notification, which the Even app shows on the glasses like any other it is allowed to | the same, from the phone's alarm |

**Actions** on every notification that has them: **Done** (ticks it through the same write a
box does, starting nib in the background where it has to), **Snooze** (15 minutes, or until
tomorrow 9:00), and a press that opens the note at the line. A reminder that fired is not
fired again on another start; a task ticked on another device stops its reminders here as
soon as the change arrives.

**The gap**, said plainly: a phone that has not opened nib since a task was added on the
laptop has not scheduled its alarm. Todoist pushes from its server. Closing that gap is
push from the Worker, which can read notes (notes are not end-to-end encrypted, see
`docs/sync-v2.md`): it would keep a table of upcoming reminders from the task lines it
receives and send Web Push and FCM at the time. That is a real piece of work (a Firebase
project, a service worker route, a cron every minute, and the privacy question of the server
reading reminder times), and Emil decided to build it (8.5).

**As built** (lane 5, 2026-10-04):

- **When**: `remindTimes` and `momentOf` in `@nib/markdown/task-reminders`, shared by the
  app and the Worker so both agree on the minute. A relative `[remind:: 15m]` counts back
  on the wall clock from the task's time on its due (else scheduled) day; a bare time is
  on that day; an absolute one is its own moment; the automatic one is the account
  setting `remindBefore` (0, 5, 15, 30, 60, or -1 for off; Settings > General >
  Reminders), for every task with a day and a time. A floating time is the device's
  clock, a written zone its own. The id is `reminderId`: FNV-1a 64 over the space, the
  note, the words' hash and the minute, the same on every device and on the Worker.
- **The scheduler**: `lib/reminders/plan.ts` (pure, the next 64) and `scheduler.ts` (the
  store over `rows.watch`, quiet for 400 ms, nothing handed before every space is read,
  the same plan never handed twice, planned again just after the first reminder passes
  and at least every six hours). `start.svelte.ts` wires it after the rows, out of the
  first paint (`weight.test.ts` unchanged).
- **Windows**: `src-tauri/src/reminders/toasts.rs` puts each on `ToastNotifier`'s schedule
  under the app's id, tagged with its id in the group `nib.reminders`; the toast
  (`toast.rs`) is `scenario="reminder"` with the system's own snooze (15 min, 1 h,
  tomorrow 9:00) and Done as a `nib://reminder` link. Proved by
  `scripts/reminders-probe.py` on a probe of its own; where Windows refuses the id, the
  page rings the plan itself while nib runs (7.3's fallback).
- **macOS**: `reminders/macos.rs`, `UNCalendarNotificationTrigger` requests in one
  category with Done and two snoozes (15 min, 1 h), the delegate set at launch so a
  press that started the app is heard; a build that is not a bundle answers no and the
  page rings. Compiled and linted on the Mac runner only.
- **Presses**: every Done and press is a `nib://reminder?act=…&id=…&n=…` link (a Mac's
  delegate hands them over directly). The nonce is made per reminder and kept in
  `reminders.json` beside the settings for a week after it rang, so no link anybody
  else writes can tick a task. Done ticks through `rows.write` (`lib/reminders/presses.ts`),
  finding the line again by the words' hash; a press opens the note at the line. A
  launch for nothing but a Done comes up without its window and goes again unless the
  tray keeps it.
- **Linux and the browser build**: the crate answers no, and the page rings the plan with
  timers while it runs (`ring.ts`): the notification plugin on Linux, Web Notifications
  in a browser, each reminder once a run.
- **The tray** (decision 6): `residency.svelte.ts`, on by default while a reminder waits
  (and while the quick add key is held, which lane 3 says through `residency.quickAdd`),
  a switch in Settings, Windows and macOS only. One tray with the agents' (`tray_keep` in
  `agents/shell.rs`): Open, the stop while agents are connected, Quit.
- **Android**: `Reminders.kt` and `AlarmList.kt`; see docs/mobile.md, *Alarms*.
- **The Worker**: `services/sync/src/push` and `0044_push.sql`; see docs/mobile.md,
  *Push*, for what it sends, what is still the client's (lane 6 of docs/chats.md) and
  the keys Emil has to make. Dry-run under `wrangler dev --test-scheduled`: a due row in
  a local D1 was claimed by the minute's cron.

### 5.11 `.base` files, and nib's key

A base nib writes is a base Obsidian reads. nib's additions go under one key, `nib:`, at the
top level and inside a view, and every key nib does not know is kept on a round trip in the
order it was written. Obsidian ignores what it does not understand; lane 1 proves that with
fixtures opened in Obsidian 1.14 (if the top-level key were refused, the additions move into
the views, where plugin view types already keep their own options).

```yaml
filters:
  and:
    - file.inFolder("Bugs")
formulas:
  age: (now() - file.ctime).days
properties:
  status:
    displayName: Status
views:
  - type: kanban
    name: Board
    groupBy:
      property: note.status
      direction: ASC
    order:
      - file.name
      - note.priority
      - formula.age
    nib:
      subGroupBy: note.assignee
      order:
        To do: [Bugs/Sync loses a rename.md, Bugs/Glass on Linux.md]
  - type: table
    name: All
    summaries:
      formula.age: Average
  - type: calendar
    name: Due
    nib:
      date: note.due
  - type: list
    name: Open tasks
    nib:
      rows: tasks
    filters:
      and:
        - '!task.done'
nib:
  template: "[[Templates/Bug]]"
  id:
    property: id
    prefix: BUG
  properties:
    status:
      options:
        - { value: To do, group: todo, tone: neutral }
        - { value: Doing, group: doing, tone: info }
        - { value: Review, group: doing, tone: warning }
        - { value: Done, group: done, tone: success }
```

- **`nib.rows`**: `notes` (Bases' own, the default), `tasks`, or `both`. A view of tasks in
  Obsidian shows the notes those tasks are in, which is the graceful version of the same
  question.
- **nib-only view types** (`calendar`, `timeline`, `chart`, `form`) are drawn by nib; Obsidian
  shows its own message for an unknown layout, for that view only. Where a community plugin
  already named the type, nib uses the same name and options.
- **`this`** is the note that embeds the base, the base itself when opened, and the note in
  front for a base in a side panel: Bases' rules.

**Inline**: a ` ```base ` fence in a note is a base in that note, drawn where it stands in
the editor and the reading view, its head smaller, its rows editable; `![[Bugs.base]]` and
`![[Bugs.base#Board]]` embed a file's base or one of its views. A published page leaves the
fence as code, for the reason a ` ```query ` fence stays code (`apps/desktop/src/lib/query-block.ts`).

### 5.12 Properties, formulas, relations, rollups

- **The controls are the Properties panel's.** One component per type, used by the panel,
  a table cell, a card and a form, so a date is picked the same way everywhere.
- **The type of a property** is what Obsidian's `types.json` says where the space has one,
  else what its values look like, else what the base's `nib.properties` says (select options,
  number format, person, URL). nib writes `types.json` for a property the reader gives a type,
  so Obsidian agrees.
- **Writes** go through one path: `lib/rows/write.ts`, which edits a note's front matter with
  `frontMatterEdit` (`packages/markdown/src/property-edits.ts`) and a task's fields with the
  task writer, through `apps/desktop/src/lib/workspace/note-text.ts` for a note that is not
  open and through the open document's own transaction for one that is. So a cell edit is one
  undo, every pane showing the note has it at once, and the file-op event tells the index.
- **Formulas** are Bases' language, the whole functions page. A formula column is written to
  `formulas:`; the formula field completes property names and functions, and shows the value
  of the first row as it is typed.
- **Relations** are properties whose values are wikilinks (`project: "[[Thesis]]"`). The
  other side is not stored: the reverse column ("Tasks" on the Thesis row) is the link
  index's backlinks filtered by that property, so it can never drift, which Notion's two
  stored columns can.
- **Rollups** are formulas over a relation, made from a picker (relation, property,
  calculation: count, sum, average, median, min, max, range, earliest, latest, percent
  checked, unique) that writes, for example,
  `note.tasks.map(value.asFile().properties.done).filter(value).length`. The picker reads a
  formula it wrote back into its rows, and a formula it cannot read stays a formula.
- **Unique IDs**: a new row gets the next number for the base's prefix (`BUG-45`), counted
  from the rows the index holds. Two devices offline can both make 45; the second sync turns
  one into 46 the first time a reader looks (a merge of ids, not of notes).
- **Created by, edited by** wait for sync v2 to keep an author per version of each file.

### 5.13 Templates, buttons, automations, forms

- **Templates** are notes in a templates folder (`Templates/` unless the space says
  otherwise, as Obsidian's core plugin does), with `{{title}}`, `{{date}}`, `{{time}}` and
  `{{date:YYYY-MM-DD}}` filled in. "New note from template" is a palette row and a choice on
  the plus; a base's `nib.template` makes every new row from it. A project template is a note
  with tasks whose dates are written relative (`📅 {{date+7d}}`), which is how Todoist's
  project templates are used.
- **Repeating templates**: a template with `🔁 every Monday` in its front matter's `repeat`
  makes its note on schedule while nib runs (the next time nib runs, if it was closed: one
  note, not one per missed week, with the missed dates said in the note's list).
- **Buttons**: a property type whose cell is a button with a label and an action: run a palette
  command, set properties on this row, add a task to this note, open a URL. Notion's button,
  without a scripting language.
- **Automations**, in the base's `nib.automations`: when a row is added, or a property
  changes to a value, set properties, move the note to a folder, add a date, or remind. They
  run where nib runs, are listed in the base's menu with a switch each, and every run is one
  undoable edit. Webhooks, mail and schedules while nib is closed need the Worker (later).
- **Forms**: 5.9.

### 5.14 Sync, sharing, history

- **Tasks sync as notes.** Under sync v2 every note is a CRDT, so two devices ticking two
  different tasks of one note offline merge without a question, and the same task ticked on
  both stays ticked. A recurring task ticked on two devices offline makes two new lines; the
  index sees two open copies of one rule in one note and offers to drop the second (one
  press), which is the honest answer to a real conflict.
- **Sharing** is the existing sharing: a shared space or a shared note. Its members are the
  people `+Name` and the person property offer. "Assigned to me" needs the account's name,
  so it reads the signed-in person.
- **History**: the note's versions say who changed what and when; the done lines say what
  was done when. That is Todoist's activity log, for free and kept forever.

### 5.15 Agents

**The verbs**, in `nib mcp` (`apps/desktop/src-tauri/src/mcp/tools.json`, answered by the
window as the note verbs are, `apps/desktop/src/lib/agents/workspace/notes.ts`) and, where
marked, the account connector (`services/sync/src/mcp/tools.ts`, reading the account's notes
with nib closed):

| tool | arguments | what it does | connector |
| --- | --- | --- | --- |
| `list_tasks` | `view`? (`inbox`, `today`, `upcoming`, `logbook`, a `.base` path), `filter`? (Todoist's language), `space`?, `limit`? | rows with their anchors, note, heading, fields | yes |
| `add_task` | `text` (quick add grammar) or `fields`; `note`?, `under`? (a heading), `space`? | writes the line, answers its anchor | yes |
| `update_task` | `at`, any of `done`, `status`, `text`, `due`, `time`, `scheduled`, `start`, `priority`, `recurrence`, `remind`, `duration`, `deadline`, `assignee`, `tags`, `move_to` (note and heading) | one edit; ticking a recurring task writes its next line | yes |
| `query_base` | `path` or `yaml`, `view`? | the view's groups, rows and summaries | yes |
| `add_row` | `base`, `properties`, `title`? | a note made where the base says, from its template | yes |
| `edit_rows` | `base`?, `paths`, `properties` | front matter on several notes, one transaction per note | no |
| `edit_base` | `path`, `ops`: `add_view`, `edit_view`, `remove_view`, `set_filter`, `add_formula`, `add_property` | a base edited as YAML, every unknown key kept | no |

`set_task` stays as the one-box verb it is. Every write is a note edit, so the AI sidebar's
review (keep, undo, rewind) covers tasks with nothing added, and the grant's note scopes
cover them: an agent that may not write a space may not add a task to it.

**The AI sidebar.** Two commands, in the table of `docs/ai-sidebar.md` section 3:

- `/tasks [filter or words]`: with nothing, Today as rows in the thread with live boxes; with
  a filter, that view; with words ("everything for the thesis that is late"), the model writes
  the filter, shows it as a chip, and answers the rows (Filter Assist).
- `/today` (synonym `/plan-day`): plan my day. The model reads overdue, today, the next
  seven days, durations and deadlines, proposes an order and times that fit the reader's
  day, and writes `[time::]` and `⏳` as edits under review, so Keep or Undo decides. With
  `/goal` it can keep going ("clear the inbox: give every task a note and a date").

**The name clash.** Lane 5 of the AI sidebar registered `/tasks` (synonyms `/ps`, `/bashes`)
for a thread's background work, after Claude Code's `/tasks`. In nib "task" already means a
box in a note: the search's `task:` operators, the `set_task` verb, `read_note`'s `tasks`,
this document. One word per term (`docs/conventions.md`), so **`/tasks` becomes the to-do
command and background work becomes `/jobs`**, keeping `/ps` and `/bashes` as synonyms so a
Codex or Claude Code habit still lands. A one-row change in
`apps/desktop/src/lib/ai/commands/table.ts` and its row in `docs/ai-sidebar.md` 3.1, which
its table test reads. Decision 8.3.

**The CLI** (`docs/automation.md`): `nib tasks list [--view V] [--filter F]`, `nib tasks add
<text>`, `nib tasks done <anchor>`, `nib base query <path> [--view V]`, and the link
`nib://add-task?text=...`, which the five link verbs gain as their sixth, a write that can
only add a line to an inbox.

**As built** (lane 6). The verbs are `lib/agents/workspace/tasks.ts` in the window and
`services/sync/src/mcp/tasks.ts` on the Worker, both over `@nib/bases/agent`: a task
goes out as the fields it has with `at` (`path#line:hash`), found again in the note as
it is by the hash nearest its line, and a change is the note written back whole as the
agent's own edit (`writeNote`, the connector's `write_note`). `edit_rows` and
`edit_base` are the local server's alone. The seven rows cost the tools table 3,767
characters, about 950 tokens, and its ceiling went from 28,000 to 31,000. The rows of a
note are `@nib/bases/rows` (`rowsOfText` on the Worker), so both servers read a task
one way. `/tasks` draws its rows as a notice with live boxes (`ai/sidebar/TaskRows.svelte`)
and `/today` is a turn in Agent mode; the reader's own surfaces add, tick and list
through `lib/task-actions.ts`, which writes the way quick add does (`quick-add/write.ts`).
`add_task` reads its words with quick add's grammar (`quickWords`: the reader's language
and English in the app, English and German on the Worker), the Tasks plugin's own marks
written in them winning, and `>Note /Heading` choosing where it goes; every way a task
comes in places its line with one function (`placeIn`, `@nib/bases/tasks`). The CLI's verbs are the same verbs asked as the reader, and `nib://add-task`
takes the words and a space and nothing else.

### 5.16 Keys

| key | where | what |
| --- | --- | --- |
| Ctrl+Alt+Space | anywhere, the system | quick add window (rebindable, can be off) |
| Ctrl+Alt+Space, Q | in nib; Q only where no field has the keyboard | quick add |
| Ctrl+Shift+Y | in nib | the Tasks panel (the next free letter; registry decides) |
| Ctrl+Enter | a task line, a row | tick (exists) |
| T, Shift+T, Shift+M | a row in a view | date: today, tomorrow, next Monday |
| 1 2 3 4 | a row in a view | priority |
| Alt+↑ / Alt+↓ | a row | move it up or down within its note |
| Tab, Shift+Tab | a row | make it a sub-task, or lift it out |
| Space | a row | open the note at the line beside the view |
| G then T, U, I | a view or the panel | go to Today, Upcoming, Inbox (Todoist's own) |

Every key in `apps/desktop/src/lib/shortcuts/registry.ts`, shown in tooltips through
`shortcuts.tooltip`.

### 5.17 Importing from Todoist

An importer beside the others in `apps/desktop/src/lib/import/`, offered in the Import sheet:

- **From the account**, the complete way: the reader pastes a Todoist API token (Settings >
  Integrations > Developer in Todoist), nib reads `/api/v1` once (projects, sections, tasks,
  labels, comments, reminders, completed tasks if asked) and forgets the token.
- **From files**: a project's CSV export (`TYPE, CONTENT, DESCRIPTION, PRIORITY, INDENT,
  AUTHOR, RESPONSIBLE, DATE, DATE_LANG, TIMEZONE`, and the deadline and duration columns
  newer exports carry), or a backup ZIP of such CSVs.

What becomes what: a project a note (`Todoist/<Folder>/<Project>.md`, or into the space's
root if the reader chooses), a section a heading, a task a line with its sub-tasks indented,
its description and comments indented under it with their dates, attachments downloaded
beside the note (account import only), labels tags, priority the emoji (Todoist's API counts
4 as p1, which the importer turns round), the due date and time, `every` and `every!` (the
human string re-parsed by the same grammar, with the original kept as a comment under the
task when it cannot be read), deadlines, durations, reminders, assignees as names, and the
Inbox the space's inbox. Completed tasks, if asked, as done lines with their dates. A preview
says how many of each before anything is written, as the other importers do.

### 5.18 The phone and the glasses

- **Phone**: the Tasks panel is the drawer's third tab; views are the page; quick add opens
  from the plus held down, the tile, the widget and the share sheet, with the keyboard up and
  the chips row above it. The widget gets a second layout, Today, with a box per row that
  ticks through the app's own write. Reminders are local alarms (5.10).
- **Even G2**: the modal gains a fifth row, **Today**: the open tasks for today and overdue,
  eight lines, the box drawn as `□` the way a note's tasks already are (`docs/even.md`). Scroll
  moves the cursor, a tap ticks the task (the row dims and stays until the list is left, so a
  mis-tap is a second tap away), a double tap closes. The microphone row adds a task when what
  was said starts with "task" or "Aufgabe" ("task call mum tomorrow at four"), through the
  same parser. The glasses' strings stay one panel line long, as `i18n.test.ts` holds them.

### 5.19 Fast, quiet, moving

- **Out of the first paint.** The panel, the views, the engine and the parser are fetched when
  first asked for; the index rides on a pass that already happens. `apps/desktop/test/weight.test.ts`
  is not raised.
- **Nothing per keystroke scales with the space.** Quick add parses its own line; the editor's
  chips decorate the visible lines only; a view's search waits for the typing to stop
  (`afterQuiet`, `apps/desktop/src/lib/timing.ts`) and filters rows already in memory.
- **Budgets**, measured in the lanes' drives on 5,000 notes and 10,000 tasks: the Tasks panel
  with counts in one frame after it is asked for; Today in under 50 ms; a board of 2,000 cards
  scrolling at 60 fps; a tick reflected in every open view within one frame.
- **Words**: the panel and the views say names and counts, nothing else. Empty Today is an
  empty list with the add row; there is no "You're all done!" sentence (Todoist's
  illustration is exactly the copy nib does not write).
- **Motion**: a ticked task's box fills and the row fades and slides out of an open-only view
  over `--dur-*` with `--ease-out`; cards lift on drag with the canvas's shadow; the layout
  switch slides like every segmented control; reduced motion makes all of it a cut.
- **Tokens**: priorities are the six tones (p1 danger, p2 warning, p3 info, p4 none), select
  options take tones by name, nothing brings a colour of its own.

**As built** (lane 6). The phone's share sheet asks once more for words alone: **As a
task** puts the share's title, linked to where it came from, in the open space's inbox
(`mobile/shared.ts` `sharedTask`). The Today widget is a second widget beside the notes
one (`TodayWidget.kt`, `res/layout/widget_today.xml`), drawn from the JSON the page
already hands over (`mobile/widgets.svelte.ts`, its `today`), read again when the rows
change; a box opens the app with the task's anchor and the page ticks it through the one
write path (`mobile/handed.ts`), a row's words open its note, the plus is quick add.
The clipper's menu has **As a task** under nibeditor, a line in the inbox of the space the
last clip went to, the page or the link under the cursor linked in it, through the
Worker's `POST /v1/spaces/:id/tasks` (`services/sync/src/tasks.ts`), which is the
connector's `add_task` behind the session. On the glasses the modal's fifth row is
Today and "task ..." / "Aufgabe ..." adds to the inbox (docs/even.md).

## 6. What nib does not do

- **A Todoist account bridge** (two-way sync with Todoist): the import is the bridge; two
  sources of truth for one list is how tasks get lost.
- **Karma, streaks, vacation mode.**
- **Dashboards as a type.** A note with several embedded views is a dashboard, and a
  better one: it has words between the charts.
- **A formula language of nib's own.** Bases' is the language; a formula Obsidian cannot read
  is a base that stops working there.
- **Verification, wiki owners**, and the other Notion features that belong to a company wiki
  rather than a database.

## 7. The implementation plan

Seven lanes in three waves, at most six at once. Each lane reads this document,
`docs/conventions.md` and the rules for every nib agent first, writes tests for its logic,
and adds every new string to every catalogue in `apps/desktop/src/locales`. New files in the
app are named relative to `apps/desktop/src` (or `src-tauri/src`); the new package is
packages/bases, published in the workspace as `@nib/bases`.

### 7.1 The interfaces the lanes meet at

Written first, by lane 1: the shapes are in `packages/bases/src/types.ts` (exported from
`@nib/bases`), the task line's in `packages/markdown/src/task-line.ts` (re-exported by
`@nib/bases`, because the search and the editor read task lines without the engine). This
section is the summary; the comments in those files are the contract.

```ts
// @nib/markdown/task-line: one line, read the way the Tasks plugin reads it
type Priority = 1 | 2 | 3 | 4 | 5 | 6   // p1 🔺, p2 ⏫, p3 🔼, 4 none (p4), 5 🔽, 6 ⏬
type Remind = { before: number } | { time: string } | { at: string; time: string }
interface TaskFields {
  text: string; status: string; done: boolean; cancelled: boolean
  due?: string; scheduled?: string; start?: string; created?: string
  completed?: string; cancelledOn?: string; time?: string; zone?: string
  duration?: number /* minutes */; deadline?: string; remind: Remind[]
  priority: Priority; recurrence?: string /* the rule as written */
  onCompletion?: string; tags: string[] /* no '#' */; assignee?: string
  id?: string; dependsOn: string[]; block?: string
  fields: Record<string, string>      // inline fields nib has no name for, kept
}
function readTask(line: string): TaskFields | null
function parseTask(line: string): ParsedTask | null   // the fields and where each is written

// @nib/markdown/task-edits: the smallest edits, offsets into the line
type TaskChange = { [K in keyof TaskFields]?: TaskFields[K] | null }  // null removes
function writeTask(line: string, change: TaskChange): TextEdit[]
function changedTask(line: string, change: TaskChange): string
function taskLine(fields: TaskFields, prefix?: string): string        // a new line, nib's order

// @nib/bases: types.ts
type Value = null | boolean | number | string
  | { kind: 'date'; iso: string; time?: string; zone?: string }
  | { kind: 'duration'; ms: number; months: number }
  | { kind: 'link'; target: string; display?: string }
  | { kind: 'image'; src } | { kind: 'icon'; name } | { kind: 'html'; html }  // drawn, not read
  | Value[] | { [key: string]: Value }
interface FileInfo { name; basename; path; folder; ext; size; ctime; mtime  // ms
  tags: string[]; links: string[]; embeds: string[]; shared?: boolean }
interface TaskRow extends TaskFields { section: string[]; parent?: number; indent: number }
interface Row {
  kind: 'note' | 'task'; space: string; path: string   // path relative to the space
  anchor?: { line: number; hash: string }               // hash = taskHash(task.text)
  file: FileInfo; note: Record<string, Value>; task?: TaskRow
}
type Filter = string | { and: Filter[] } | { or: Filter[] } | { not: Filter[] }
interface Base { filters?: Filter; formulas: Record<string, string>
  properties: Record<string, PropertyConfig>; summaries: Record<string, string>
  views: View[]; nib: NibBase; kept: Record<string, unknown> }
interface View { type; name; filters?: Filter; order: string[]; sort: Sort[]
  groupBy?: Sort; limit?: number; summaries: Record<string, string>
  nib: NibView; options: Record<string, unknown> }   // options: every other key, kept
interface Context { today: string; now: string; this?: Row; me?: string; search?: string
  resolve?(target, from: Row): string | null; row?(path, space): Row | undefined
  backlinks?(row: Row): string[] }
interface Group { key: Value; rows: Row[]; summaries: Record<string, Value>; sub?: Group[] }
interface Answer { groups: Group[]; total: number; summaries: Record<string, Value> }

// @nib/bases: functions
function noteValues(frontMatter: string): Record<string, Value>    // the note, or its block
function taskHash(text: string): string
function readBase(yaml: string): Base
function writeBase(base: Base, before?: string): string   // keeps order, quoting, comments, unknown keys
function compile(expression: string): Compiled            // Bases' language; .evaluate(row, context, formulas)
function compileFilter(filter: Filter): (row: Row, context: Context) => boolean
function fromTodoist(filter: string, options?: { lang?; today?; isNote?(name) }): Filter[]
                                                          // one per comma-separated list
function answer(base: Base, view: string | number | undefined, rows: readonly Row[],
                context: Context): Answer                 // compiled once per Base object, kept
function compileView(base: Base, view?): { view; answer(rows, context): Answer }
function cellValue(base: Base, property: string, row: Row, context: Context): Value
function viewOf(base, view); groupName(key: Value): string; rowId(row: Row): string
function parseRule(text: string): Rule | null            // the Tasks plugin's grammar
function ruleText(rule: Rule): string                     // its own words, `until` without `-`
function nextDate(rule: Rule, start: string, after: string): string | null
function nextOccurrence(task: TaskFields, today: string, options?: { skipPast?; created? }):
  TaskFields | null
function tick(note: string, line: number, today: string, options?): TextEdit[]
                                 // offsets into the note, in order; one undo. Ticks open
                                 // sub-tasks, writes a recurring task's next block above
function skip(line: string, today: string): TextEdit[]    // the dates move, nothing ticked
function finish(line: string, today: string): TextEdit[]  // ticked and the rule taken off
function builtinView(name: 'inbox' | 'today' | 'upcoming' | 'logbook' | 'project' | 'label'
  | 'assigned', params?: { inboxes?; note?; tag? }): Base
function readTasksQuery(source: string): { base: Base; unsupported: string[] }
function parseQuickAdd(text: string, langs: string[], now: Date): QuickAdd   // lane 3

// what an expression reads beyond Bases' own `file.*`, `note.*`, `formula.*`, `this`:
//   file.space, file.shared
//   task.text status done cancelled open due scheduled start created completed cancelledOn
//   deadline date (due, else scheduled) at (date and time) started time zone duration
//   remind priority recurrence recurring tags assignee mine id dependsOn section (nearest
//   heading) headings parent subtask indent line note, and task.hasTag(...)
```

The rows store (lane 2) is `rows.of(space?)`, `rows.watch(listener)`, and `rows.write(row,
change)`, the one write path. It builds `Row`s with `readTask`, `noteValues` and
`taskHash`, writes task fields with `writeTask` and ticks with `tick`; the engine never
reads a file. The reminders store (lane 5) reads `rows.watch` and nothing else.

### 7.2 The lanes

| lane | owns | builds | tests | wave |
| --- | --- | --- | --- | --- |
| **1 `rows-engine`** | `@nib/bases` (new, in packages/bases); `packages/markdown/src/tasks.ts` and its test; the `tasks` fence's reading | the types above; the task line reader and writer (5.1), canonical order, every Tasks and Dataview field; recurrence (5.2) with next occurrence; Bases YAML read and write with every unknown key kept; the expression language (parser, compiler, every function and method of the functions page); filters, sort, group, sub-group, limit, summaries (the defaults and custom); Todoist's filter language (5.8); the built-in views (5.4) | the Tasks plugin's documented examples round-trip byte for byte; Bases' documented example reads and writes unchanged; every function against Obsidian's documented results; 10,000 rows answered under 20 ms in a perf test; Todoist's documented filters compile to the expected trees; recurrence over month ends, leap days, `when done`, `until` | 1 |
| **2 `rows-index`** | `lib/rows/` (new); `apps/desktop/src-tauri/src/links.rs` (the scan's two new fields); `apps/desktop/src/lib/scan-note.ts`; the space's `inbox` setting | task lines and raw front matter on the scan (crate and browser); rows built and kept current through `file-ops.ts` and saves; every space scanned after the launch order; the one write path (`lib/rows/write.ts`) for properties and task fields; the inbox note; the cache only if 5.3's measure says so | cargo tests for the scan's fields; store tests for created, moved, removed, saved and a note open with unsaved words; a perf test with 5,000 notes and 10,000 tasks (scan cost, memory, update time); `weight.test.ts` unchanged; a draft-PR CI for the crate | 1 |
| **3 `quick-add-and-editor`** | `@nib/bases`'s `language/` folder (new); `lib/quick-add/` (new); `packages/editor/src/live-preview/` task chips (a new file, a hook in `decorate.ts`); the quick add window in `src-tauri/src` (new file) | the en and de grammar tables and the parser (5.6), chips in the field, the pickers; the quick add sheet, palette row, panel row and global window with its key; the editor's chips, pickers, completion of a typed date and the tick with recurrence (5.7); the ` ```tasks ` fence drawn by the engine | parser tests per table row in both languages and the ambiguous cases; editor state tests for chips hidden and shown with the caret, a pick as one edit, a recurring tick as one undo; a drive: quick add from the palette into the Inbox, a chip pressed back to words; the global key tested on a probe through `run_probe` only | 2 |
| **4 `views`** | `lib/views/` (new); the `'tasks'` panel in `apps/desktop/src/lib/workspace.svelte.ts` and `apps/desktop/src/lib/workspace/panels.ts`; the view tab's kind in `apps/desktop/src/lib/openers.ts`; the base fence and embed; `apps/desktop/src/lib/PropertiesPanel.svelte` (its controls lifted into shared ones) | the Tasks panel (5.5); the view tab and its head; list, table, cards, board, calendar, Upcoming, timeline and chart layouts (5.9); inline editing through `rows.write`; drag on every layout; the filter, sort and group builders; saving a view as a `.base`; ` ```base ` and `![[x.base#View]]`; the phone layouts | component tests per layout; a drive `test/e2e/tasks.py`: seed tasks and notes, Today and Upcoming right, a board drag writing the property, a calendar drag writing the date, a table cell edit undone with Ctrl+Z, an embedded base in a note; the same at phone width; 2,000-card board scroll measured | 2 |
| **5 `reminders`** | `lib/reminders/` (new); `src-tauri/src` reminders module (new); the Android alarm and boot receiver (new Kotlin beside `Widgets.kt`); the tray residency setting | the scheduler (5.10); Windows scheduled toasts and macOS triggers; the notification actions starting nib in the background; Linux and the tray; Android alarms, actions and reboot; the settings rows; the Worker push (8.5) | scheduler tests (a moved task moves its reminder, a ticked one cancels, a recurring one schedules the next, 64 kept); cargo tests for the scheduling calls behind a trait; a probe with an identifier of its own, never Emil's nib, that a scheduled toast is registered; Android unit tests for the alarm list | 2 |
| **6 `tasks-everywhere`** | `apps/desktop/src-tauri/src/mcp/tools.json` and the window's handlers (`lib/agents/workspace/tasks.ts`, new); `services/sync/src/mcp/tools.ts`; `apps/desktop/src/lib/ai/commands/table.ts` and `docs/ai-sidebar.md` 3.1; the CLI's verbs; `lib/import/todoist.ts` (new); the Even Today screen in `apps/desktop/src/lib/even/`; the widget's Today layout | the verbs of 5.15 on both servers; `/tasks`, `/today` and the `/jobs` rename; the CLI verbs and `nib://add-task`; the Todoist importer from the API and CSV (5.17); the glasses' Today and spoken add (5.18); the clipper's "As a task" and the share sheet's | verb tests through the MCP harness, a grant without the space refused; the AI command table test green with the new rows; importer tests on a recorded API answer and Todoist's documented CSV, with priorities turned round and recurrences re-parsed; Even screen tests within the panel's eight lines | 2 |
| **7 `database-extras`** | `lib/views/` additions agreed with lane 4 (the form layout, the button cell, the rollup picker); `@nib/bases`'s `automations` (new) | relations' reverse columns and the rollup picker (5.12); unique ids; select options with tones; conditional colour; forms; buttons; templates and repeating templates; automations; locking; CSV export and CSV import as a base | engine tests for rollups, id collisions, automations firing once per change and undoing as one; a drive: a form makes a note, a button sets a property, a rollup counts | 3 |

**Wave 1** is lanes 1 and 2 together: one is a pure package, the other the crate and the
store, meeting at 7.1's types. **Wave 2** is lanes 3, 4, 5 and 6 together once lane 1's
types and lane 2's store are on main, each against fixtures until the other lands; lane 4
draws what lane 3 parses and owns none of its logic. **Wave 3** is lane 7, after lane 4's
views are on main. At most six run at once: wave 2 is four.

Docs each lane updates: lane 1 `docs/conventions.md`'s layout table (the new package);
lane 4 `docs/design.md` (the panel and the views); lane 5 `docs/mobile.md` (the alarms);
lane 6 `docs/agent-native.md` 5.3, `docs/automation.md`, `docs/import.md` and `docs/even.md`.

### 7.3 Risks

- **Obsidian and the `nib:` key.** Proved by lane 1 on day one, with the fallback of 5.11.
- **Obsidian 1.14's own keys.** The kanban's `type` and the cards' option names are read off
  files Obsidian itself writes, kept as fixtures, never guessed from the help pages.
- **The Tasks plugin's parser and nib's bracket fields.** Proved by round-tripping the
  plugin's own test lines; the order rule of 5.1 exists for it.
- **Windows scheduled toasts without a packaged identity.** The notification plugin already
  shows toasts under nib's app id in the installed build; lane 5 proves scheduling under the
  same id in a probe with its own identifier before building on it, and falls back to the
  tray where it cannot.
- **Android exact alarms.** From Android 14 `SCHEDULE_EXACT_ALARM` is no longer granted to
  a new install by default, and `USE_EXACT_ALARM` is for clocks and calendars. nib sends the
  reader to the system's switch once, the first time a reminder is set, and falls back to
  inexact alarms (within minutes) when it stays off.

## 8. Decisions

Emil decided all eight on 2026-10-03, each as recommended. The design above is written to
them.

1. **`#` stays a tag in quick add, and a project is `>Note`.** Decided. In a markdown file
   `#Work` is a tag, and Obsidian agrees; filters accept `#Work` for a note of that name
   (5.8), because that is where Todoist habits land.
2. **Bare dates are due dates (`📅`).** Decided. Todoist calls its date "due" and most
   Obsidian users write `📅`; the stricter reading is there through `⏳` and `{deadline}`.
3. **`/tasks` means to-dos, background work becomes `/jobs`** (synonyms `/ps`, `/bashes`).
   Decided.
4. **Tasks views span every space**, each row saying which space when it is not the open
   one. Decided.
5. **Push through the Worker.** Decided: built in lane 5. The Worker keeps a table of
   upcoming reminders from the task lines it receives and sends Web Push and FCM at the
   time, so a phone that has not opened nib since a task was added elsewhere still rings.
6. **nib in the tray** by default when the global quick add key is set or a reminder
   exists (Todoist's way), and off otherwise. Decided.
7. **An inbox per space** (`Inbox.md` in each), shown together in the Inbox view. Decided.
8. **Bases and templates are back; daily notes stay out** (Today is the daily list).
   Decided.

## Sources

[td-pricing]: https://www.todoist.com/pricing
[td-quickadd]: https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz
[td-dates]: https://www.todoist.com/help/articles/introduction-to-dates-and-time-q7VobO
[td-recurring]: https://www.todoist.com/help/articles/introduction-to-recurring-dates-YUYVJJAV
[td-deadlines]: https://www.todoist.com/help/articles/introduction-to-deadlines-uMqbSLM6U
[td-duration]: https://www.todoist.com/help/articles/set-a-task-duration-L1kYkZv8d
[td-reminders]: https://www.todoist.com/help/articles/introduction-to-reminders-9PezfU
[td-location]: https://www.todoist.com/help/articles/use-location-reminders-in-todoist-uGcwH2AJ6
[td-glossary]: https://www.todoist.com/help/articles/todoist-glossary-cA60laWMH
[td-filters]: https://www.todoist.com/help/articles/introduction-to-filters-V98wIH
[td-calendar]: https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o
[td-productivity]: https://www.todoist.com/help/articles/use-the-productivity-view-in-todoist-6S63uAa9
[td-csv]: https://www.todoist.com/help/articles/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN
[td-email]: https://www.todoist.com/help/articles/forward-emails-to-todoist-JPJ1V339
[td-ramble]: https://www.todoist.com/help/articles/dictate-to-add-tasks-with-ramble-P1Raq7vVF
[td-assist]: https://www.todoist.com/help/articles/introduction-to-todoist-assist-KgPP22q5O
[td-api]: https://developer.todoist.com/api/v1/
[tt]: https://ticktick.com/features
[things]: https://culturedcode.com/things/support/articles/2803573/
[apple-rem]: https://support.apple.com/en-us/119953
[apple-smart]: https://support.apple.com/guide/iphone/use-smart-lists-iphe882772ed/ios
[mstodo]: https://support.microsoft.com/en-us/office/my-day-and-suggestions-fc09a1b9-0854-4906-b166-f480ee97a139
[tasks-emoji]: https://publish.obsidian.md/tasks/Reference/Task+Formats/Tasks+Emoji+Format
[tasks-dv]: https://publish.obsidian.md/tasks/Reference/Task+Formats/Dataview+Format
[tasks-recur]: https://publish.obsidian.md/tasks/Getting+Started/Recurring+Tasks
[tasks-query]: https://publish.obsidian.md/tasks/Queries/About+Queries
[logseq]: https://discuss.logseq.com/t/scheduled-and-deadlined-tasks-todo-and-later/18490
[bases-syntax]: https://obsidian.md/help/bases/syntax
[bases-views]: https://obsidian.md/help/bases/views
[bases-functions]: https://obsidian.md/help/bases/functions
[bases-cards]: https://obsidian.md/help/bases/views/cards
[bases-create]: https://obsidian.md/help/bases/create-base
[obsidian-114]: https://obsidian.md/changelog/
[kanban-review]: https://practicalpkm.com/kanban-review/
[notion-props]: https://www.notion.com/help/database-properties
[notion-views]: https://www.notion.com/help/views-filters-and-sorts
[notion-rel]: https://www.notion.com/help/relations-and-rollups
[notion-deps]: https://www.notion.com/help/tasks-and-dependencies
[notion-templates]: https://www.notion.com/help/database-templates
[notion-forms]: https://www.notion.com/help/forms
[notion-auto]: https://www.notion.com/help/database-automations
[notion-charts]: https://www.notion.com/help/charts
[notion-timeline]: https://www.notion.com/help/timelines
[notion-feed]: https://www.notion.com/help/feeds
[notion-map]: https://www.notion.com/help/maps
[notion-dash]: https://www.notion.com/help/dashboards
[chrono]: https://github.com/wanasit/chrono
