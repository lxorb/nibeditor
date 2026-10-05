# The AI sidebar

A design and a plan. It decides what the right side's AI panel becomes: a conversation with
any model the reader owns, about what is on screen, that can act on notes and tabs, and that
gives the reader the controls a coding agent gives a programmer - which model, how hard it
thinks, how full its window is, what it changed and how to take that back. Section 6 is the
plan the lanes build from.

Emil, 2026-10-03:

> I want an actually good AI interface, on the same level as the native OpenAI and Anthropic
> plugins for VS Code, or Cursor, or anything else. From each of these, by the role model
> concept, take the best features, and engineer the best possible AI sidebar there could be
> in terms of UI, feel and everything. Currently you can't choose the model, can't set
> reasoning, can't see the context window, and so on. I also want slash commands: all the
> ones Anthropic or OpenAI have, with synonyms where needed, using the same names as
> Anthropic and OpenAI where possible, and as general as possible (e.g. Anthropic's /goal
> should also work with OpenAI models). Combine every feature you'd want from Cursor, OpenAI
> and Anthropic with the best UI it could have.

Read with `docs/ai.md` (the providers, the plan rules, the seam) and `docs/agent-native.md`
(the tools, live note edits, grants). Nothing here loosens either.

## The short version

1. **One panel replaces Ask**, in the same slot on the right and on the same key
   (**Ctrl+Shift+A**). Ask - answers from the notes with numbered citations - becomes the
   panel's first mode rather than a panel of its own. Properties and the Activity panel stay
   where they are.
2. **Three modes on one chip: Ask, Plan, Agent** (**Shift+Tab** cycles them, as in Claude
   Code and Cursor). Ask reads and cites. Plan reads and writes a plan you can edit. Agent
   acts: notes, tabs, the browser, the terminal, as far as its grant reaches.
3. **Every provider, every control.** A model chip under the field opens one popover: the
   model (from the provider's own list), the effort (Auto, Low, Medium, High, Extra, Max,
   only the levels that model has), and Fast where the provider offers it. The same popover
   for a key, a ChatGPT plan, Claude Code and Codex.
4. **A context ring beside it**, from the provider's own token counts after every answer
   and an estimate (marked ≈) for the draft. Hover for numbers, click for the breakdown;
   compaction is automatic near the top and `/compact` by hand.
5. **The agent is nib's own agent with nib's own tools.** Whether nib runs the loop (keys and
   the ChatGPT plan) or Claude Code and Codex do, the tools are the `nib mcp` verbs, under a
   grant in Settings > Agents, through the same policy as any agent: the always-ask list,
   untrusted marks, the stop key. Never a folder, never a shell of the reader's.
6. **Edits land live and are reviewed after**, Cursor's and Copilot's way: every note the
   agent touched is listed over the field with its +/− count, each change is marked in the
   note, and **Keep** or **Undo** works per change, per note or for all of it. Undo is the
   per-agent undo that already exists, mapped through whatever the reader typed since.
7. **Checkpoints at every message.** `/rewind` (or **Esc Esc** on an empty field) restores
   the notes, the conversation, or both, to before any message; editing an old message does
   the same and sends it again.
8. **Fifty-eight commands, with the vendors' names.** Every Claude Code and Codex command
   has a row in section 3: the nib command it is, or why it has none. `/goal`, `/compact`,
   `/btw`, `/rewind`, `/plan`, `/review` and the rest work the same whoever answers; where a
   CLI has the command itself, nib hands it through, and where not, nib does it.
9. **Threads are kept, searchable, branchable**: per space, on this device, never synced,
   exported to a note on demand.
10. **Keyboard first, quiet, fast.** Everything above has a key; the panel is lazy and out of
    the first paint; the only words on screen are the model's.

---

## 1. What it is for

A reader asking a model about their notes wants four things, and today's panel gives one:

1. **An answer about what is in front, that can be checked.** The Ask panel does this, and
   the citation that opens its passage stays (`docs/ai.md`, "The Ask panel").
2. **The model they chose, thinking as hard as they chose.** The panel asks whichever
   provider Settings > AI > Used for names, with that provider's one model and its default
   effort. Changing either is a trip to Settings, and effort cannot be set anywhere.
3. **To know what a conversation costs before it costs it**: how full the window is, when it
   will be compacted, how much of a plan is left.
4. **Work done, not words to paste.** "Tidy these notes", "file this page under Reading",
   "turn my outline into the deck": an agent that edits, in the open, where every edit can
   be seen, kept or taken back.

The coding agents solved 2 to 4 for code; nib's job is to bring that over for notes, tabs
and pages without bringing over what makes them tiring: a terminal's worth of text, a modal
for every edit, a model list nobody maintains.

---

## 2. What others do

Read on 2026-10-03 from each product's own documentation. ✓ has it, ~ partly, - not.

### 2.1 By product

**Claude Code, CLI and VS Code extension** ([commands][cc-commands], [VS Code][cc-vscode],
[model config][cc-model], [checkpointing][cc-checkpoint], [goal][cc-goal],
[interactive mode][cc-interactive], [headless][cc-headless], [CLI flags][cc-cli]).

- Model picker with an **Effort** row on the same popover; the model button shows the level
  (`Opus 5.5 · High`). Aliases `default`, `best`, `fable`, `opus`, `sonnet`, `haiku`,
  `opusplan`, and `[1m]` for the long window. **Alt+P** switches model, **Alt+T** thinking,
  **Alt+O** fast mode.
- **Context indicator** in the prompt box; auto-compaction at a window set by `/autocompact`;
  `/context` draws a grid of what fills it. A **prompt-cache clock** counts the cache's
  minutes down.
- `@` file and folder mentions with fuzzy match, `@file#5-10` line ranges inserted by
  **Alt+K**, the open file and selection attached implicitly with an X to drop them,
  `@terminal:name`, `@browser`; images pasted; files dragged with Shift.
- Permission modes on a chip: **Manual** (asks before edits), **Auto** (a classifier),
  **Plan** (a plan opened as a document you comment on inline), **Edit automatically**.
  **Shift+Tab** cycles.
- Edits as a side-by-side diff with **Accept this change** / **Reject this change** per hunk
  (since 2.1.275), or the whole file.
- **Checkpoints** before every prompt; `/rewind` or **Esc Esc**: restore code and
  conversation, conversation only, code only, summarize from here, summarize up to here.
  Bash changes and subagent edits are not tracked, and it says so.
- Messages typed while it works are **queued**; **Ctrl+Enter** sends them into the running
  turn; **Esc** interrupts and keeps the work done.
- `/resume`, `/branch`, `/fork`, `/rename`, `/export`, sessions in groups, filterable.
- `CLAUDE.md` memory, `/init`, `/memory`, auto memory; skills as `SKILL.md` with
  `$ARGUMENTS`; subagents; hooks; plugins; MCP via `/mcp`.
- `/usage` with plan limits and what counts against them; `/cost` and `/stats` its aliases.
- `/goal`: a condition checked after every turn by a small fast model - not yet met, met,
  impossible - with turns, time and tokens on the indicator.
- `/btw`: a side question in a panel beside the chat, never added to the conversation.
- **Focus view** (**Ctrl+Alt+F**) hides tool calls and thinking behind rows.
- Thinking as collapsed blocks, **Ctrl+O** expands all. Voice dictation (`/voice`).
- Done badly: a hundred commands in one flat menu, many of them about the terminal itself;
  `/fork` and `/branch` and `/subtask` are three words for three nearby things.

**claude.ai and Claude Desktop.** Projects with their own instructions and files; a model
picker with extended thinking; artifacts beside the chat; research mode with citations;
connectors (MCP) per conversation; edit a sent message to branch, with arrows between the
branches; retry; search over chats; voice.

**Codex CLI, IDE extension and app-server** ([slash commands][cx-commands],
[non-interactive][cx-exec], [app-server][cx-app-server], [IDE][cx-ide], [goal][cx-goal]).

- `/model` picks the model **and** the reasoning effort (`none` to `xhigh` as the model
  lists them); `/fast` the service tier; `/personality` the voice.
- The footer shows the context left; auto-compaction at `model_auto_compact_token_limit`.
- `/mention` attaches a file; `@` searches files; images by paste or `-i`.
- `/plan` mode; `/permissions` (read-only, auto, full access); `/approve` retries a denied
  call.
- `/goal` with a **token budget**: pursuing, paused, achieved, unmet, budget-limited; the
  model gets goal tools of its own.
- `/side` (alias `/btw`), `/fork`, `/new`, `/resume`, `/rename`, `/archive`, `/delete`,
  `/compact`, `/copy`, `/diff`, `/review`, `/ps`, `/stop`, `/memories`, `/skills`.
- **Enter** queues while it works, **Tab** steers; **Esc Esc** edits the previous message.
- The app-server is a JSON-RPC protocol for hosts: `thread/start|resume|fork|compact`,
  `turn/start|steer|interrupt`, `model/list` with each model's supported efforts,
  `thread/tokenUsage/updated` with the model's context window, `thread/goal/set`,
  `review/start`, approval requests. Everything a sidebar needs, as a protocol.

**ChatGPT desktop.** A model picker with a reasoning level; work with apps (reads the
front window of an IDE or a terminal); voice; projects; memory; search over chats; edit and
branch a message; a quick companion window on a key.

**Cursor** ([agent][cursor-agent], [modes][cursor-modes], [mentions][cursor-mentions]).
Agent, Ask, Plan and custom modes on **Shift+Tab**; a model picker with Auto and Max; a
**context ring** whose tray breaks the window into system prompt, tools, rules, skills,
MCP, summarized and current conversation; `@` files, folders, terminals, past chats, git
diffs, the browser; checkpoints before significant changes, restore from any message;
queued messages that can be reordered, **Ctrl+Enter** to send now; `/side` and `/btw`;
`/goal`; diffs applied and then **Keep** / **Undo** per file and per hunk; `.cursor/rules`
and `AGENTS.md`; transcript search on **Ctrl+K**. Done badly, by its users' account: a
model list that changes under them, and "Auto" hiding which model answered.

**GitHub Copilot Chat** ([chat][copilot-chat], [checkpoints][copilot-checkpoints],
[cheat sheet][copilot-cheat]). Ask, Plan, Agent and custom agents; a model picker
(`/models`); `#file`, `#codebase`, `#selection`, terminal and tool references, implicit
active file; images; **Queue**, **Steer** or **Stop and Send** while a request runs, pending
messages reordered by drag; per-hunk **Keep** / **Undo**; checkpoints before each request
with **Redo** after a restore, and the honest line that a checkpoint does not undo terminal
commands or network requests; editing a request reverts its changes and everything after
and sends again; `/compact`, `/fork`, `/clear`, `/rename`, `/init`, `/explain`, `/fix`,
`/tests`, `/doc`; instructions files and prompt files; voice; find in conversation.

**Windsurf Cascade** ([Cascade][windsurf]). Code and Chat modes; a model selector under the
field; named checkpoints and revert to any step; up to forty tool calls a prompt and
**auto-continue** past that; queued messages (Enter adds, Enter again sends now); memories
and rules; workflows as slash commands; voice; several cascades at once; real-time awareness
of what the person does in the editor; lint errors fixed on its own.

**Zed's agent panel** ([agent panel][zed]). Threads with history and editable titles; a
model selector with favourites cycled by key; `@` files, directories, symbols, threads,
rules, fetch, diagnostics, selection; images; **edit any past message and resubmit**;
queueing and a **steer** toggle; a multibuffer of every change with per-hunk accept and
reject; **restore checkpoint**; **follow the agent** through the files it edits; token
usage; automatic compaction and **New From Summary**; profiles (Write, Ask, Minimal) that
choose the tools; external agents (Claude Code, Codex) in the same panel through ACP;
desktop notifications when a long turn ends.

**JetBrains AI Assistant** ([chat][jetbrains]). Chat and agent modes (its own agent and
third-party ones); a model selector with local models; files, symbols, images attached;
multi-file changes reviewed, accepted or discarded with rollback; chat history; the chat as
an editor tab when it needs room.

**Raycast AI** ([AI][raycast]). Quick AI on a key, answered in place; AI Commands (a prompt
on a shortcut); custom agents with their own instructions and model; projects with memory;
screen awareness; extensions as tools; every major provider, own keys, Ollama.

**Notion AI** ([FAQ][notion]). Notion Agent edits pages with **accept, discard or ask for
changes** before applying; `@` pages, people and dates; sources from the workspace,
connected apps and the web; research mode; a model picker; instructions and skills;
attachments; chats in the sidebar; **Ctrl+Shift+J**.

**Obsidian Copilot and Smart Connections** ([Copilot][obsidian-copilot],
[Smart Chat][smart-chat]). Copilot now runs opencode, Claude Code or Codex as its agent and
reads the vault through them; Quick Chat, Quick Ask on a selection, custom commands as
notes, projects with their own instructions and history, relevant notes beside the editor,
`[[note]]`, folder and URL mentions, model and effort choice. Smart Connections keeps
threads with the notes they came from and builds context from an embedding index. What
their readers complain about is the index (`docs/ai.md`, "No index").

### 2.2 By axis

| | Claude Code | Codex | Cursor | Copilot | Zed | Windsurf | ChatGPT / claude.ai | Notion / Obsidian |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| model picker | ✓ | ✓ | ✓ | ✓ | ✓ favourites | ✓ | ✓ | ✓ |
| effort on the same popover | ✓ | ✓ | ~ thinking | ~ | ~ | ~ | ✓ | ~ |
| context meter | ✓ + cache clock | ✓ % left | ✓ ring + tray | ~ | ✓ tokens | - | - | - |
| auto-compact | ✓ settable | ✓ settable | ✓ | ✓ `/compact` | ✓ + New From Summary | - | ~ | - |
| @-mentions | files, folders, lines, terminal, browser | files | files, folders, terminals, chats, git, browser | #file, #codebase, #selection, tools | files, dirs, symbols, threads, rules, fetch, diagnostics | past chats | files | pages, people, notes, folders, URLs |
| implicit open file + selection | ✓ with X | ~ | ✓ | ✓ | - | ✓ | ~ (apps) | ✓ |
| images | paste | paste, `-i` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| modes | Manual, Auto, Plan, Edit | Plan, permissions | Agent, Ask, Plan, custom | Ask, Plan, Agent, custom | profiles | Code, Chat | - | Agent |
| tool calls inline | rows, Focus view | rows | rows | rows | rows | rows | - | ~ |
| per-hunk accept/reject | ✓ | ~ `/diff` | ✓ Keep/Undo | ✓ Keep/Undo | ✓ multibuffer | ~ | - | ✓ page review |
| checkpoints | ✓ every prompt | - | ✓ | ✓ + Redo | ✓ | ✓ named | - | - |
| queue / steer | ✓ / Ctrl+Enter | Enter / Tab | ✓ reorder / Ctrl+Enter | Queue, Steer, Stop and Send | ✓ / toggle | ✓ | - | - |
| edit and resend | via rewind | Esc Esc | ✓ | ✓ reverts after | ✓ | - | ✓ branches | - |
| history, search | ✓ groups, filter | ✓ | ✓ Ctrl+K | ✓ Ctrl+F | ✓ | ✓ | ✓ | ✓ |
| branch / fork | `/branch`, `/fork` | `/fork` | - | `/fork` | - | - | edit = branch | - |
| rules / memory | CLAUDE.md, auto memory | AGENTS.md, memories | rules, AGENTS.md | instructions | rules library | memories, rules | memory, projects | instructions, projects |
| custom commands | skills | skills, prompts | commands | prompt files | - | workflows | GPTs, projects | commands as notes |
| MCP | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | connectors | ~ |
| cost / usage | `/usage`, plan limits | `/usage` | ~ | ~ | tokens | credits | - | credits |
| keyboard flow | everything | everything | most | most | most | some | some | some |
| voice | ✓ | - | - | ✓ | - | ✓ | ✓ | - |

### 2.3 What nib takes, and what it leaves

- **Model and effort on one popover with the level on the chip** (Claude Code, Codex). One
  click to see both, one key to change either.
- **The context ring and its tray** (Cursor), from real counts (Claude Code, Codex,
  Zed), plus the line nobody else draws: what the next send is about to add.
- **Apply, then Keep or Undo per change** (Cursor, Copilot, Zed) rather than a modal per
  edit (Claude Code's Manual mode), because nib's agent edits are already live, isolated and
  undoable one agent at a time (`docs/agent-native.md` 8.5). Asking first stays available as
  a permission, for the reader who wants it.
- **Checkpoints at every message, with Redo** (Claude Code, Copilot), and Copilot's honest
  sentence about what a checkpoint cannot take back.
- **Queue, steer, stop** (Copilot's three verbs, Claude Code's keys).
- **Edit any message and send again**, which reverts what came after (Copilot, Zed).
- **The vendors' command names** (Claude Code first, Codex where it differs), and generic
  behaviour behind them, so `/goal` is Claude's `/goal` and Codex's `/goal` at once.
- **Instructions as a file the reader owns** (`AGENTS.md`, `CLAUDE.md`), never a hidden
  memory store: a remembered fact is an edit to that note you can read.
- **Custom commands and agents as notes** (Obsidian Copilot, Raycast), found by their front
  matter, so they sync, version and open in Obsidian as text.
- **Follow the agent** (Zed) through the notes it edits, off by default.
- Left behind: a model "Auto" that hides which model answered (Cursor); commands about a
  terminal's own rendering; an index built before the first question (Obsidian); a cloud
  runner (nib never runs a model on its server; `docs/ai.md`).

---

## 3. Slash commands

`/` at the start of the field opens the menu; typing filters by name, synonym and words of
the description, with the first match lit (Claude Code's rules: `/adddir` finds `/add-dir`,
`/reset` finds `/new`). **Enter** runs the lit row, **Tab** completes it. A command not
available for the thread's provider is listed dimmed with the reason on hover rather than
missing, so the menu is the same everywhere. `?` on an empty field lists the keys.

Arguments follow the name. Commands that change the session (`/model`, `/effort`, `/fast`,
`/permissions`) apply to the next request at once, even mid-turn; the rest queue behind the
running turn, as Claude Code queues them.

How to read the provider columns: **CC** is Claude Code, **Cx** Codex, **API** the four
keyed or plan providers nib runs itself (Claude and OpenAI keys, the ChatGPT plan,
OpenAI-compatible). "nib" means nib does it the same way for every provider; anything else
names the provider's own road.

### 3.1 Conversation

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/new [name]` | `/clear`, `/reset` | CC `/clear` (`/reset`, `/new`), Cx `/new`, `/clear`, Copilot | a new thread; the old one stays in history, named if a name was given | the session process ends, a new one starts | `thread/start` | new transcript |
| `/resume [name]` | `/continue`, `/history` | CC, Cx | the thread list, filtered by what follows | a new process seeded from nib's transcript (nib runs CC with no session of its own on disk) | `thread/resume` while the app-server runs, else seeded | the transcript |
| `/rename [name]` | `/title` | CC, Cx | names the thread (Codex's `/title` names its terminal; here it is the thread's name); no name asks `/recap` for one | nib | nib | nib |
| `/recap` | - | CC | one line about the thread, which is also the automatic title | one-shot ask | one-shot ask | `complete()` |
| `/branch [name]` | - | CC | a copy of the thread up to here, and you are in it | new process, seeded | `thread/fork` | copy |
| `/fork [prompt]` | - | CC, Cx, Copilot | a copy that runs in the background while you stay; with a prompt it starts on it | new process, seeded | `thread/fork` | copy |
| `/rewind` | `/undo`, `/checkpoint` | CC | pick a message: restore notes and conversation, conversation only, notes only, summarize from here, summarize up to here (4.5) | nib's checkpoints (CC's own see no nib edit: they go through MCP) | nib | nib |
| `/compact [focus]` | - | CC, Cx, Copilot, Zed | the older turns become a summary; the focus steers it | `/compact` into the live session | `thread/compact/start` | Claude key: server compaction where the model lists `compact`; OpenAI key: `/responses/compact`; ChatGPT plan and compatible: nib's own summary turn |
| `/autocompact [auto\|<tokens>\|off]` | - | CC | when compaction happens on its own; shown on the ring as a tick | `--autocompact` at the next process start | `model_auto_compact_token_limit` | nib's threshold |
| `/context [all]` | - | CC | the ring's tray as a message: system, instructions, tools, attached, conversation, free | `modelUsage` of the last result | `thread/tokenUsage/updated` | the response's `usage` |
| `/btw [question]` | `/side` | CC `/btw`, Cx `/side` (`/btw`), Cursor | the Quick question sheet, with this thread as its context; nothing is added here (`docs/ai.md`, "A quick question") | one-shot ask | one-shot ask | `complete()` |
| `/copy [n]` | - | CC, Cx | the nth latest answer, citations as wikilinks | nib | nib | nib |
| `/export [note]` | `/save` | CC | the thread as a note in the space (or the clipboard with no name) | nib | nib | nib |
| `/archive` | - | Cx | out of the list, kept | nib | nib | nib |
| `/delete` | - | Cx | gone for good; asks | nib | nib | nib |
| `/stop` | - | CC, Cx | the turn and the thread's background work stop (**Esc** stops the turn) | interrupt | `turn/interrupt` | abort |
| `/tasks` | `/ps`, `/bashes` | CC `/tasks` (`/bashes`), Cx `/ps` | the thread's background work: a goal, loops, subtasks, agent tabs, terminal commands | nib | nib | nib |
| `/focus` | - | CC | tool rows and thinking fold away; prompts and answers stay | nib | nib | nib |
| `/help` | - | everyone | the commands and keys | nib | nib | nib |

### 3.2 Model

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/model [name]` | `/models` | CC, Cx, Copilot `/models` | the model popover; a name sets it for this thread, **Alt+P** opens it | `/model <name>` into the session (works headless) | `model` on the next `turn/start` | `model` on the next request |
| `/effort [level\|auto]` | `/reasoning`, `/think` | CC `/effort`; Cx sets it in `/model`; thinking toggles | Auto, Off, Minimal, Low, Medium, High, Extra, Max - only the levels the model has (5.1); **Alt+T** steps through them | `/effort <level>` into the session | `effort` on the next `turn/start` | Claude: `output_config.effort` (a per-message effort where the model has it, so the cache survives); OpenAI and ChatGPT: `reasoning.effort`; compatible: `reasoning_effort` where the model takes it |
| `/fast [on\|off]` | - | CC, Cx | the provider's faster tier, where it has one | dimmed: Claude Code has no `/fast` headless (6.4) | service tier `fast` | Claude key: fast mode where the model lists it; OpenAI key: `service_tier: "priority"`; plan and compatible: dimmed |
| `/output-style [style]` | `/personality`, `/style` | CC `/output-style`, Cx `/personality` | how answers read: Default, Concise, Explanatory, Teaching, plus any note with `output-style:` front matter | a fixed style line the crate appends (never text from the page) | `personality` where the model has it, else the same line | a system line |

### 3.3 Modes and long work

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/ask [question]` | - | Cursor Ask | Ask mode: read and search tools only, answers cite their passages (today's Ask panel) | read-only tools listed | read-only tools listed | read-only tools |
| `/plan [task]` | - | CC, Cx, Cursor, Copilot | Plan mode: read-only tools; the plan is written as a draft note with a task per step, which you edit; **Build** runs it in Agent mode | read-only tools listed | Cx plan mode, read-only tools | read-only tools |
| `/agent [task]` | - | Cursor Agent, Copilot Agent | Agent mode: every tool the grant reaches | full grant | full grant | full grant |
| `/agents [name]` | `/subagents` | CC `/agents`, Cx `/agent` (`/subagents`) | the thread's agent profile: a note with `agent:` front matter gives instructions, a model, an effort and tools; none is the default | profile's instructions as the fixed style slot + model + effort | the same, by `thread/start` | system message + model + effort |
| `/permissions` | `/approvals`, `/allowed-tools`, `/approve` | CC (`/allowed-tools`), Cx `/permissions`, `/approve` | the sidebar agent's grant for this thread (4.4): scopes, sites, **Ask before edits** or **Apply and review**; `/approve` retries the last refused call | nib's grant | nib's grant | nib's grant |
| `/goal [condition\|pause\|resume\|clear]` | `clear`: `stop`, `off`, `reset`, `none`, `cancel` | CC, Cx, Cursor | keeps working until the condition holds, an evaluator says it cannot, or the budget is spent (4.8) | CC's own `/goal` in the session | `thread/goal/set\|get\|clear` | nib's evaluator loop |
| `/loop [interval] [prompt]` | `/proactive` | CC | runs a prompt on an interval while nib is open; the interval left out, the model paces it | nib | nib | nib |
| `/subtask <task>` | - | CC | a helper thread in the background whose answer comes back here | nib | nib | nib |
| `/bg [prompt]` | `/background` | CC | sends, leaves the thread running in the background, and opens a new one | nib | nib | nib |
| `/batch <instruction>` | - | CC | one instruction fanned out over many notes (a folder, a tag, a search), each a subtask; one review of every change | nib | nib | nib |
| `/deep-research <question>` | `/research` | CC `/deep-research`, Notion research | agent tabs search and read in the background; a cited report lands as a note (needs the browser scope) | nib's browser verbs | nib's browser verbs | nib's browser verbs |

### 3.4 Context and instructions

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/mention <thing>` | `/add`, `/attach` | Cx `/mention` | attaches what `@` would (4.2) | nib | nib | nib |
| `/add-space <space>` | `/add-dir` | CC `/add-dir` | widens this thread to another space, if the grant reaches it | nib | nib | nib |
| `/memory` | `/memories`, `/instructions`, `/rules` | CC `/memory`, Cx `/memories`, Copilot `/instructions` | opens the space's `AGENTS.md` and the personal instructions; "remember" on or off (4.6) | nib | nib | nib |
| `/init` | - | CC, Cx, Copilot | writes the space's `AGENTS.md` from its folders, tags, templates and habits, as a new note you review | nib | nib | nib |
| `/skills [name]` | `/commands`, `/prompts` | CC `/skills`, Cx `/skills`, Copilot `/prompts` | the custom commands: notes with `command:` front matter (4.7) | nib | nib | nib |
| `/mcp` | `/tools` | CC `/mcp`, Cx `/mcp`, Copilot `/tools` | the tools this thread can use, by scope, each switchable off for the thread | nib's verbs | nib's verbs | nib's verbs |

### 3.5 On words

nib's own verbs, from the rewrite menu (`docs/ai.md`, "Rewriting a selection") and
Copilot's `/explain` and `/fix`. On the selection, else the note in front; the answer is a
reviewable diff, not a reply.

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/shorter` | - | nib | the same in fewer words | nib | nib | nib |
| `/longer` | - | nib | more about the same | nib | nib | nib |
| `/fix` | `/grammar` | nib, Copilot `/fix` | spelling, grammar, punctuation, nothing else | nib | nib | nib |
| `/translate [language]` | - | nib | into the interface's language or the one named | nib | nib | nib |
| `/explain` | - | Copilot | what the selection means, as a reply | nib | nib | nib |
| `/summarize [note]` | - | nib | a summary under the note's first heading, as a change to keep | nib | nib | nib |
| `/review [note\|changes]` | `/code-review` | CC `/review` (`/code-review`), Cx `/review` | comments on a note (clarity, claims, structure) as changes to keep or undo; `changes` reviews what this thread did | nib | `review/start` with a custom target | nib |
| `/diff` | `/changes` | CC, Cx | every note this thread changed, with Keep and Undo (4.5) | nib | nib | nib |

### 3.6 Account and app

| nib | synonyms | from | what it does in nib | CC | Cx | API |
| --- | --- | --- | --- | --- | --- | --- |
| `/status` | - | CC, Cx | provider, model, effort, account and plan, grant, program version | `claude auth status --json` | `codex login status` | Settings > AI's row |
| `/usage` | `/cost`, `/stats`, `/rate-limit-options` | CC `/usage` (`/cost`, `/stats`), Cx `/usage` | tokens in this thread and today; a plan's state and reset time; money only where the provider says it | `total_cost_usd`, `rate_limit_event` | rate limits from the app-server | `usage`; OpenRouter's `cost` |
| `/login` | - | CC | the provider's own sign-in road (`docs/ai.md`, "Your own plan") | `claude auth login` in a terminal tab | `codex login` in a terminal tab | ChatGPT: Continue with ChatGPT; keys: Settings > AI |
| `/logout` | - | CC, Cx | sign out of it | `claude auth logout` in a terminal tab | `codex logout` in a terminal tab | ChatGPT: Sign out |
| `/doctor` | `/checkup`, `/debug-config` | CC `/doctor` (`/checkup`), Cx `/debug-config` | where the program is, its version and flags, sign-in, whether the model list answers | nib | nib | nib |
| `/config` | `/settings` | CC | Settings > AI | nib | nib | nib |
| `/keybindings` | `/keymap` | CC, Cx | Settings > Keyboard, filtered to the panel | nib | nib | nib |
| `/theme` | - | CC, Cx | nib's theme picker | nib | nib | nib |
| `/vim` | - | Cx (CC took its out) | vim keys in the field, using nib's vim mode | nib | nib | nib |
| `/voice [on\|off]` | - | CC | dictation into the field through the transcription road (`docs/ai.md`, "Sound, as words") | nib | nib | nib |

That is **58 commands** and **42 synonyms**. A custom command (4.7) is one more row, and a
custom command with a vendor's name wins over nothing but itself: built-ins keep their
names.

### 3.7 Not in nib

Every other command Claude Code and Codex have, and why it has no row.

| command | from | why not |
| --- | --- | --- |
| `/advisor` | CC | a second model consulted mid-task is Anthropic's server tool; `/goal`'s evaluator and `/subtask` are nib's second opinion |
| `/artifacts`, `/artifact-capabilities`, `/artifact-diagramming`, `/design`, `/design-login`, `/design-sync`, `/slides`, `/dataviz` | CC | claude.ai's published pages; nib's output is notes, canvases and decks of its own |
| `/auto-mode-setup`, `/fewer-permission-prompts`, `/sandbox`, `/setup-default-sandbox`, `/sandbox-add-read-dir` | CC, Cx | tune a shell's permissions; the sidebar has no shell of the reader's, and its asks are nib's policy |
| `/autofix-pr`, `/install-github-app`, `/install-slack-app`, `/web-setup`, `/security-review`, `/simplify`, `/ultrareview`, `/run`, `/verify`, `/run-skill-generator`, `/claude-api` | CC | about a code repository; a space is not one |
| `/bug`, `/share`, `/feedback` | CC, Cx | report to the vendor through the vendor's app; nib sends nothing anywhere |
| `/chrome`, `/claude-in-chrome`, `/ide` | CC, Cx | nib is the browser and the editor; `@tab` and the browser scope are this |
| `/color`, `/statusline`, `/tui`, `/raw`, `/scroll-speed`, `/terminal-setup` | CC, Cx | a terminal's own rendering |
| `/desktop`, `/app`, `/mobile`, `/ios`, `/android`, `/remote-control`, `/rc`, `/teleport`, `/tp`, `/remote-env`, `/cd` | CC, Cx | move a session between the vendor's surfaces; a thread lives in its space |
| `/exit`, `/quit` | CC, Cx | Escape puts the panel away |
| `/heapdump`, `/debug`, `/insights`, `/skill-doctor`, `/team-onboarding`, `/powerup`, `/release-notes` | CC | about the CLI itself |
| `/hooks`, `/plugin`, `/plugins`, `/reload-plugins`, `/plugin-authoring`, `/update-config`, `/experimental`, `/apps` | CC, Cx | extend the vendor's program; the sidebar's extensions are notes (4.7) |
| `/reload-skills` | CC | commands are found as notes change; there is nothing to reload |
| `/import` | CC, Cx | imports another vendor's config files; nib never reads `~/.claude` or `~/.codex` (`docs/ai.md`) |
| `/list-agents`, `/peers` | CC | other CLI sessions; the Activity panel is nib's list of agents |
| `/schedule`, `/routines`, `/workflows`, `/workflow-authoring` | CC | cloud runners; `/loop` is the part that runs while nib is open |
| `/passes`, `/stickers`, `/radio`, `/upgrade`, `/usage-credits`, `/privacy-settings`, `/pets`, `/pet` | CC, Cx | the vendor's shop and account pages; **Manage usage** on the provider's row goes there |
| `/setup-bedrock`, `/setup-vertex` | CC | cloud providers of Claude Code's; a compatible provider is nib's road to a gateway |
| `/pr-comments`, `/ultraplan` | CC | removed by Anthropic (Claude Code also removed `/vim`; nib keeps Codex's) |

---

## 4. The design

### 4.1 Where it lives

**It replaces the Ask panel**, in the right side's last tab, on **Ctrl+Shift+A**, which puts
the keyboard in its field. Two panels that both talk to a model, one able to act and one not,
is one panel with a mode. Ask's behaviour - retrieval with no index, numbered citations,
the note in front as a chip - is Ask mode, unchanged, and still the mode a new thread starts
in until the reader picks another (the last one picked is remembered).

- **Properties stays its own tab**: front matter is not a conversation.
- **The Activity panel stays its own tab**: it is about agents from outside (Claude Desktop,
  a script). The sidebar's agent appears there too, because it is a grant like theirs, so
  the one stop and the one log still cover everything.
- **The quick question stays** on **Ctrl Ctrl**, as `/btw` here. A quick thread gets one more
  glyph, **Continue in the panel**, which moves it into a new thread (Raycast's and Arc's
  way from a quick answer to a conversation).
- **Wider when it needs to be.** The right side's width is dragged as today; **Open as a
  tab** on the thread's menu puts the same thread in a pane (JetBrains, Claude Code's
  editor tab), for a long session beside two notes.
- Fetched the first time it opens, like the Ask panel is (`apps/desktop/src/lib/surfaces.svelte.ts`):
  none of it is in the first paint, held by `apps/desktop/test/weight.test.ts`.

```
 right side, 360 px, Agent mode, a turn running
┌──────────────────────────────────────┐
│ Reading list cleanup ▾        ⌕   ✎  │  title (menu: rename, branch, export, open as tab) · search threads · new
├──────────────────────────────────────┤
│                                      │
│  file the open tabs about herons     │  your message (hover: edit · rewind · copy)
│  under Reading/Birds                 │
│                                      │
│  ▸ Thought for 6 s                   │  folded; Ctrl+O unfolds every one
│  ▸ Read 4 tabs                       │  tool rows: verb, object, nothing else
│  ▸ Created Reading/Birds/Herons.md   │
│  ▸ Edited Reading/Birds.md  +3 −0    │  click: the change, in the note
│                                      │
│  Filed four pages. Two were the same │  the answer, streaming
│  article; I kept the one with the    │
│  pictures.¹ ▍                        │  citations stay ¹ ² ³
│                                      │
├──────────────────────────────────────┤
│ ◐ 2 notes  +31 −0      Undo  Keep    │  changes bar: click opens /diff
├──────────────────────────────────────┤
│ ↳ and tag them #birds         ✕  ⋮⋮  │  queued (Enter queues while running; drag to reorder)
├──────────────────────────────────────┤
│ [Herons.md ✕] [selection 3 lines ✕]  │  context chips: implicit ones dim until used
│ Ask anything, @ to add, / for more ▍ │  the one placeholder line
│                                      │
│ Agent ▾   Opus 5.5 · High ▾   ◔  🎙 ■ │  mode · model and effort · ring · voice · stop/send
└──────────────────────────────────────┘
```

```
 the model popover (Alt+P), a Claude key
┌──────────────────────────────────────────┐
│ ⌕ model                                  │
│ ● Claude Opus 5.5                    1M  │  context window from the provider's list
│   Claude Sonnet 5.5                  1M  │
│   Claude Haiku 4.5                 200K  │
│ ──────────────────────────────────────── │
│ Effort  Auto Low Med [High] Extra Max    │  only the model's levels
│ Fast    ○                                │  only where the provider has it
└──────────────────────────────────────────┘
```

```
 the ring's tray (click the ring, or /context)
┌──────────────────────────────────┐
│ 412K of 1M          compacts at 967K │
│ ███▒▒░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ ■ instructions          3.1K     │
│ ■ tools                 9.8K     │
│ ■ attached             41.0K     │
│ ■ conversation        358.2K     │
│ ■ next send          ≈ 2.4K     │  the draft and its chips, estimated
│ Compact now                      │
└──────────────────────────────────┘
```

### 4.2 Context: what can be attached

Implicit, as the Ask panel and Claude Code do it: **the note in front** and **its selection**
are chips over the field, dim until the next send would take them, with an X that drops
them for the thread. Everything else is attached by hand, with **@**, `/mention`, a drop, or
a paste. Every chip shows what it is by its shape (the tree's own icons) and its size on
hover.

| `@` | what goes | through |
| --- | --- | --- |
| `@Note` | the note as on screen, unsaved words included; `@Note#Heading`, `@Note#^block`, `@Note:12-30` for a part | `read_note` (`apps/desktop/src/lib/agents/docs/read.ts`) |
| `@folder/` | the list of its notes, and each note's text only if the model asks for it | `list_notes`, then `read_note` |
| `@#tag` | the notes with that tag, the same way | the link index (`apps/desktop/src/lib/link-index.svelte.ts`) |
| `@space` | another space, by name, if the grant reaches it (`/add-space`) | `list_spaces` |
| `@selection` | the selection where it is now; **Alt+K** inserts it as `@Note:12-14` (Claude Code's key) | `get_context` |
| `@tab` | a web tab's article, as the clip button reads it; `@tab:shot` its picture | `browser_read`, `browser_screenshot` |
| `@page` | the web tab in front, the same way | the same |
| `@paper.pdf` | a PDF's text, `@paper.pdf:3-5` pages | `read_pdf` (`apps/desktop/src-tauri/src/papers.rs`) |
| `@canvas` | a canvas or a page note as JSON Canvas | `read_canvas` |
| `@terminal` | a terminal tab's last command and its output, `@terminal:all` its scrollback | the terminal tab (`apps/desktop/src/lib/terminal/TerminalTab.svelte`) |
| `@scratchpad` | the scratchpad note | `apps/desktop/src/lib/scratchpad/pad.ts` |
| `@thread` | another thread, as its summary | the thread store |
| `@web` | the provider's own web search for this message | Claude: the web search tool; OpenAI and ChatGPT: `web_search`; CC and Cx: their own, turned on for this message only; compatible: dimmed |
| a file or picture | dropped or pasted: pictures go as images to a model that takes them, other files as text where they are text | the provider's image input |

Nothing in the space is sent unless a chip says so or the model asked a tool for it in a
mode that has tools, and a tool call is a row in the thread. That is the line `docs/ai.md`
draws for `@note` and it holds here.

### 4.3 What a turn looks like

- **Words stream** as every provider streams them (Codex's app-server streams too, so the
  exec-mode "a message at a time" goes away).
- **Thinking** is a folded row, "Thought for 6 s", which unfolds to the summary the provider
  gives (Claude's thinking blocks, OpenAI's `reasoning.summary: "auto"`, CC's
  `thinking_delta`, Cx's reasoning items). Never a spinner of fake words.
- **Tool calls** are rows of one verb and one object - Read, Searched, Opened, Clicked,
  Edited, Created, Ran - with the note's or page's name, and for an edit its +/− count. A
  row opens to its arguments and result; an edit row opens the change in the note.
  `needs_approval` is a row with **Allow** and **Don't allow**, the activity panel's
  question in place.
- **Follow** (off by default, the eye on the thread menu, Zed's word): the note being
  edited comes to the front as it is edited. Off, the note's tab wears the agent's mark and
  its caret is in it, as `docs/agent-native.md` 8.4 already draws.
- **Errors** are the provider's words, on one line, with **Retry** and, where a plan is at
  its limit, when it resets (`docs/ai.md`, "Honest about whose plan it is").
- **The end of a long turn** is a system notification when the window is not in front, like
  Zed's.

### 4.4 Tools: nib's verbs, under a grant

The sidebar's agent is an agent like any other (`docs/agent-native.md` 9.1): a **built-in
grant per provider**, named after it ("nib · Claude Code"), listed in Settings > Agents with
the same scopes, sites, asks and limits, and the same stop. Its default is Emil's default for
agents (all but `browser.script`, `browser.storage`, `settings`, `terminal`), with
`browser.reader` on, because the reader is right there, and `terminal` on with no program on
its list: "why did the build fail" is a question about the reader's terminal, so it reads one
(`read_terminal`, under `context`, in every mode) and every command it would run or type into
one asks first (`ai_agent.rs` `made`; `docs/agent-native.md` 8.9).

The modes are views of that grant, never more than it:

| mode | tools listed |
| --- | --- |
| Ask | the read-only ones (`readOnlyHint` in `apps/desktop/src-tauri/src/mcp/tools.json`), plus nib's retrieval for citations |
| Plan | the read-only ones, plus `create_note` for the plan itself |
| Agent | everything the grant reaches |

**Ask before edits** (the permission chip's other half, Claude Code's Manual mode) makes
every write answer `needs_approval` with the change attached, so it is a question with a
diff rather than an edit to undo. **Apply and review** (the default) lets writes land and
puts them on the changes bar (4.5).

Two roads to the same tools:

- **Keys and the ChatGPT plan: nib runs the loop.** The tool definitions are the MCP list
  the grant reaches, sent as the provider's function tools (Anthropic `tools`, OpenAI
  function tools; for the ChatGPT plan in a namespace, as its preview requires [siwc-limits]).
  Each call goes to the crate with the built-in agent's identity and is answered exactly as
  an external agent's is: the policy, the asks, the log, `<untrusted>` marks. No second
  policy path in the window. A compatible server that refuses tools leaves the thread in
  Ask mode and the mode chip says so by being greyed.
- **Claude Code and Codex: they run the loop, and nib is their only tool.** Claude Code gets
  `--mcp-config` naming `nib mcp` alone (with the built-in agent's token), still
  `--tools ""` and `--strict-mcp-config`, so none of its own file, shell or web tools and
  none of the reader's MCP servers; Codex gets `mcp_servers` with `nib` alone, its shell
  tool off, read-only sandbox. This is the road `docs/ai.md` already promises: "One that
  ever does gets nib's own MCP server (`nib mcp`) with the grant Settings > Agents gives
  it, never a folder." The crate still writes every argument (`apps/desktop/src-tauri/src/ai_cli/args.rs`).

`@web` is the one tool that is the provider's rather than nib's, turned on per message.

### 4.5 Changes: review, keep, undo, rewind

nib's agent edits are already live transactions with the agent's caret, each its own undo
step, undoable per agent mapped through the reader's later typing
(`apps/desktop/src/lib/agents/docs/track.ts`, `docs/agent-native.md` 8.2 to 8.5). The
sidebar adds a review layer on top, and nothing underneath changes.

- **The changes bar** over the field: how many notes, +/−, **Undo** and **Keep**. Click it,
  or `/diff`, for the list: each note with its changes, each change with **Keep** and
  **Undo**, **J**/**K** to walk them.
- **In the note**, each change the thread made and the reader has not kept wears a mark in
  the gutter and a tint on its words (the version history's colours), with **Keep** and
  **Undo** on hover. A note leaves the list when every change is kept or undone; a note the
  reader closes keeps its marks for when it opens.
- **Undo a change** is that change's inverse, mapped through everything since, so the
  reader's words and the agent's later edits elsewhere in the note stay. Undo of a change a
  later agent edit depends on undoes both, and says "and 1 after it".
- **Keep** only clears the marks. The edit was already in the note; keeping is the reader
  saying they have read it.
- **Checkpoints**: each message the reader sends records, for every note the thread has
  touched, the agent's step count and the note's `rev`. **Rewind** to a message (**Esc Esc**
  on an empty field, `/rewind`, or the clock on a message's hover) offers Claude Code's five
  choices; restoring notes undoes the thread's steps after that point, mapped the same way.
  **Redo** is there until the next send (Copilot). A note created after the checkpoint goes
  to Recently deleted; a page clicked, a form filled or a command run is not undone, and the
  rewind sheet says so in one line (Copilot's honest sentence).
- **Edit a message** (the pencil on hover, or **Up** on an empty field for the last one):
  the thread rewinds to before it, notes and conversation, and the edited message is sent.
  The old branch stays reachable by the arrows under the message (claude.ai).
- The versions list already names the agent that wrote a version
  (`docs/agent-native.md` 8.5); the sidebar's agent is named there like any other.

### 4.6 Instructions and memory

- **The space's instructions** are its `AGENTS.md` at the space root, the file Codex,
  Cursor and Copilot read and Claude Code reads beside `CLAUDE.md`; a `CLAUDE.md` there is
  read too. They are notes, in the tree, synced and versioned like any other. A space
  made in nib starts with one of two lines (write in the notes' own language and style,
  ask before deleting, moving or renaming) and an empty `## Memory`; an import brings
  only what its folder had (`agents-seed.ts`). `/init` writes a fuller one; `/memory`
  opens it.
- **Personal instructions** are a field in Settings > AI, for every space.
- **Remembering is an edit.** "Remember that I file papers under Reading" (or the model's
  own `remember` when memory is on) appends a line under `## Memory` in `AGENTS.md` as a
  change on the changes bar. No hidden memory store, nothing on a server: what the agent
  knows about the reader is a note the reader can read and delete.
- Instructions count on the ring as their own band, so a long `AGENTS.md` is visible as the
  cost it is.

### 4.7 Custom commands and agents, as notes

A note whose front matter says `command: weekly` is `/weekly`. Its body is the prompt,
with `$ARGUMENTS`, `$1`, `$2` and the named `arguments:` (Claude Code's syntax), `@` chips
in it attached as if typed; `description:` is its line in the menu, and `model:`, `effort:`
and `mode:` override the thread's for that one send. A note whose front matter says
`agent: researcher` is a profile for `/agents`: its body is the instructions, and `model:`,
`effort:`, `mode:` and `tools:` its defaults.

Found through the front matter the link index already reads, so a command written on
another device is there when it syncs, opens in Obsidian as text, and has versions. No
special folder and nothing outside the space: nib never reads `~/.claude` or `~/.codex`.

### 4.8 /goal, for every provider

One goal per thread, with Claude Code's words and Codex's budget:

- `/goal all notes in Inbox are filed and tagged` sets it and starts a turn on it.
- After each turn an **evaluator** is asked - the same provider, its smallest listed model
  or the thread's at Low effort - with the condition and the turn's visible output, and
  answers `{verdict: met | not_yet | impossible, reason}`. `not_yet` starts the next turn
  with the reason as guidance; the other two end the goal with a line in the thread.
- **A budget**: turns, time and tokens, defaulting to 30 turns and the thread's next
  compaction; budget spent is Codex's `budget_limited`, a line and a stop.
- **No progress** (three turns with no tool call) pauses it, as Claude Code does.
- An error the reader has to fix (signed out, a plan at its limit, a model gone) clears it
  and says why; a retryable one retries three times.
- The chip over the field: ◎, the time it has run, its turns and tokens; click for the
  last reason; `/goal clear` or the chip's ✕ ends it.
- Claude Code and Codex run their own (`/goal` in the session, `thread/goal/set`) and nib
  reads their state into the same chip, so the reader cannot tell the roads apart.

### 4.9 Model and effort, per provider

What each provider can be asked, from its own catalogue or its own refusal, never from a
table in the source (`docs/ai.md`, "The model list is fetched, never written down").

| provider | the models | effort | thinking shown | context window |
| --- | --- | --- | --- | --- |
| Claude key | `GET /v1/models`: `display_name`, `max_input_tokens`, `capabilities.effort` (which of low to max), `capabilities.thinking`, `image_input` ([models][anthropic-models]) | `output_config.effort` ([effort][anthropic-effort]); mid-thread as a per-message effort where the model has it, so the cache is kept | summarized thinking blocks | `max_input_tokens` |
| OpenAI key | `GET /v1/models` (names only) | `reasoning.effort`, `none` to `max` ([reasoning][openai-reasoning]); a level the model refuses steps to the nearest and is remembered for that model | `reasoning.summary: "auto"` | not listed: learned from a refusal, or set on the chip once |
| ChatGPT plan | the plan's catalogue, `display_name` and `slug` ([models][siwc-models]) | `reasoning.effort`, the same way | the same | from the catalogue where it says, else as for a key |
| OpenAI-compatible | `<base>/v1/models`; OpenRouter's `context_length`, LM Studio's `max_context_length`, Ollama's `/api/show` | `reasoning_effort` (OpenRouter `reasoning.effort`, Ollama `think`) where the model advertises it; otherwise no effort row | `reasoning` fields where sent | where the server says; else unknown, and the ring shows a count without a circle |
| Claude Code | its aliases (`default`, `best`, `fable`, `opus`, `sonnet`, `haiku`, `opusplan`, `[1m]` forms) plus any name typed ([model config][cc-model]) | `--effort` at start, `/effort` in the session; a level it refuses is remembered for that model | `thinking_delta` | `modelUsage[model].contextWindow` on every result |
| Codex | `model/list` on the app-server: `supportedReasoningEfforts`, `defaultReasoningEffort`, `inputModalities` ([app-server][cx-app-server]) | `effort` on `turn/start` | reasoning items | `thread/tokenUsage/updated`, `modelContextWindow` |

**nib's one scale**: Auto (the model's default, sent as nothing), Off, Minimal, Low,
Medium, High, Extra (`xhigh`), Max. The row shows only what the model has, so Off is only
there for an OpenAI model that takes `none` and Max only where the model has `max`.
**Alt+T** steps up and wraps. The level a reader picks is remembered per model, as Claude
Code's `modelSettings` remembers it.

**Per thread, not global.** The model and effort are the thread's; a new thread starts on
Settings > AI > Used for's choice and the last effort used with that model. Switching model
mid-thread keeps the conversation and says, in a line between messages, which model answers
from there (and that the cache starts again where it does).

### 4.10 The context ring

- **After every answer**, the provider's own count: Claude's `usage` (input, cache read,
  cache creation, output), OpenAI's `usage` with `cached_tokens` and `reasoning_tokens`,
  CC's `modelUsage`, Cx's `thread/tokenUsage/updated`.
- **Before a send**, an estimate of the draft and its chips, marked ≈, made on this machine.
  Never `count_tokens`: that request would send the note before anybody pressed send, and
  `docs/ai.md` says no request happens that way.
- **The circle** fills to the window; a tick marks where compaction will happen; past 80 %
  the ring takes the warning colour, at the tick it compacts on its own (or, with
  `/autocompact off`, offers **Compact** in the bar). A model with no known window shows the
  count and no circle rather than a guess.
- **The tray** (click, or `/context`): the bands of 4.1's third drawing, each a click away
  from what it is (instructions open `AGENTS.md`, attached lists the chips).
- **Usage** on hover: this thread's tokens in and out, today's, and for a plan where it
  stands and when it resets; money only where the provider reports it.

### 4.11 Threads

- **Per space**, as the Ask panel's conversation is today; an answer arriving lands in the
  space it was asked in. Kept on this device, under the app's data folder by the crate
  (`localStorage` is too small for a history), never synced, never in a note unless
  exported; deleted with `/delete`, and all of a space's with the space.
- **The list** (⌕, or **Ctrl+Shift+A** twice): newest first, title, model mark, age; typing
  searches titles and words; **Enter** opens, **Delete** archives.
- **Several at once**: a thread keeps running when another is opened; the list marks the
  running ones, and the panel's tab wears a dot while one works out of sight.
- **Edit, branch, fork**: 4.5 and the commands in 3.1.
- **Retry with another model**: the retry glyph under an answer has a menu of the
  provider's models (ChatGPT's and Raycast's way of comparing).

### 4.12 Keys

Every key is a row of the keyboard registry (`apps/desktop/src/lib/shortcuts/registry.ts`),
so it can be changed and the palette lists it; the lane checks each against the registry
for clashes before taking it.

| key | where | does |
| --- | --- | --- |
| **Ctrl+Shift+A** | anywhere | the panel, and its field; again for the thread list |
| **Enter** / **Shift+Enter** | field | send (queue while running) / new line |
| **Ctrl+Enter** | field, running | send now: steer the running turn (Codex `turn/steer`, CC mid-turn input, nib's loop after the current tool) |
| **Esc** | field, running | stop; what arrived stays |
| **Esc Esc** | empty field | rewind |
| **Up** | empty field | edit the last message |
| **Shift+Tab** | field | Ask → Plan → Agent |
| **Alt+P** | field | model popover |
| **Alt+T** | field | next effort level |
| **Alt+K** | editor | the selection into the field as `@Note:12-14` |
| **Ctrl+O** | panel | unfold every thinking and tool row |
| **Ctrl+N** | field | new thread (only with the field focused; Ctrl+N elsewhere is a new note) |
| **J** / **K**, **Y** / **N** | changes list | next / previous change, keep / undo |
| `/`, `@`, `?` | start of field | commands, mentions, keys |

### 4.13 Motion and words

- The panel and the popovers move on the tokens every other panel uses (`--dur-*`,
  `--ease-out`, 100 to 190 ms). Words arrive without animation; a new row slides in 8 px;
  the ring's fill eases; a kept change's tint fades over 190 ms; an undone one is struck
  and collapses.
- The only sentence nib writes is the field's placeholder. Modes, models, effort, the ring
  and every row are a word or a glyph; errors are the provider's words. Every new string is
  in all forty catalogues in `apps/desktop/src/locales`.

---

## 5. Under the panel

### 5.1 The engine

One **thread engine** in the window, the same for every provider, behind one interface,
with three adapters behind it:

```
 ChatPanel ─► thread store ─► engine ─┬─ API adapter: Anthropic Messages, OpenAI Responses
   (lib/ai/sidebar)  (lib/ai/chat)    │     (keys and the ChatGPT plan), chat completions
                                      │     (compatible); nib's tool loop; tools via the crate
                                      ├─ Claude Code session: one long-lived `claude -p`
                                      │     per running thread, stream-json in and out
                                      └─ Codex session: one `codex app-server` per window,
                                            a thread per nib thread
```

`complete()` stays the one-shot seam every other surface uses (`apps/desktop/src/lib/ai/complete.ts`);
the engine is its conversational sibling and reuses its keys, its refusals and its stream
reader. Both keep to "nothing is sent that nobody pressed for", with three named exceptions
the reader starts and can stop: a running `/goal`, `/loop` and `/subtask`.

### 5.2 The two programs, kept to their rules

Every argument stays the crate's (`apps/desktop/src-tauri/src/ai_cli/args.rs`); the window
names a tool, a model, an effort, a mode and a thread, never a flag. What changes:

- **Claude Code** runs as a session: `-p --input-format stream-json --output-format
  stream-json --verbose --include-partial-messages`, `--effort` where the version has it,
  `--mcp-config` naming `nib mcp` alone, `--tools ""`, `--strict-mcp-config`, the mode's
  verbs in `--allowedTools` and the rest in `--disallowedTools`, `--permission-mode
  dontAsk`, `--permission-prompts none`, `--no-session-persistence`, `--restricted`, nib's
  system line per mode, and `CLAUDE_CODE_DISABLE_CLAUDE_MDS`. Not `--safe-mode`: measured
  on 2.1.280 it drops the `--mcp-config` server as well. Turns are written to stdin; a
  model change, a stop, the window's fill and the model list are the SDK's control
  requests (`set_model`, `interrupt`, `get_context_usage`, `list_models`), `/effort`,
  `/compact` and `/goal` are written as messages ([headless][cc-headless]); `/fast` is
  not, since Claude Code says "Fast mode is not available in the Agent SDK". A thread
  reopened after the program ended is seeded from nib's transcript. Unmodified, signed in
  by the reader, no token read: everything `docs/ai.md` requires stays true.
- **Codex** moves from `exec` to `app-server` over stdio: `initialize`, then
  `thread/start` with the read-only sandbox, `mcp_servers` holding `nib` alone, the shell
  tool off and the reader's config ignored; `turn/start` per message with `model` and
  `effort`; `turn/steer`, `turn/interrupt`, `thread/compact/start`, `thread/goal/*`,
  `thread/fork`, `model/list`, `serviceTier: "priority"` for Fast. Approval requests the
  app-server raises are refused (nib's own asks happen at nib's verbs). The app-server
  has no `--ignore-user-config`, so the reader's config is overridden key by key (`-c`).
- Both stay on the job object or process group, the empty folder of nib's own, and the
  stop, as today; a session idle for ten minutes is ended and reseeded on the next message.

### 5.3 What stays exactly as it is

The plan rules in `docs/ai.md`; the agent policy, asks, untrusted marks, log and stop in
`docs/agent-native.md`; `complete()` for the block, the rewrites and the
quick question; the Ask behaviour of retrieval with no index and citations; Settings > AI's
providers. The Ask panel's own drive (`apps/desktop/test/e2e/ask-panel.py`) keeps passing,
pointed at the new panel in Ask mode.

---

## 6. The implementation plan

Five lanes in two waves, on disjoint files. Each lane reads this document, `docs/ai.md` and
`docs/agent-native.md` first, follows the rules for every nib agent, and adds tests for its
logic. New files are named relative to `apps/desktop/src` (or `src-tauri/src`).

### 6.1 The interfaces the lanes meet at

Written first, by lane 1, in `lib/ai/chat/types.ts`, before any other lane builds on them;
the others code against a fake engine until lane 1 lands.

```ts
type Mode = 'ask' | 'plan' | 'agent'
type Effort = 'auto' | 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

interface ModelInfo { id: string; name: string; window: number | null
  efforts: Effort[]; images: boolean; fast: boolean }

interface Usage { input: number; cached: number; output: number; reasoning: number
  window: number | null; cost?: number }

type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; ms: number }
  | { kind: 'tool'; id: string; verb: string; args: unknown; state: 'running' | 'ok' | 'error' | 'asking'; result?: unknown; change?: { path: string; added: number; removed: number } }
  | { kind: 'notice'; text: string }

interface Thread { id: string; space: string; title: string; provider: string
  model: string; effort: Effort; mode: Mode; turns: Turn[]; goal?: Goal; usage: Usage }

interface Engine {
  models(provider: Provider): Promise<ModelInfo[]>
  send(thread: Thread, message: Draft, on: (event: EngineEvent) => void, signal: AbortSignal): Promise<void>
  steer(thread: Thread, text: string): Promise<void>
  compact(thread: Thread, focus?: string): Promise<void>
}
```

`EngineEvent` is `part` (a new or growing part), `usage`, `model` (which model answered),
`limit` (a plan's state) and `done`. The checkpoint (lane 3) is `{ turn, notes: { path, rev,
steps }[] }`, and the command registry (lane 5) is `{ name, synonyms, args, available(provider),
run(context) }`.

### 6.2 The lanes

| lane | owns | builds | tests | wave |
| --- | --- | --- | --- | --- |
| **1 `ai-chat-engine`** | `lib/ai/chat/` (new), additions to `apps/desktop/src/lib/ai/providers.ts` and `apps/desktop/src/lib/ai/stream.ts` | the types above; the thread store (crate-kept files per space, a `ai_threads` read/write pair in `src-tauri/src/ai_threads.rs`); the API adapter for Anthropic Messages, OpenAI Responses (keys and the ChatGPT plan: `store: false`, `stream: true`, tools in a namespace), chat completions; the tool loop calling the crate as the built-in agent; effort mapping and refusal learning; the model catalogue with capabilities and windows (4.9); usage and the ≈ estimate; compaction (server where offered, own summary otherwise) | unit tests against recorded provider streams and a fake crate: every adapter's text, thinking, tool and usage events, effort refused and stepped, compaction swaps, transcript round-trip; `complete.test.ts` and `seam.test.ts` untouched and green | 1 |
| **2 `ai-cli-sessions`** | `apps/desktop/src-tauri/src/ai_cli/` (new `session.rs`, `codex_app.rs`; `args.rs`), `apps/desktop/src-tauri/src/ai_cli.rs`, `apps/desktop/src/lib/ai/local/`, `scripts/fake-ai-cli.mjs` | the Claude Code session (stream-json in, `--effort`, `--mcp-config` with `nib mcp` alone and the built-in token, interrupt, idle end, reseed); Codex on the app-server (thread, turn, steer, interrupt, compact, goal, fork, `model/list`, token usage); both as `Engine` adapters; the fake CLI speaking both protocols | cargo tests over the fake through the real spawn, stream, stop and timeout; a test that no argument comes from the window but tool, model, effort, mode and thread; the args table test extended; `cargo test real_claude -- --ignored` read-only; a draft-PR CI before main | 1 |
| **3 `ai-review`** | `lib/ai/review/` (new), `review/` in the editor package (new), the sidebar agent's grant in `apps/desktop/src-tauri/src/agents/grants.rs` | the built-in grant per provider and its mode views (4.4), **Ask before edits** as `needs_approval` with the change; the changes list, per-change Keep and Undo mapped through later edits, the gutter marks and tints, checkpoints, rewind with its five choices and Redo, edit-and-resend; Follow | unit tests on `test-desk.ts`: undo of one change among the reader's typing and the agent's later edits, rewind across three notes, a created note to Recently deleted, a kept change leaving no mark; grant tests for each mode's tool list | 2 |
| **4 `ai-sidebar-ui`** | `lib/ai/sidebar/` (new), the Ask panel (replaced), `apps/desktop/src/lib/Sidebar.svelte` and `apps/desktop/src/lib/surfaces.svelte.ts` (the slot), keys in `apps/desktop/src/lib/shortcuts/registry.ts`, `apps/desktop/src/locales` | the panel of 4.1: thread header and list with search, messages with parts, folded thinking and tool rows, the changes bar (drawing lane 3's list), queue chips with reorder, the field with chips, `@` menu and `/` menu (drawing lane 5's registry), mode chip, model popover, ring and tray, voice; Continue in the panel from the quick question; Open as a tab; motion; all strings in every catalogue | component tests; a drive `test/e2e/ai-sidebar.py` against the fake provider of `apps/desktop/test/e2e/ai.py`: a send, a stop, a queued and a steered message, a model and effort switch, the ring filling, an edit kept and one undone, a rewind; the Ask drive green in Ask mode; `weight.test.ts` unchanged | 2 |
| **5 `ai-commands`** | `lib/ai/commands/` (new) | the registry of section 3, table-driven, with synonyms, arguments and availability per provider; custom commands and agent profiles from front matter (4.7); the runners: `/goal` and its evaluator, `/loop`, `/subtask`, `/bg`, `/batch`, `/deep-research`, `/init`, `/memory` and remembering, `/export`, `/usage`, `/status`, `/doctor`, the verbs of 3.5 | a table test that every row of section 3 is registered, no name or synonym is taken twice, every command is available or dimmed with a reason for each of the six provider kinds, and none of 3.7 is registered; the goal loop against a fake engine through met, impossible, budget, no-progress and a fatal error; front-matter commands found, argued and overridden | 2 |

Wave 1 is lanes 1 and 2, side by side: one is the window's TypeScript, the other the
crate and `lib/ai/local`. Wave 2 is lanes 3, 4 and 5 together once lane 1's types are on
main, each against the fake engine until the real one is there; lane 4 draws what lanes 3
and 5 export and owns none of their logic.

### 6.3 Open questions for Emil

1. **Ask becomes a mode**, and the panel keeps Ask's slot and key. Or keep a separate Ask
   tab beside the new panel?
2. **Apply and review** as the default for Agent mode (Cursor's way), with Ask before edits
   one click away. Or the other way round (Claude Code's Manual)?
3. **The sidebar's agent gets `browser.reader` by default** (the reader is at the keyboard),
   where an outside agent does not. Fine?
4. **Threads on this device only**, never synced. Or synced like notes (they hold the words
   of every note they read)?

### 6.4 Where lanes 1 and 2 meet

Agreed by lane 2 against lane 1's `lib/ai/chat/types.ts`. Lane 2's one change in lane 1's files: the local loaders in `engineFor`, and `grant_for` made `pub(crate)`.

- **The engine.** `createLocalEngine(kind, setup)` in `lib/ai/local/engine.ts` is the
  `Engine` for `claude-code` and `codex`; `setup` is the API engine's `Setup` as far as
  it is read (`provider(id)`, `instructions(thread)`). `engineFor(kind, setup)` in
  `lib/ai/chat/engine.ts` loads it for a local kind through a dynamic import, so none of
  it is in the first paint, and keeps one per setup and program, since an engine holds
  its threads' sessions; `registerLocalEngine(kind, load)` takes a loader of a setup.
- **Events** are the API engine's: `turn` for the reader's message and the model's,
  `part` as each grows (text, thinking, a `tool` row per `nib mcp` call with the verb's
  own name and its answer), `model`, `usage` (the program's own counts; `window` from
  Claude Code's `modelUsage` or Codex's `modelContextWindow`), `limit`, and `done` once.
  Notices it writes: `model`, `compacted`, `stopped`, `error`.
- **Models.** `models(provider)` asks the program (`list_models`, `model/list`). Claude
  Code's window is known only for a `[1m]` name until the first answer says it; Codex's
  only after one; `fast` is false for Claude Code.
- **Steer**: Codex's `turn/steer` into the running turn; Claude Code reads a message
  sent mid-turn after the turn, so its answer is a model turn of its own.
- **The program's own goal**, for lane 5's `/goal` runner: `Engine.goal?(thread, to, on,
  signal)` (`lib/ai/chat/types.ts`), which only these two engines have; where it is
  missing the runner keeps nib's evaluator loop. `to` is `GoalTo`: `set` with the
  condition and Codex's token budget, `resume` with the condition and the next turn's
  words, `pause`, `clear`. A set or a resume runs like a send - the reader's message is
  the condition, each turn the program takes is a model turn of its own, `done` once -
  and answers the `GoalState` the program left it in: Codex's own (`complete` is `met`,
  `budgetLimited` is `budget_limited`, a pause, a block or a usage limit is `paused`),
  `paused` after a stop (the engine holds the goal so no next turn starts), and `null`
  where the program does not say - Claude Code, which runs a whole goal as one answer
  and prints no verdict, so the runner judges that one end itself (its evaluator, once)
  or calls it ended. A pause or a clear answers at once. Claude Code has no paused goal:
  a pause clears it there and the runner keeps the condition, and a resume sets it again
  (`lib/ai/local/goal.ts`). The turns land in `thread.turns`, so the runner counts
  `goal.turns` and `goal.tokens` from them and draws the same chip on both roads.
- **The grant.** The crate asks `ai_agent::grant_for` for the provider's built-in grant,
  the one the API loop uses (`nib-<provider id>`, with the same two choices from
  `lib/ai/chat/choices.ts`), and issues its token for `nib mcp`; lane 3's grant work
  applies to both roads unchanged.

### 6.5 Where lane 5 meets the panel, the review and the sessions

Written by lane 5 against lane 4's seam (`lib/ai/sidebar/seams.ts`); neither edits the
other's files.

- **The rows.** `commands(panel)` in `lib/ai/commands/index.ts` returns the menu: the 58 rows
  of section 3 in its order, then the reader's own commands (4.7). The panel asks it **each
  time the menu opens** rather than once, because note commands are found in the background
  (a front-matter search of the space, kept until the link index changes) and arrive in the
  next menu. A row is lane 1's `Command` plus `description` (a few words, translated, which
  the menu also filters by) and `source` (`nib`, or the note's path).
- **The context** a row runs with is `{ args, thread, panel, typed }`; `typed` is the name the
  reader typed where it was a synonym, which `/approve` needs (it is a synonym of
  `/permissions` that does something of its own).
- **The panel.** Every `PanelActions` control, plus these, each optional: a command whose
  half is missing does the most it can without it (`lib/ai/commands/types.ts`, `Panel`).
  - `text`, read and written: `/help` puts `/` in the field, `/mention` and `/add-space` put
    `@words` there with the `@` menu open on them.
  - `provider`: the open thread's provider, or a new thread's.
  - `ensure()`: the open thread, made first where none is: `/goal`, `/loop`, `/subtask`,
    `/batch` and the reports need a thread to live in.
  - `turn(thread, text, once?)`: sends in any thread, open or not, exactly as the field does
    (queued behind a running turn, drawn as it runs, listed as running), and resolves once
    that send is over with `{ stop, error?, turn, usage, limit? }`. `once` is `{ mode?, model?,
    effort?, signal? }`, for that send only: a custom command's overrides, Agent mode for
    `/init`, `/summarize` and `/review`, and the signal a goal, loop or helper is stopped by.
    Without it lane 5 sends through `engineFor` itself and writes the thread down after.
  - `adopt(thread, open?)`: a thread a command made (a fork, a subtask, a batch's helpers)
    into the list. `touched(thread)`: a thread a command changed outside a send (its goal, a
    line it added), to draw and write down.
  - `approve(approval, allow)` and `voice(on?)`, for `/approve` and `/voice`.
- **Its lines** are a notice of their own, code `command` (added to lane 1's `NoticeCode`),
  in a model turn of their own: a goal that ended, a subtask's answer, `/status`, `/usage`,
  `/doctor`, `/tasks`, a listing. `text` is already worded, a row a line (`word · value`),
  never sent to the model. The panel draws it as it is.
- **The goal chip** draws `thread.goal` (lane 1's `Goal`): ◎, minutes since `started`,
  `turns` of `budget.turns`, `tokens`, `reason` on click; ✕ runs `/goal clear`. A thread's
  background work (goal, loops, subtasks, batches, research, forks) is `tasks.of(thread.id)`
  in `lib/ai/commands/tasks.svelte.ts`, for the running dot.
- **What the model is told.** The panel's engine setup appends `instructionsFor(thread)`
  (`lib/ai/commands/instructions.ts`) to the space's `AGENTS.md`: the agent profile chosen by
  `/agents`, the style chosen by `/output-style`, and, in Agent mode while memory is on, that a
  remembered fact is a line under `## Memory` in `AGENTS.md`. The thread keeps `agent`,
  `style` and `helpers` beside lane 1's fields (the store keeps what it does not check).
- **Lane 3.** `/rewind` and `/diff` run `rewind(context)` and `changes(context)` from
  `lib/ai/review/commands.ts`, found by name like the panel finds lane 5, and are dimmed
  ("Not here yet") until that file exists. A thread's review covers the threads in its
  `helpers` too, so a `/batch` is one review.
- **Lane 2.** `/goal` runs nib's evaluator on every provider today, Claude Code and Codex
  included (6.4). When the local engine carries a `goal` of its own, the runner hands Claude
  Code's `/goal` and Codex's `thread/goal/*` the condition and reads their state into the same
  `Goal`. `/login` and `/logout` type the program's own `auth login` / `auth logout` (Codex
  `login` / `logout`) into a terminal tab, through `lib/ai/local/signin.ts`.

### 6.6 The review's seam (lane 3)

What the panel (lane 4) and the commands (lane 5) meet the review at. Every piece is in
`lib/ai/review/` and is found by name through `import.meta.glob`, so neither lane has to
change a line once it lands, and none of it is in the first paint.

| piece | who draws or calls it | with | does |
| --- | --- | --- | --- |
| `ChangesBar.svelte` | the panel, over the field | `thread` (the live thread the engine writes into, `chat.thread`), `panel` (the chat store) | the bar, the list of changes (`/diff`), the rewind sheet and Redo; nothing while nothing waits |
| `Branches.svelte` | the panel, under each of the reader's messages | `thread`, `turn` (the message's id), `panel` | `‹ 2/3 ›` where the message was edited; nothing elsewhere |
| `Asked.svelte` | the panel, in a tool row whose state is `asking` | `part` | the diff the write would make (Ask before edits) |
| `index.ts` `openRewind(thread, panel, turn?)` | Esc Esc on an empty field; the clock on a message's hover (with its `turn`) | | opens the rewind sheet in the bar |
| `index.ts` `lastMessage(thread)` | Up on an empty field | | the message an edit changes |
| `index.ts` `editMessage(thread, turn, text, panel)` | the pencil on a message, sent | | rewinds notes and conversation to before it, keeps what followed as a branch, sends `text` |
| `index.ts` `askFirst(provider)`, `setAskFirst(provider, on)` | `/permissions` | | the built-in grant's `confirm` mode: Ask before edits, or Apply and review |
| `commands.ts` `rewind(context)`, `changes(context)` | `/rewind`, `/diff` | the command's `{ thread, panel }` | the sheet; the list |

`panel` is anything with `send(text)`, a writable `text` (the field) and `touched(thread)`,
which draws a thread changed outside a send again and writes it down: a rewind cuts its
turns, and Redo and a branch put turns back. Lane 5's `Panel` already has this shape.

Underneath: an edit's thread is the one that was answering for its provider when it was
made (`lib/ai/chat/sends.ts`, written by `engineFor`); its checkpoint is the reader's latest
message before it. Undo is a selective take out of the agent's own steps
(`Steps.take` in `lib/agents/docs/steps.ts`), so the palette's "Undo edits by" and the
review never disagree. An engine that keeps a conversation of its own (Claude Code, Codex)
forgets it when the turns are cut (`Engine.rewound`) and is reseeded at the next send.
Like the steps, the review lasts the session: after a restart an old thread rewinds its
conversation, not its notes.

### 6.7 Lane 4: the panel, and where lanes 3 and 5 plug in

Built on lane 1's engine, in `apps/desktop/src/lib/ai/sidebar/`, one file a job:

| File | What it owns |
| --- | --- |
| `ChatPanel.svelte` | The panel in Ask's slot: the title and its menu, the conversation or the list, the foot |
| `chat.svelte.ts` | The state: the space's threads, the open one as a copy made once a frame, the running ones, the queue, steering, every control's action |
| `Conversation.svelte`, `Reply.svelte`, `PartRow.svelte` | Messages, answers with Ask's citations, folded thinking and tool rows, notices, Allow and Don't allow |
| `Composer.svelte`, `Queue.svelte`, `Suggest.svelte` | The chips, the field and its keys, the queue, the `@` and `/` list |
| `ModelPicker.svelte`, `Ring.svelte`, `ring.ts` | The model chip and its popover; the context ring and its tray |
| `Threads.svelte` | The thread list: search, open, archive, delete |
| `gather.ts`, `citations.ts`, `mentions.ts` | What a message is sent with: chips read at the send, Ask's passages, what `@` means |
| `setup.ts` | The engine's `Setup`: providers, `AGENTS.md` and `CLAUDE.md`, Ask's citing rule |
| `seams.ts` | The `/` menu: lane 5's rows asked as it opens, matched as the reader types |
| `prefs.ts`, `migrate.ts`, `quote.ts` | The mode, the effort per model and the open thread remembered; the Ask panel's conversations made threads once; Alt+K |

**Where the other lanes meet it.** Claude Code and Codex need nothing of the panel:
`engineFor` (6.4) answers them with its one setup.

- **Lane 3**, met as 6.6 says: `ChangesBar` over the field with the live thread and the
  panel, `Branches` under each of the reader's messages, `Asked` in a call that asked;
  Esc Esc on an empty field and the clock on a message open the rewind sheet, Up on an
  empty field and the pencil on a message put it in the field to send again
  (`editMessage`), and Follow is a row of the thread's menu.
- **Lane 5**: `lib/ai/commands/index.ts`, met as 6.5 says: `commands(panel)` asked each
  time the menu opens, `typed` in the context, the panel's `turn`, `adopt`, `touched`,
  `ensure`, `text` and `approve` (not `voice`, below), `instructionsFor(thread)` in the
  setup, the goal chip from `thread.goal` and the running dot from `tasks.of(thread.id)`.

Not built here, and why: voice (the recorder's road into a field is its own lane), Open
as a tab (a thread as a pane needs a tab kind), and Continue in the panel from the quick
question (the quick question stays as it is, beside `/btw`).

The drive `apps/desktop/test/e2e/ai-sidebar.py` walks all of it against a fake provider,
in the light and the dark, and then the whole flow in one thread: Ask, an agent's edits
kept and undone, a rewind, a message edited and sent again.

---

## Sources

[cc-commands]: https://code.claude.com/docs/en/commands
[cc-vscode]: https://code.claude.com/docs/en/vs-code
[cc-model]: https://code.claude.com/docs/en/model-config
[cc-checkpoint]: https://code.claude.com/docs/en/checkpointing
[cc-goal]: https://code.claude.com/docs/en/goal
[cc-interactive]: https://code.claude.com/docs/en/interactive-mode
[cc-headless]: https://code.claude.com/docs/en/headless
[cc-cli]: https://code.claude.com/docs/en/cli-reference
[cx-commands]: https://learn.chatgpt.com/docs/cli/slash-commands
[cx-exec]: https://learn.chatgpt.com/docs/non-interactive-mode
[cx-app-server]: https://learn.chatgpt.com/docs/app-server
[cx-ide]: https://learn.chatgpt.com/docs/ide
[cx-goal]: https://simonwillison.net/2026/Apr/30/codex-goals/
[cursor-agent]: https://cursor.com/docs/agent/overview
[cursor-modes]: https://cursor.com/docs/agent/modes
[cursor-mentions]: https://cursor.com/docs/context/mentions
[copilot-chat]: https://code.visualstudio.com/docs/copilot/chat/copilot-chat
[copilot-checkpoints]: https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints
[copilot-cheat]: https://code.visualstudio.com/docs/copilot/reference/copilot-vscode-features
[windsurf]: https://docs.devin.ai/desktop/cascade/cascade
[zed]: https://zed.dev/docs/ai/agent-panel
[jetbrains]: https://www.jetbrains.com/help/ai-assistant/ai-chat.html
[raycast]: https://www.raycast.com/core-features/ai
[notion]: https://www.notion.com/help/notion-ai-faqs
[obsidian-copilot]: https://docs.obsidiancopilot.com/
[smart-chat]: https://smartconnections.app/smart-chat/
[anthropic-models]: https://platform.claude.com/docs/en/api/models/list
[anthropic-effort]: https://platform.claude.com/docs/en/build-with-claude/effort
[openai-reasoning]: https://developers.openai.com/api/docs/guides/reasoning
[siwc-models]: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
[siwc-limits]: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
