# Agent-native nib

A design, a spike and a plan. It decides how an agent - Claude Code, Claude Desktop, Codex,
anything that speaks the Model Context Protocol - works inside nib: in the reader's web
tabs, in tabs of its own that nobody sees, and in the notes, open ones included. The code
that exists is on the branch **spike/agent-tabs** (`src-tauri/src/agent_tabs.rs` and its
probe, `agent-tab-probe.py`), a measurement that is not merged. Section 13 is the plan the
lanes build from.

Emil, 2026-09-30:

> I want nib to be AI native. That means I will do a lot of unsupervised agent work, where
> the agent e.g. has to do a lot of stuff in my browser. Nib should be built so that the
> agent has this entire framework that would allow him to use already existing user tabs,
> perform actions in them, interact with them. And also of course to have and use his own
> tabs in the background that the user doesn't even see a single thing of. So then the
> agent can work with tabs and stuff without the user being annoyed by it.

And later the same day:

> I want it to be possible that the AI edits and reads all kinds of stuff, so that includes
> currently open notes. Consider that.

## The short version

1. **One agent surface for all of nib**, served on this machine by the app itself: the
   browser, the notes (open ones with their unsaved words, their selection and what is on
   screen), the tree, the tabs, canvases, PDFs, versions and a short list of settings. It is
   an MCP server reached as `nib mcp`, which is the installed app's own binary speaking
   stdio, so Claude Code needs one line and no Node, no port and no key pasted anywhere.
2. **An agent's own tab is a page nobody sees, and it is not a hidden page.** It is a
   webview shown to the engine and placed outside the window's client area, where Windows
   clips it to nothing. The spike measured it: `requestAnimationFrame` at 60 a second and a
   10 ms timer at 100 a second, exactly the reader's own visible tab, where the engine's own
   hiding gives 0 and 1. Not one of its pixels is in a photograph of the window, the window
   in front never changed, the keyboard never moved, and the reader's tab ran at 60 and 100
   throughout.
3. **Everything is driven through the engine, never the operating system**:
   `CallDevToolsProtocolMethod` on that one webview. No devtools port, no synthetic mouse,
   no key the reader could lose. Reading the page as an accessibility tree took 7 ms, a
   click 20 to 29 ms, a screenshot 110 ms. A click through the engine's own hiding took five
   seconds and did nothing, which is why the page is not hidden.
4. **The reader's logins by default.** An agent tab is in the same web store as the
   reader's tabs, so it is signed in where they are. A task can ask for a store of the
   agent's own instead, which starts signed out, and a site can be set to require that.
5. **Any of the reader's tabs is the agent's too, and nothing takes it away**: every web
   tab of every space, by its id, with the same verbs as its own. The reader clicking or
   typing in it changes the page and nothing else - there is no lease to lose and nothing to
   hand back (Emil, 2026-10-05). It is visible and never in the way: a thin accent frame
   round the page and the agent's mark on the tab, the element about to be pressed lit by
   the engine's own highlight. The agent never takes the window or the keyboard, and the
   stop stops it.
6. **An open note is edited as a transaction in the live editor, never by writing the
   file.** Edits name what they change by anchors (a quoted passage, a heading, a block),
   resolved against the words as they are at that moment, so a paragraph the reader wrote
   meanwhile moves nothing. The agent has a caret like a collaborator, the reader's typing
   wins where both meet, every agent edit is its own undo step and is in the versions with
   its source. Under sync v2 the agent is one more peer on the note's Yjs document.
7. **Every agent is a named grant**: scopes per capability (notes, tree, tabs, browser,
   the reader's own tabs, scripts, settings, the terminal), per space and per site, and a
   short list of things it always asks first: paying, sending, deleting for good, signing
   in, publishing and sharing, settings. Unsupervised mode asks for nothing else; confirm
   mode asks for every write.
8. **Page content is data.** Every word that came from a page or from a shared note comes
   back marked untrusted, credentials are only ever typed by the reader, and nib's own
   window is never a page an agent can reach.
9. **One stop for everything**: a key that works from any app, the stop on every
   indicator, and a row in the tray. An audit log of every call, readable in nib and
   attachable to a note.
10. **Zero cost when no agent is connected.** No webview, no thread, no listener and no
    byte of the first paint. The agent's interface arrives with the first agent.

---

## 1. What it is for

An agent working unsupervised for an hour is only worth having if the reader can forget it
is there, and can see everything it did afterwards. Four things decide whether that is
true, in this order:

1. **It never interrupts.** Not a window, not a flash of a page, not a sound, not a tab
   appearing in the strip, not the keyboard taken while somebody types in another app. This
   is the complaint every browser agent collects: Claude in Chrome's yellow "started
   debugging this browser" bar on every tab ([#69287][cic-banner]) and its tab groups left
   behind ([#15436][cic-groups]), Comet's agent loops eating CPU ([eesel][comet-reviews]).
   nib's rule for its own probes is the same rule for agents: nothing of it is ever on
   screen or in front unless the reader asked.
2. **It can do the real thing.** The reader's logins, the reader's open tabs, the note the
   reader has open with the words they have not saved yet. An agent that can only work in
   a clean profile, or only on notes as the disk has them, cannot help with what the reader
   is actually doing.
3. **It is visible where it acts and stoppable at once.** Where it works in something the
   reader can see, the reader can see that it is, and one press ends it. Nothing
   irreversible happens without being asked for, and afterwards the whole run can be read.
4. **It costs nothing until it is used.** nib opens in under a second, and its first paint
   is held under 3,279,000 bytes and 376 modules by a test; agents get none of it.

---

## 2. What others do

Read on 2026-09-30 from the products' own documentation and issue trackers.

| product | tool surface | background work | presentation | safety |
| --- | --- | --- | --- | --- |
| **Claude in Chrome** ([permissions][cic-perms], [Claude Code][cic-code]) | tabs, navigate, `read_page`, `find`, `computer` (click, type, scroll, screenshot), `form_input`, console and network, GIFs, file upload | opens its own tabs in the reader's Chrome, in a tab group per session | the tab group with a state mark; Chrome's debugging bar on every tab | three modes (approve each, approve automatically with a safety check, skip); per-site "always allow"; protected actions confirmed even then; purchases, account creation, deletions and "instructions from emails or web content" refused outright |
| **OpenAI Operator, ChatGPT agent, Atlas** ([Operator][operator], [Atlas hardening][atlas-hardening]) | screenshots and a cursor (CUA) | a remote browser (Operator), the reader's tabs (Atlas) | blue highlight, a visible cursor, narration, take over and stop | **takeover mode** for credentials and payments, where nothing is photographed while the reader types; **watch mode** on email and finance; confirmation before an order or a send; logged-out mode; agent pages kept out of history. OpenAI: prompt injection "may never be fully solved" |
| **Perplexity Comet** ([Brave][brave-comet], [unseeable][brave-unseeable]) | reads and drives tabs, a background assistant | background tabs | a blue outline on the controlled tab | Brave showed page text and text inside screenshots steering the agent into reading Gmail and posting the result; users report loops, CPU and memory |
| **Edge Copilot Mode actions** ([Edge blog][edge-copilot]) | multi-step actions in tabs | - | clear cues while acting, listening or viewing; stop any time | no access to passwords or payment data; pauses for the person |
| **Playwright MCP** ([snapshots][pw-snapshots]) | `browser_snapshot` as an accessibility tree with `[ref=e5]`, click and type by ref, tabs, console, network, file upload, dialogs | headless or headed, its own profile | none | refs are valid until the page changes; a stale ref is an error telling the agent to snapshot again |
| **Chrome DevTools MCP** ([tools][cdm-tools]) | `take_snapshot` with uids, `click`, `fill`, `fill_form`, `handle_dialog`, `upload_file`, `wait_for`, console and network listing, `evaluate_script`, screenshots, WebMCP | `new_page` with `background`, and `isolatedContext` for a page with its own cookies | none | the person's own browser, on purpose |
| **Browserbase and Stagehand** ([Stagehand][stagehand]) | `act`, `extract`, `observe`, `agent` | remote browsers, contexts that keep cookies | live view and session replay | - |
| **Browser Use** ([parameters][browser-use]) | indexed DOM with highlighted elements | own or the person's profile | highlights | `allowed_domains` |
| **Anthropic computer use** ([docs][computer-use]) | screenshots and coordinates | a virtual machine, recommended | - | classifiers over tool results flag injected instructions and make the model check with the person |
| **Apple App Intents and App Schemas** ([WWDC26][app-schemas]) | an app's own actions and entities, typed | the system runs them | Shortcuts, Siri | the app decides what it exposes |
| **WebMCP** ([cheat sheet][webmcp]) | a page registers typed tools on `document.modelContext` | - | - | the page decides what it exposes |

What that adds up to, and what nib takes from each:

- **Refs from the accessibility tree beat screenshots** for cost and precision (Playwright,
  DevTools MCP); screenshots stay for what the tree cannot say. nib's refs are the engine's
  own node ids, so a ref outlives a snapshot for as long as the element does, which is
  better than Playwright's "until the page changes".
- **Typed actions beat driving an interface** wherever the app owns the thing (App
  Intents). nib owns its notes, so the notes are typed tools, never an agent clicking about
  in the editor.
- **Credentials are the reader's** (Operator): the agent never types a password; the reader
  does, in the tab. What nib does not take from Operator and Atlas is the mode switch
  around it - "take control", then hand back - which leaves either the reader or the agent
  waiting on the other; Claude in Chrome, Comet, Browser Use and Playwright MCP's extension
  all share the tab instead and re-read the page every step, and so does nib (7.3).
- **A visible mark on what the agent is touching** is universal (Comet's outline, Atlas's
  highlight, Claude's tab group) and the thing people complain about is when it is loud
  (Chrome's debugging bar) or left behind (orphaned groups).
- **Background tabs in the reader's own browser are either visible** (Claude's tab group,
  in the strip) **or remote** (Operator). Nobody has tabs that are the reader's own
  browser, signed in, and invisible. That is nib's opening, and it is possible only because
  nib owns the window the engine draws in.
- **Page content steering the agent is the unsolved problem** (Brave, OpenAI, Anthropic).
  Nobody claims to have fixed it; everybody layers marking, confirmation and limits on
  what an agent can reach. nib does the same, and the one structural thing it adds is that
  credentials and irreversible acts never depend on the model behaving.

---

## 3. The spike: a page nobody sees

The riskiest part of the whole design was whether an agent's page could be in the
reader's own engine, signed in, **and** out of sight, **and** running at full speed,
**and** driven without touching the reader's keyboard. Every one of those is in tension
with another: a page the engine is told is hidden is throttled, a page that is shown is on
screen, a page in another window is another window, a page in another store is signed out.

### How it is built

`agent_tabs.rs` on the spike branch, about two hundred lines:

- **A child webview of the app's own window, shown, at (-10000, -10000) in the window's
  own coordinates, 1280 by 800.** A child window is always clipped to its parent, so no
  pixel of it can be drawn anywhere, and to the engine it is a visible page at a desktop
  size. Far enough out that a popup the page raises lands on no screen either (see 6.5).
- **Built on `about:blank`**, so its settings are in place before the site's first byte:
  the engine's own dialogs, context menu, status bar, zoom keys, accelerator keys,
  autofill and password saving off, sound muted, developer tools off. `focused(false)`,
  because wry otherwise hands every new webview the keyboard (`MoveFocus` at build).
- **None of a reader's tab's listeners**: not the browser's chords (`web_keys.rs`), not the
  page-first keys (`web_opens.rs`), not the full screen (`web_page.rs`), not the permission
  bubble. Each of those exists to bring something to the reader, which is the one thing an
  agent's page must never do. A window the page asks for is refused.
- **In the reader's own store**, through `on_shared_session` - the same environment every
  web tab of the global store is built on, so the same browser process and the same
  cookies. That is also why nothing here is a browser switch: every webview on one user
  data folder must be started with the same switches (`engine::BROWSER_ARGS`), so a
  switch that turned throttling off for agents would turn it off for every tab.
- **Driven only through `CallDevToolsProtocolMethod`** on that webview (`agent_cdp`). No
  `--remote-debugging-port`, no socket, no `SendInput`.

The control is the same page opened with the engine's own hiding (`hide()`, which is
`IsVisible` false), because that is what a "background webview" would be if nobody had
looked.

### What was measured

`agent-tab-probe.py` on a probe build (version 99.0.0, updater blocked, spaces in a
temp folder), launched by `run_probe`, on this machine (Snapdragon X Elite, Windows 11,
WebView2 on a 200% display). A reader's web tab (green) is open and visible the whole time;
the agent page is magenta. Every top-level window of the app **and of every engine process
under it** is watched every 4 ms from launch to exit, on top of `run_probe`'s own watch,
because a dialog, a picker or a popup a page raises belongs to an engine process and
`run_probe` only watches the app's. No key is pressed anywhere.

Five runs on 2026-09-30, one of them holding both pages 330 s longer and one minimising
the window; the ranges are across runs.

| | out of sight: shown, outside the client area | the engine's own hiding (control) |
| --- | --- | --- |
| built, and a local page loaded | 77 to 93 ms, 84 to 98 ms | 89 to 196 ms, 94 to 211 ms |
| `requestAnimationFrame`, a second | **59.9 to 60.1** | 0 |
| a 10 ms interval, a second | **99.8 to 100.0** | 1.0 |
| `document.visibilityState` | visible, and never changed | hidden |
| after 330 s more, past the five minutes Chromium waits before intensive throttling | 60.1 and 100.0 | 0 and 63.8 (see below) |
| with the window minimised, and after it was restored | 60.1 and 100.0, visible | - |
| the accessibility tree, 22 nodes, as 14 lines and 446 characters | 6 to 7 ms, 4 ms again | 5 to 12 ms, once 5.1 s |
| an input clicked, then a button (five protocol calls each) | 20 to 23 ms, 28 to 29 ms; `isTrusted` true, the typed name saved | 5.0 to 10.2 s each, and nothing happened |
| `Input.insertText` | 3 to 4 ms | 2 ms to 2.6 s, into nothing |
| `Page.captureScreenshot`, 2560 by 1600 | 109 to 115 ms, the page's own pixels | never answered in 30 s |
| agent pixels in a `PrintWindow` picture of the whole window (3.66 million pixels, 3.19 million of them the reader's page) | **0** | 0 |
| the window in front | never the probe or any engine process under it, in five runs | the same |
| the app thread's focus window | the same before and after every step (the same handle, compared by the harness since) | the same |
| the reader's tab: rAF, interval, state | 60, 100, visible, before and during | the same |
| the tab strip, the tab in front, the app's focused element | unchanged | unchanged |
| engine processes and working set | two more processes and 83 to 100 MB for both pages together; all of it back when they closed | |

What the page itself tried, with the out-of-sight page:

| the page | what happened |
| --- | --- |
| `window.focus()`, then `focus()` on its input | the input is the page's active element; the app's focus window and the window in front did not change |
| `window.open` | refused: `null`, no window, no tab |
| `prompt()` | the engine's `ScriptDialogOpening` fired with the page's message, `prompt` returned `null` in 3 ms, and no window appeared |
| `alert()`, `confirm()` | **never reached the engine**: see the first finding below |
| developer tools | off on the page, and the protocol answered every call regardless |

### What it proves, and what it does not

**It proves the shape.** A page in the reader's own store and browser process can be
fully alive, driven with trusted input and photographed, while nothing of it is on any
screen, nothing takes the keyboard and the reader's own tab does not notice. The engine's
own hiding is not a cheaper version of the same thing, it is a different thing: a page
that does not paint, does not take input and cannot be photographed, and any call that
needs its renderer waits seconds for a wake-up. So the agent's page is never hidden, and
the design does not lean on `WebView2`'s background timer settings, which are prerelease
only ([`PreferredBackgroundTimerWakeInterval`][wv2-timer]) and would leave animation frames
and input dead anyway.

**It found a bug that is not the agent's.** `tauri-plugin-dialog` puts a script into every
webview Tauri builds, in every frame, that replaces `window.alert` with a call to its own
IPC and `window.confirm` with an `async` function (`init-iife.js` in the plugin). A web
page's IPC is refused, so in a **reader's web tab today** a site's `alert` shows nothing
and returns at once, and its `confirm` returns a promise - which is truthy - so a site's
`if (confirm("Delete this?"))` goes ahead as if the reader had said yes. The spike saw it
as `Command plugin:dialog|confirm not allowed by ACL` coming back from a page's `confirm`.
It belongs with the work of taking every injected script out of the page's world: the
`google-docs` lane's `web_worlds.rs`, in progress, takes back every script the runtime
registered on a tab before it is sent to the site, which includes this one, and its probe
should ask a page's `confirm` outright. An agent's tab is built through the same
`web_worlds` path, so that its dialogs reach `ScriptDialogOpening` the way `prompt` already
does.

**The harness found one more.** The page that holds the web session open (`session::anchor`
in `web_tabs.rs`, one pixel, hidden) was built the way wry builds every webview, with the
keyboard: so the first page of a run took the app's focus to a page nobody can see. For a
reader's tab the tab took it straight back; for an agent's, opened while somebody types in
a note, the typing went nowhere. The spike's own check compared windows by class and
process, and every page of the engine is the same class in the same process, so it read as
unchanged. Built without the keyboard now, and the harness compares the handle.

**What it does not prove**, and where each goes:

- **Real sites.** A local page of 22 nodes. `agent-core`'s probe adds a shop with a card
  form, a sign-in, dialogs, a popup, a download, a file input, a `<select>` and a date
  field, and a frame from another origin, which the engine runs in its own process: its
  button came back as `f1e8`, through the frame's own session
  (`CallDevToolsProtocolMethodForSession`), and was pressed. Heavy real sites are the
  harness's nightly drive.
- **The engine's own popups.** A `<select>` list, a date picker and autofill were not
  opened, on purpose (6.5). The harness opens them with the engine-process watch running.
  Measured 2026-09-30 on a build of the spike, pressing each field through the protocol:
  a `<select>`'s list, a date picker and a colour picker are each a window of the engine's
  browser process at -32768, -32768, clamped there by Windows and on no screen, and
  nothing came forward. That is with the probe's own window off the screen too; with the
  reader's window on a screen the page is 10,000 pixels from it, and whether the engine
  then pulls a popup onto that screen is not measured, since finding out would put one
  there. So the rule stands, and two scenarios of the harness hold the verbs to it
  (apps/desktop/test/agents): `pickers-refused`, where a press on any of the three and the
  keys that open one are refused and the values are set through the page, and
  `picker-by-page`, where the page itself calls `showPicker()` on an agent's ordinary
  press: no window of the engine's appeared at all. Autofill is off in agent tabs and was
  not opened.
- **Keys.** None were pressed, which is this repository's rule while a key pressed in a
  page through the protocol can bring a probe forward. There the key went through a
  reader's tab's page-first script to the app, which then took the keyboard back to its own
  webview; an agent's page has neither that script nor `web_keys.rs`. `agent-core`'s probe
  then pressed `a`, `Shift+B`, `Backspace`, `c` and `Enter` into an agent's page through
  `Input.dispatchKeyEvent`, with the engine-process watch running and the window in front
  and the app thread's focus read before and after each: every key arrived trusted, Enter
  submitted the form, and neither the window in front nor the focus moved, in every run.
  A reader's tab still gets no engine key (7.2). The harness's `keys` scenario presses
  five more through `browser_press`, with the focus compared by handle rather than by
  class, both with the app's keyboard nowhere yet and with a reader's page holding it:
  the same.
- **Other screens, other scales.** One screen at 200 %. A screen to the left of the
  primary one sits at negative coordinates; 10,000 pixels is past any real arrangement,
  and the harness checks the page's screen rectangle against every monitor at 100 % and
  150 % too. It does so over numbers (`watch_test.py`): the page at 100, 150 and 200 %,
  beside desks with screens to the left, above, and three 4K screens wide, reaches none,
  because it is up as well as left. A real screen at another scale is not simulated: it
  would change the screen of whoever is at the machine.
- **The control after five minutes.** The hidden page's interval came back to 63.8 a
  second after 330 s, with `requestAnimationFrame` still at 0 and the page still hidden.
  Nothing in the design depends on it and it is not explained here.
- **macOS, Linux and CEF.** Section 12, measured.

---

## 4. The shape of it

```
 Claude Code / Desktop / Codex ... ──stdio──► nib mcp  (the app's own binary, no UI)
                                                  │  per-agent token, MCP JSON-RPC
                                                  ▼
                                   127.0.0.1:<port>  endpoint.rs   (exists; secret, Host, Origin)
                                                  │
                     ┌────────────────────────────┴───────────────────────────┐
                     ▼                                                        ▼
         the crate: src-tauri/src/agents/                       the window: lib/agents/ (lazy)
         - agents, tokens, scopes, policy                       - notes: live text, anchors,
         - agent tabs: build, quiet, park, close                  transactions, presence, undo
         - DevTools bridge: calls and events                    - tree, tabs, bookmarks, search,
         - snapshot, refs, click, type, wait                      canvases, PDFs, versions
         - dialogs, popups, downloads, files                    - indicator, frame, activity panel,
         - audit log, rate limits, stop                           approvals, watch, settings pane
                     │
                     ▼
         WebView2 (CEF later): agent tabs out of sight, the reader's web tabs

 claude.ai / a phone ──https──► services/sync/src/mcp   (the account connector: notes only,
                                                          no live state, works with nib closed)
```

Two rules shape the split:

- **What only the engine can answer is answered in the crate.** A page's tree, a click, a
  screenshot, a dialog: the crate holds the webview and the window has no business in the
  middle. So the browser verbs are the first verbs the endpoint answers itself rather than
  handing to the window (`endpoint.rs` hands everything to the window today), which also
  means an agent's browsing never waits on the window's thread being free and never
  touches the first paint.
- **What only the window knows is answered in the window.** Open notes with their unsaved
  words, the caret, the tabs, the undo stack, the link index: the dispatcher that already
  exists (`lib/automation/verbs.ts`) grows the agent's verbs, through the same calls the
  app makes, so an agent can only do what a person at the keyboard could, the way
  `docs/automation.md` already promises.

---

## 5. The tool surface

MCP tools, as the agent sees them. Names are the protocol's; each is one verb on the
endpoint. **An agent is only shown the tools its grant reaches**, so an agent with notes and
no browser lists no browser tools and spends no context on them. Every result that carries
words from a page, a download, a PDF or a note in a shared space comes back inside
`<untrusted source="...">...</untrusted>`; see 9.6.

### 5.1 Where the reader is

| tool | what it answers | scope |
| --- | --- | --- |
| `get_context` | the space; every open tab by id with its kind, title, path or address, pane, and whether it is in front, selected, pinned, unsaved, the preview or a running terminal; the selected tab and what is selected inside it in its own terms (a note's words, caret and lines on screen, a canvas's or page note's picked objects, a terminal's selected words, a PDF's page); and whether the reader is typing right now | `context` |
| `agent_status` | this agent's grant, its mode, its open tabs, its pending approvals, whether it is stopped | always |

### 5.2 The browser

`tab` is an agent tab's id or a reader's web tab's id, as `browser_tabs` lists them: any
web tab of any space the grant reaches, on screen or not. A reader's tab needs
`browser.reader`; an agent's own needs `browser`.

| tool | arguments | what it does |
| --- | --- | --- |
| `browser_tabs` | - | the reader's web tabs of every space's set (id, title, address, space, in front, on screen) and this agent's (id, address, title, loading) |
| `browser_open` | `url`, `store`?: `reader` (default), `agent`, `space`; `space`?; `width`, `height`? | an agent tab, out of sight; answers its id and the store it is in, which is the agent's own for a site kept to it (6.3) whatever was asked |
| `browser_navigate` | `tab`, `url` or `back`/`forward`/`reload` | |
| `browser_wait` | `tab`, `for`: `load`, `network_idle`, `{text}`, `{ref}`, `{url}`; `timeout_ms` | network idle is no request in flight for 500 ms, counted from the engine's own network events |
| `browser_snapshot` | `tab`, `ref`? (a subtree), `max_chars`? | the accessibility tree as text: `- button "Save" [ref=e4812]`; refs are the engine's node ids, stable for as long as the element lives, `f2e17` inside a frame |
| `browser_find` | `tab`, `text` or `role` and `name` | the refs that match |
| `browser_read` | `tab`, `as`: `text`, `markdown` (default), `article`; `max_chars`? | the page as words, through the clipper's own converter (`@nib/markdown/from-html`), which the crate asks the window for (`agent.markdown`); the page's text when no window answers |
| `browser_click` | `tab`, `ref`, `button`?, `count`?, `modifiers`? | scrolled into view, the engine's highlight for a beat, then pressed |
| `browser_type` | `tab`, `ref`, `text`, `submit`?, `replace`? | into a field, as text rather than keys (`Input.insertText`); a date, time or colour field set through the page; refused on a password field and on every field of a sign-in form (9.4) |
| `browser_press` | `tab`, `keys` (`Enter`, `Control+A`) | keys pressed **inside that page**: through the engine (`Input.dispatchKeyEvent`) in an agent's own tab, measured to move neither the window in front nor the keyboard; as the page's own key events in a reader's tab, whose page-first keys would hand an engine key to the window (7.2). Never through the system, never into the window, never a key that opens a picker |
| `browser_scroll` | `tab`, `ref` or `dx`, `dy` | |
| `browser_select` | `tab`, `ref`, `values` | a `<select>` set through the page, never by opening its native list (6.5) |
| `browser_fill_form` | `tab`, `fields`: `[{ref, value}]` | several fields in one call |
| `browser_hover`, `browser_drag` | `tab`, `ref` / `from`, `to` | |
| `browser_upload` | `tab`, `ref`, `files`: paths inside a space | the file chooser is intercepted (`Page.setInterceptFileChooserDialog`) and answered with `DOM.setFileInputFiles`; a path outside every space asks (9.4) |
| `browser_screenshot` | `tab`, `ref`?, `full_page`?, `scale`? | a PNG; scaled to the page's CSS pixels unless asked |
| `browser_console` | `tab`, `since`?, `level`? | the last 500 lines per tab |
| `browser_network` | `tab`, `since`?, `match`?, `bodies`? | the last 500 requests per tab: method, address, status, type, time; bodies only with `browser.network` |
| `browser_evaluate` | `tab`, `expression`, `world`?: `isolated` (default), `page` | only with `browser.script` for that site (9.2) |
| `browser_dialog` | `tab`, `accept`, `text`? | answers the dialog the page is holding; every result says when one is waiting |
| `browser_downloads` | `tab`? | what the agent's tabs downloaded, where to, and whether it finished |
| `browser_storage` | `tab`, `op`: `cookies`, `set_cookie`, `clear`, `local` | an agent's own store only, unless `browser.storage` for the reader's |
| `browser_close` | `tab` | |
| `browser_show` | `tab` | asks for the agent tab to become a tab of the reader's, beside the one in front (6.7); it asks, because it changes the screen |
| `browser_takeover` | `tab`, `reason` | asks the reader to do one step in that tab - sign in, a captcha, a payment - and answers `needs_approval`; the tab stays the agent's, and `approval_status` says `done` once the reader says so (7.3) |

Four verbs of the crate's own sit beside these: `agent_status`, `approval_status`,
`agent_pair` (the installation's secret only: a client asking to become an agent, answered
with its token once the reader allows it) and `agent_bye` (a client going away; its tabs
close ten minutes later unless it comes back). Every answer is one of three shapes - `ok`
with the verb's result, `needs_approval` (9.3), or `error` with a code an agent can act on
(`stopped`, `no_such_ref`, `password_field`, `site_denied`,
`unsupported_on_this_engine` and the rest) - and a dialog the page is holding rides on
each. The whole contract is `src-tauri/src/agents/verbs.rs`, mirrored for the window in
`src/lib/agents/verbs.ts`.

**Every act settles** before it answers, the way Chrome DevTools MCP's
`waitForEventsAfterAction` does: a navigation of the page's own frame that starts within
100 ms is waited for (3 s at most), and then the document until it has not changed for
100 ms (3 s at most). An agent rarely needs `browser_wait` after a press, and a dialog the
press raised ends the wait and comes back on the answer.

**The snapshot** is written the way Playwright MCP writes one, which agents are trained
on - one element a line, indented, `- checkbox "Gift wrap" [checked] [ref=e47]` - with the
states DevTools MCP writes (`[focused]`, `[disabled]`, `[expanded]`, `[selected]`,
`[level=2]`, `[value="..."]`, a link's `[url=/path]`). Containers that say nothing give
their children to their parent. A secret field - a password, a one-time code, a card's
number or code - is one line that says only whether it holds anything, `[filled]`, with
nothing under it (9.4). Frames in
the page's own process are in the page's tree under their frame element; a frame in a
process of its own (another site, as Chromium isolates them) is reached through the
session `Target.setAutoAttach` gives it, and its refs are `f<n>e<id>`.

### 5.3 Notes

`path` is relative to the space. `space`? names another space without switching to it
(8.6).

| tool | arguments | what it does |
| --- | --- | --- |
| `list_notes` | `folder`?, `kind`? | notes, canvases, page notes, PDFs, web notes |
| `search_notes` | `query` | the search panel's own search, as rows, without opening the panel |
| `list_backlinks` | `path` | every link in the space that points at it; also `read_note`'s `backlinks` |
| `read_note` | `path` or `tab`, `include`?: `text`, `outline`, `properties`, `tasks`, `links`, `backlinks`, `blocks`, `selection` | the words **as they are on screen** when the note is open, unsaved ones included; `rev`, which changes with every edit; anchors for every heading, block and task. `tab` is any note tab `get_context` lists: one with a file is that file; one `unsaved` is a new note with no file yet, which is its space's though it is on no disk, read and edited like any open note and kept no version of; and `scratchpad` is the scratchpad, the same note from every space, which is a card and never a tab - read and edited through its card while it is up, so the reader's caret is carried, and in its file either way. The note tools below take both |
| `edit_note` | `path`, `edits`: `[{at, replace?, insert_before?, insert_after?, delete?}]` (one of the four), `if_rev`? | anchored edits in one transaction (8.2) |
| `write_note` | `path`, `content`, `if_rev`? | the whole text, for parity with the account connector (whose argument is `content`, so every note tool here says `content` for words); applied as the smallest edit between what is there and what is sent, as one transaction, so it is an anchored edit like the rest |
| `append_note` | `path`, `content`, `under`? (a heading) | |
| `set_property` | `path`, `key`, `value` or `null` | the front matter, through `frontMatterEdit` |
| `set_task` | `path`, `at`, `done` | ticks or clears one box |
| `list_tasks` | `view`? (`inbox`, `today`, `upcoming`, `logbook`, a `.base` path), `filter`? (Todoist's language), `space`?, `limit`? | to-dos in every space the grant reaches, or `space`'s, each with an `at` (`path#line:hash`) the other task tools take back (docs/tasks.md 5.15) |
| `add_task` | `text`, `fields`?, `note`?, `under`?, `space`? | a line in the space's inbox, or in `note` under the heading `under` (made where missing); `text` may carry the Tasks plugin's marks, `fields` what `update_task` takes |
| `update_task` | `at`, any of `done`, `status`, `text`, `due`, `time`, `scheduled`, `start`, `deadline`, `priority`, `recurrence`, `remind`, `duration`, `assignee`, `tags`, `move_to` | one edit of the note; `done` ticks the way the Tasks plugin does, a recurring task's next line written above it (`next` in the answer); `""` takes a field off; `move_to` takes the task and what is under it to another note or heading |
| `query_base` | `path` or `yaml`, `view`? | a view's groups, rows (the columns it shows) and summaries |
| `add_row` | `base`, `properties`?, `title`?, `view`? | a note made where the base's filters look (`file.inFolder`, `file.hasTag`, `prop == "value"`), from its template |
| `edit_rows` | `paths`, `properties` | front matter on several notes, an edit each |
| `edit_base` | `path`, `ops`: `add_view`, `edit_view`, `remove_view`, `set_filter`, `add_formula`, `add_property` | the base written back as the YAML it was, every key no op names kept |

The task tools are the agent's own edits of a note, read off it as it is on screen and
written with `writeNote`, so the review keeps or undoes them and one undo takes a tick
and its next occurrence back together. What a call means is `@nib/bases/agent`, which
the account connector shares (`services/sync/src/mcp/tasks.ts`); the list, add and
tick the reader's own surfaces use (the AI sidebar, the glasses, the widget, a share)
are `lib/task-actions.ts`.
| `create_note` | `path`, `kind`?, `content`?, `url`?, `open`?: false | never over an existing file. A note, or by the path's ending or `kind` a canvas (a blank plane, or the JSON Canvas sent), a page note (a page of the reader's paper) or a web note (a shortcut to `url`) |
| `list_versions` | `path` | the versions, with who wrote each (8.5) |
| `restore_version` | `path`, `version` | asks first (9.3) |

### 5.4 The rest of the workspace

| tool | arguments | what it does |
| --- | --- | --- |
| `move_file` | `path`, `to` | rename or move, every link rewritten, as the tree's own rename |
| `recently_deleted` | `op`: `list`, `restore`; `id` | Recently deleted as the panel lists it, as far as the grant reaches, and one thing put back where it was, as the panel's Restore does. Nothing is deleted for good |
| `trash_file` | `path` | to Recently deleted, which is undoable, so it is not "deleting for good"; a file in front of the reader needs `workspace.focus`, since its tab closes, and one in a tab behind it does not |
| `create_folder` | `path` | |
| `workspace_tabs` | `op`: `list`, `open`, `new`, `rename`, `save`, `close`, `split`, `focus`; `tab`, `path`, `url`, `view`, `kind`, `content`, `shell`, `cwd`, `name`, `background`? | `open` a file, a page (`url`), the graph, the scratchpad or Settings at a `section` (`view`; Settings is a sheet, always in front; the scratchpad is its card, never a tab, and takes the keyboard only with `background` false); `new` a tab with no file of any kind - a note with its words, a canvas, a page note, a web tab on `url`, a terminal in `shell` and `cwd` - the plus pressed for the reader; `rename` a tab, which for a file is the tree's own rename (links rewritten, one step to undo, every store kept by path told through `file-ops.ts`) and for an unsaved tab the name it will be saved under; `save` an unsaved tab at a path, as Save does. Everything lands behind the tab in front, beside the selected one, unless `background` is false; that, `focus`, `split`, the graph, closing the tab in front and another space need `workspace.focus`, because they change what the reader is looking at. A denied site opens in no tab |
| `bookmarks` | `op`: `list`, `add`, `remove` | |
| `list_spaces` | - | the spaces this agent may reach |
| `read_canvas`, `edit_canvas` | `path` or `tab`; `ops`: `add_card`, `edit_text`, `move`, `connect`, `remove`, and in a page note `add_page`, `remove_page`, `move_page` | a canvas or a page note as JSON Canvas, edited object by object, a tab drawn and never saved included; a page note read as its pages and each card's page (8.7) |
| `read_pdf` | `path` or `tab`, `pages`? | a PDF's text (`papers.rs`) |
| `pdf_highlights` | `path`, `op`: `list`, `add` (`quote`, `page`, `colour`, `comment`) | |
| `read_setting`, `write_setting` | `key`, `value` | an allowlist of keys (8.8); writing asks |
| `capture_to_note` | `tab`, `note`?, `as`: `clip`, `screenshot`, `pdf`, `link`; `under`?, `full_page`?, `folder`?, `space`? | a page into a note, from an agent's tab or the reader's: the clipper's markdown with `source:`, a screenshot or a PDF kept beside the note and embedded, or the address; answers the note |
| `run_terminal` | `command`, `cwd`? | only when the terminal tab exists, and only with `terminal` (8.9) |
| `read_terminal` | `tab`, `lines`? | one of the reader's terminal tabs as words: scrollback and screen, wrapped lines joined, marked as the terminal's; one not shown since a restart answers the lines it came back with. `context` (8.9) |
| `type_terminal` | `tab`, `text`?, `enter`?, `keys`?, `wait_ms`? | one line typed into the reader's own shell, Enter unless told otherwise, then named keys (`Ctrl+C`, the arrows, `Tab`...); answers what it printed until it went quiet. `terminal`, and it asks like `run_terminal` (8.9) |
| `run_command` | `id` | one row of the palette's registry, as `nib commands run` does; never the rows only somebody at the keyboard may press (`byHand`: recording, the camera, dictation, signing out), and the rows that publish, share or change settings ask (9.3) |
| `attach_agent_log` | `note`, `session`? | this session's log, written into a note (9.5) |
| `approval_status` | `id` | what the reader answered (9.3) |

`capture_to_note` is the one no browser agent has, and it is the reason to do research in
nib rather than beside it: the page, the screenshot and the source land in the space the
reader is working in, as files that sync.

**As built** (`lib/agents/workspace/capture.ts`, and the crate's `agents_capture` in
`src-tauri/src/agents/capture.rs`). The window writes the note; the crate reads the page,
an agent's own out-of-sight tab and the reader's alike, through the gate every browser verb
goes through: the agent's own tab with `browser`, the reader's with `browser.reader` in a
space it reaches, never another agent's, and the reader's pause, a dialog the page holds, a
denied site and the stop answer exactly as they do for a press.

- **Clip**: the clip button's own script (`web_tabs::reader`), run in nib's world and not
  the page's, its markup unvalued the way `browser_read`'s is (no password field, no
  field's `value`), and made markdown by the clipper's converter in the window. So a clip
  of an agent's tab is the words a clip of the reader's would be, and `browser_read` as
  `article` is those words too.
- **Screenshot**: `browser_screenshot`'s picture, every filled secret field grey, refused
  while a password field has the keyboard; the tab as it shows, or all of it with
  `full_page`, as Playwright MCP and DevTools MCP offer it.
- **PDF**: `Page.printToPDF` on the reader's own paper (Settings' page setup, A4 and
  20 mm to start, as their own PDF export), backgrounds on, none of the browser's header
  and footer, the way Browser Use's `save_as_pdf` prints. A page holding a filled secret
  field is not printed (`password_field`): a printed field is its bullets, which say how
  long it is, and nothing can paint over a PDF.
- **Files, not bytes.** The picture and the PDF are kept in the reader's Attachments
  folder and embedded, `![[page-....png]]`; the agent is answered the note's path, as all
  three of those tools answer a file's path. The answer is marked as the page's
  (`untrusted`), because the note is named after what the page calls itself.
- **The log** has the call once, as `capture_to_note`, filed by the crate's own code:
  a refused print is `error (password_field)`, not the window failing.
- **Where the engine has no road** (the system's engine on a Mac and on Linux), a reader's tab is clipped
  the clip button's way and nothing is photographed or printed that could not be painted
  over; a reader's page put away to give the memory back is clipped as its address, as
  the button clips it. A reader's tab behind another one has no picture.
- **Measured** by `scripts/capture-probe.py`, end to end over `nib mcp`: a clip 35 to
  45 ms, a picture 120 to 145 ms, a PDF 115 to 130 ms, a refusal 8 to 12 ms. It proves
  the note's words are `browser_read`'s article words with no field's value, that the
  page saw no script and no global of nib's while it was clipped, the password field grey
  pixel for pixel in a picture of an agent's tab and of the reader's, the PDF on A4, and
  another agent's tab not there. It also shows what is still to do: the picture's secret
  scan is `browser_screenshot`'s own, which looks for the fields from the page's world,
  so a page that patched `querySelectorAll` sees a picture being taken.

---

## 6. Agent tabs: the page nobody sees

### 6.1 Out of sight, not hidden

The spike's answer, and the rule: **an agent's page is shown to the engine and never to the
screen.** A webview at (-10000, -10000) inside the window, `IsVisible` true, clipped to
nothing by the window it is a child of. The engine sees a visible page at a desktop size, so
it paints, runs its timers, answers input and takes screenshots exactly as a tab in front
does. The spike's numbers are in section 3.

Three things follow and are part of the design, not the spike:

- **Never in the tab strip, never in the window's list of pages.** Its label is `agent-`,
  which nothing that looks for a reader's page (`web-`, `is_page`) matches, so the overlay
  hiding, the cookie pass at close, the parking and the tab strip never see it.
- **A size of its own, independent of the window.** 1280 by 800 CSS pixels by default,
  asked for per tab, because a page lays itself out for the width it has and an agent
  reading a phone layout because the reader's window is narrow is an agent reading the
  wrong page.
- **Where it lives when the window does not.** On Windows and Linux the app ends with its
  last window, and the agent's pages are children of that window. While an agent is
  connected, closing the last window hides it instead and says so once, with the stop and
  a Quit in the tray (open question 6). Minimising the window is measured in section 3.
- **In the reader's first window, not a window of its own.** `agent-core` measured the
  alternative, a window nobody ever sees, by hiding the window the agent's page lives in
  (never activated, never on a screen): the page kept `requestAnimationFrame` at 54 to 58
  and the 10 ms interval at 100 a second, `visible`, and answered presses; minimised, 57
  and 100. Screenshots answered in all three, in 60 to 580 ms.
  So the engine does not decide it; the app's own life does. nib ends with its last
  window and a quit asks every window about its unsaved notes, and a window of the
  agents' own would be a window that never answers and an app that never ends - where
  hiding the reader's window into the tray (above) keeps the pages alive with none of
  that, and measured at full speed.

### 6.2 Quiet

Built on `about:blank` with, before anything loads: the engine's dialogs, context menu,
status bar, zoom control, accelerator keys, general autofill and password saving off,
sound muted, developer tools off (the protocol still answers: measured), no focus at
build, and no window ever granted to the page. Each of those is a window of the engine's,
a key taken from the reader or a sound, and each is the page reaching the reader. The
agent hears about all of them instead:

| what the page does | what happens | how, on `WebView2` |
| --- | --- | --- |
| `alert`, `confirm`, `prompt`, `beforeunload` | held open and reported in every result until `browser_dialog` answers; an `alert` is accepted after 30 s unanswered, a `confirm` or `prompt` dismissed | `ScriptDialogOpening` with a deferral, default dialogs off, and every script the runtime registered taken back before the page loads, as a reader's tab's are (`web_worlds.rs`); measured for all four: each held, reported with its message and answered by the agent, in about 190 ms |
| opens a window (`target=_blank`, `window.open`, a sign-in popup) | another agent tab of the same agent, with `window.opener` kept, so OAuth popups work | `NewWindowRequested` held with a deferral and answered with a new agent webview's engine, since Tauri's own answer can only be a window |
| asks for the camera, the microphone, where you are, notifications, the clipboard | refused, and said in the result; never a bubble in front of the reader | `PermissionRequested`, denied |
| a download | into the agent's own downloads folder (`Downloads/nib agents/<agent>`), listed by `browser_downloads`, at most 500 MB a file | `DownloadStarting` on the agent's page: the path set, the engine's flyout off (`Handled`), the size watched and the download cancelled past the ceiling; the same names and folder rules as `downloads.rs` |
| a file chooser | never shown: answered by `browser_upload` or cancelled | `Page.setInterceptFileChooserDialog` |
| `window.print()`, `showPicker()` | nothing | the engine raises no event for either and has no setting, so an agent's page gets one document-start script in its own world making `print` and the pickers' `showPicker` do nothing: the one thing about a page an agent tab changes |
| full screen | nothing: no handler, so the page is full screen inside its own 1280 by 800 | `ContainsFullScreenElementChanged` not listened to |
| basic authentication, a client certificate | refused, and said; the agent asks for a takeover | `BasicAuthenticationRequested`, `ClientCertificateRequested` |
| a `<select>`, a date or colour picker | never opened natively; `browser_select` and `browser_type` set them through the page | the tools do not click them |

### 6.3 Which store

**The reader's by default, and the agent's own when asked.** The reader's store is the
whole point of an agent in nib: signed in where the reader is, the way Claude in Chrome and
Atlas work in the person's own browser. But Atlas's logged-out mode exists for a reason:
an agent reading an untrusted page while signed in to the reader's mail is the injection
risk at its worst (9.6). So:

- `browser_open` takes `store`: `reader` (the store the reader's tabs of that space use:
  global, the space's own or the site's, as `web-data.ts` decides), `agent` (a store of the
  agent's own, `web-stores/agent_<id>`, signed out until the agent or the reader signs in
  there, kept across runs), or `space` (another space's store, with that space granted).
- **Never the reader's extensions** (Emil, 2026-10-03). An extension is installed into a
  profile and neither engine has a per-page switch, so a page in the reader's own store
  runs every extension they installed - a password manager filling in the agent's page,
  an ad blocker changing what it reads, anything with `<all_urls>` reading what it reads.
  So `reader` and `space` mean that store's **twin**: a profile of its own
  (`agent__twin`, `agent__twin_<store>`) with extensions off, handed every cookie of the
  reader's store - partitioned ones in their partition - each time an agent's page is
  built there, and nothing ever handed back (`src-tauri/src/agents/twin.rs`). Signed in
  where the reader is, with none of their extensions near it; what a cookie does not carry
  (a login kept only in `localStorage` or `IndexedDB`) is signed out, and a site that
  rotates its session on every use can sign the reader out when the agent uses the copy -
  Playwright's `storageState` has the same two edges. Emil has not chosen between this and
  **blocking**, where an agent's tab is never in the reader's store and opens in its own,
  signed out, saying so in the answer; `engines::READER_STORE` is the switch, the twin is
  the default, and `NIB_AGENT_READER_STORE=blocked` turns one run to the other. Measured
  (`agent-tab-probe.py`, both engines): a cookie the reader's tab set is in the twin's
  page, and the agent's own cookie never reaches the reader's tab.
- A site can be set to **agent store only** in the agent's grant (mail, banking), and the
  grant's default can be flipped for a cautious agent.
- On `WebView2` an agent store, and a twin, is a user data folder of its own, so a browser
  process of its own while one of its tabs is open (about 100 MB), and nothing after. On
  nib's own Chromium each is a profile in the one browser process. That same fact
  is the one place an agent's pages could have switches of their own - but nothing in
  section 3 needs one.

### 6.4 How many, and when they go

- **Four tabs an agent, eight in all**, by default. `browser_open` beyond that parks the
  agent's least recently used tab: the webview closes, its address and trail are kept, and
  the next call on it builds it again. The same parking the reader's tabs have
  (`pages.svelte.ts`), for the same reason: one page is about 180 MB on this machine.
- **A tab nobody has called for ten minutes is parked**; an agent that disconnects has its
  tabs closed after the same ten minutes, so a reconnect finds them.
- **A memory ceiling**: when the engine processes under the app are past 3 GB of working
  set, `browser_open` is refused with the reason rather than making the reader's machine
  slow.
- Measured in the spike: two agent pages added two engine processes and 83 to 100 MB of
  working set on a small page; closing them gave it back (section 3).

### 6.5 Popups that are the engine's own

A `<select>`'s list, a date picker, an autofill list and the engine's own bubbles are
windows of the engine's browser process, placed on screen relative to the page. The page
is 10,000 pixels off the window's corner, which is off every screen anybody has, and the
tools never open a native picker (6.2). Chromium may pull a popup into the nearest
screen's work area, which is why this is a rule for the tools rather than a hope about the
position, and why the probe watches every engine process's windows and the lane's tests
keep doing so (section 12).

### 6.6 Watching

**The agent's page is never on screen unless the reader asks, and then it is a picture.**
The activity panel (9.5) shows each agent tab as a live thumbnail: the engine's screencast
(`Page.startScreencast`, JPEG, a frame at most every 200 ms, 480 pixels wide) drawn into an
`<img>` while the panel is open and not at all when it is closed. A picture, because a
picture takes no input: watching can never be interacting by accident, and the reader's
pointer over it is the reader's pointer over nib. The page keeps rendering out of sight, so
the frames are real; a hidden page would have none (section 3).

### 6.7 Showing

**Show** on a thumbnail, or the agent's `browser_show`, makes an agent tab a tab of the
reader's, beside the one in front, **without loading it again**: it is already a child of
the window, so showing it is placing it where the pane is. What changes is whose strip it
is in: the listeners of a reader's tab are attached (keys, page-first, full screen,
permissions), the engine's dialogs, context menu and developer tools come back, and the
agent keeps acting in it as in any reader's tab, with the frame (7.1), under either id.
Nothing is ever handed back: a reader's tab is the agent's as much as its own are (7.3).
On nib's own Chromium, where an agent's page has no window to move (12.1), the reader's
tab loads the address again.

---

## 7. Acting in the reader's own tabs

### 7.1 Seen, and quiet about it

While an agent is acting in a tab the reader can see:

- **A thin frame round the page, in the accent**, 2 pixels, drawn by the pane around the
  hole: the page's bounds shrink by the frame and nothing is drawn over the page, because
  nothing of the app's can be (`web-tabs.md`, "A native webview draws above every pixel").
  Comet's outline and Atlas's highlight, said as quietly as nib says anything.
- **The agent's mark on the tab**, in place of the site's while it acts, turning like the
  loading mark; the tab's menu holds **Stop**, which stops that agent, and **Resume** once
  it is stopped. No words.
- **The element about to be pressed is lit** by the engine's own inspector highlight
  (`Overlay.highlightNode`) for 300 ms before the press. It is drawn by the renderer, not
  put into the page, so the site's scripts cannot see or move it.
- **Nothing else.** No bar, no banner, no toast. The activity panel has the detail.

A reader's tab that is not on screen is acted in the same way and wears only the mark.

### 7.2 Never the keyboard, never the window

Every action is the engine's own protocol on that one webview, which moves neither the
system's pointer nor its keyboard: the spike pressed, typed and asked for focus from inside
the page, and the window in front and the app's focus window never changed. The agent has
no verb that raises, focuses, moves or resizes the window, and `workspace_tabs` opens
behind the tab in front unless it holds `workspace.focus`.

### 7.3 Shared, never taken

Emil, 2026-10-05: *"an agent should be able to use any of a user's tabs, and it should not
lose access just because the user does something in it."* The first build paused an agent
on a tab the moment the reader pressed or typed in it, until the reader pressed its mark to
give it back - `GotFocus` on `WebView2`, and on nib's own Chromium the window asked ten
times a second which page had the keyboard. All of it is gone, and so are Take over and
Give back in the tab's menu and the `paused_by_reader` answer. Nobody that does this well
locks the tab: Claude in Chrome, Comet, Browser Use and Playwright MCP's extension share it
and re-read the page every step; Atlas's "take control" is the mode switch people wait on.

- **One page, two people.** The reader's press, scroll or key is the page changing, as a
  page changes by itself. The agent's next call reads it as it then is: a ref whose element
  went is `no_such_ref` and a new snapshot, and every act answers where the page is after
  it.
- **The same field at the same moment.** Nothing locks, and nothing needs to. An agent's
  words are one `Input.insertText` and a key one event, put into the page's own input
  queue between the reader's keystrokes, never inside one; whichever lands last is what the
  field says, and both see it. Locking the field instead would make one of them lose
  without being told; this way the agent learns from its answer and its next read, and the
  reader sees the frame and the agent's mark, and has the stop. A key the agent presses
  goes to the element with the page's keyboard, so it re-reads before pressing one in a tab
  the reader is typing in - and a key that changes words is refused outright in a password
  field (`password_field`), which in a reader's tab may be the one they are typing their
  own password into (9.4).
- **Any tab, out of sight too.** A reader's tab behind another one, in a space out of sight,
  or parked to give memory back has a page that is hidden, frozen or not there at all, and
  a hidden page answers a press after five seconds or never (section 3). So before each
  call the crate asks the window to lend it the tab (`agent.lend`): the page is built where
  there is none, thawed where frozen, and shown to the engine outside the window - out of
  sight, never on a screen, the way a page being photographed as its tab is left already
  is - until the agent's mark on it lapses, when it is hidden and counts down to being
  frozen again. The reader showing the tab meanwhile shows it as ever.
- **The stop is the reader's one control**: the key from any app, the tray, every
  indicator, and **Stop** in the tab's menu, which stops that agent the way its row in
  the activity panel does (9.5); a press on a stopped agent's mark resumes it.
- **`browser_takeover`** is the agent asking for a step only the reader may do - a sign-in,
  a captcha, a payment: the reason is one line under the tab's bar, with **Done**, and a
  notification. The agent is not paused and gets nothing handed back: it carries on, waits
  for the page to change (`browser_wait`), or asks `approval_status`, which says `done`
  once the reader pressed Done. A password field is never readable through any tool (9.4),
  so what the reader types there is theirs whoever else is in the tab.

### 7.4 One session, one holder

Under sync v2 a site's login is a lease: one device holds (store, site) while it is in use
(`sync-v2.md` 6.2). An agent's tab in the reader's store needs the same lease, and the
agent's activity counts as the device being active, so a laptop does not hand the session
to the desktop in the middle of an agent's job. An agent never takes a lease another device
is actively using: `browser_open` answers `in_use_elsewhere` with the device's name, and
the agent can wait, or use its own store. An agent store is not synced and needs no lease.

As built (lane `web-lease`): an agent never acquires or takes a lease at all. It cannot press
Use here on the reader's behalf, and an ask of its own would be a handover the other
computer's person was never asked about the moment they stepped away. So the window tells
the crate which sites another computer holds (`web_lease_elsewhere`, see
`src-tauri/src/agents/leases.rs`), `browser_open` refuses those, an agent at work counts as
somebody at this computer (`web-tab/activity.ts`), and a site this computer has never asked
about runs on its own state, as the reader's pages do while the hub is out of reach.

---

## 8. Notes and the rest of the workspace

### 8.1 What an agent reads

`read_note` reads through `noteText` (`workspace/note-text.ts`): an open note is read from
the editor, unsaved words and all, and a closed one from disk. With `include` it also
answers the note's outline, properties, tasks, links, backlinks and blocks, which the
automation answers already compute (`automation/answers.ts`), and for the note in front the
selection, the caret and the lines on screen, so "rewrite this paragraph" means the
paragraph the reader means. Every answer carries `rev`, which changes with every edit, and
an **anchor** for every heading, block and task.

### 8.2 Anchored edits, applied as a transaction

The one thing an agent must never do to an open note is what `writeFile` in
`automation/acts.ts` does today: read the whole note, wait, and write the whole note back.
The wait is where the reader's typing goes. `replaceInNotes` has the same shape: it reads
`before`, awaits a snapshot and a write, and then hands the open document edits measured
against `before` - so a word typed during those awaits is under positions that no longer
point where they did. For a person that window is a moment after a press; for an agent
writing every few seconds while the reader types, it is the whole afternoon.

So an agent's edit names **what** it changes, not where:

| anchor | resolves to |
| --- | --- |
| `{quote, prefix?, suffix?}` | the one place those words are, with the words around them to tell two apart (the W3C Web Annotation text-quote selector) |
| `{heading: "Plan/Later"}` | the section under that heading, by its path |
| `{block: "idea"}` | the block named `^idea` |
| `{task: "Buy milk"}` | that task's line |
| `{selection: true}` | what the reader has selected |
| `{start: true}`, `{end: true}` | where the words start (past the front matter), and the end |

A heading's section is its own line down to the last words before the next heading at its
level or above, and `Plan/Later` finds Later anywhere under Plan (a slash in a title is
`\/`). A block is the run of lines round its `^name`, the way `[[Note#^name]]` reads it,
and a replacement keeps the name. Several headings or tasks with one name are told apart
by `nth`, which `read_note` hands out only where it is needed. Words put before or after a
task are a line of their own, before or after a section or a block a paragraph of its own,
at the end a paragraph after the last one, the way somebody adding one more presses Enter
first; beside a quote or the selection they are just words.

**Resolved and applied in one synchronous step on the window's thread**, against the
editor's state at that moment: the anchors are found, the edits built as one change set,
and dispatched as one transaction annotated as the agent's (`userEvent: "agent"`). Nothing
can happen between resolving and applying, so there is no window for the reader's typing
to fall into. An anchor that is not found, or found twice, is an error naming it, and the
agent reads again. `if_rev` makes the whole call refuse if anything changed since the
agent read, for the agent that wants that.

A closed note is edited the same way on its text, and then written; `replaceInNotes` gets
the same fix for the open note it happens to be showing (map the edits through whatever
changed since `before`), which lane `agent-live-docs` owns because the person's own
replace-all has the same hole. Fixed: the open document remembers its last few hundred
changes (`SharedDoc.carried`), so a replacement lands on the words as they are, keystrokes
typed since the read included, and the note is written as it then stands.

### 8.3 The reader's typing wins

If the reader has typed inside the range an agent's edit would change within the last two
seconds, the edit waits until they have paused for two seconds, and is then resolved and
applied against what they wrote; if its anchor no longer resolves, the agent is told
`reader_edited_here`. Edits elsewhere in the note land at once, with the reader's caret
where it was.

### 8.4 Where the agent is

**A caret, the way a collaborator's is**: the agent's name on a small flag in its accent,
at the place it last edited, fading after three seconds of nothing. It is the room's own
caret (`packages/editor/src/carets.ts`), given a peer the window makes up for the agent,
so it looks and moves exactly like a person's in a room. A note the reader is not looking
at wears the agent's mark on its tab while the agent writes in it.

### 8.5 Undo, and the versions

- **Every agent edit is one undo step of its own** (CodeMirror's `isolateHistory`), so
  Ctrl+Z after an agent's paragraph takes the paragraph away and not also the sentence the
  reader typed before it. It is Ctrl+Z like anything else; there is no second undo stack to
  learn.
- **Undo the agent's edits** in the activity panel and the palette takes back everything
  one agent did to one note in this session, **mapped through what the reader did
  since** (each transaction's inverse, mapped through the later changes), so the reader's
  own words stay.
- **The version before an agent's first edit of a session is kept**, and says who: the
  versions list shows the agent's name where it shows the device's now. `snapshot_note`
  grows a source.

### 8.6 Another space, without switching

Every automation verb that names a space switches to it today, "because the result has to
be visible" (`docs/automation.md`). That is right for a person's command line and wrong for
an agent working unsupervised while the reader is in another space: the reader's screen
would change under them. So agent verbs read and write another space without switching:
the text of a closed note, the tree, search and the link index answer for a space that is
not open, and a note open in another window of that space is edited there. `space` on a
tool never moves the reader.

As built (`lib/agents/workspace`, docs/automation.md "Agents"): the space in the window is
answered from what the window holds, and any other from the disk and the crate - its tree
by `read_tree`, its links by an index of its own built for the agent and let go a minute
after it was last asked, its search by the panel's engine asked of its root, its bookmarks
and per-space stores by its root, and a move by the crate's rename with that index's
rewrite. Only `workspace_tabs` with `workspace.focus` ever brings another space in front.

### 8.7 Canvases, page notes, PDFs

A canvas and a page note are already a Yjs map of objects by id (`packages/rooms/src/
plane.ts`), so an agent's canvas edit is an operation on that map, applied through the same
binding a room uses, and it merges with the reader's own drawing object by object.
`read_canvas` answers JSON Canvas, which is the file format. A page note is the same file
with pages among its objects (docs/pages.md), so it is read as its pages in order - their
paper, ruling, a PDF page behind one, how much ink - and every other object with the page it
starts on, laid out in the column the reader sees. Its pages are the page menu's own three
operations (`@nib/markdown/pages`): a page put in after another takes that one's size and
ruling, a page taken out takes what is written on it, and the last page is never taken
away; a card given a `page` is measured from that page's corner and lands under what the
page holds when it says no place (`lib/agents/workspace/pages-ops.ts`). A canvas or page
note drawn in a tab and never saved is reached by the tab, and edited on the surface
like any drawn one. A PDF is read through
`papers.rs` and its highlights through `highlights.rs`; an agent's highlight is anchored by
its quote, like a person's.

### 8.8 Settings

A short allowlist, read freely and written only with `settings` and a question (9.3): the
theme, the language, the editor's options, a space's web data choice. Never the account,
the sync, the AI keys, the agents' own grants, or anything in `automation.json`.

### 8.9 The terminal

`run_terminal` is its own capability, off unless granted, and in unsupervised mode still
asks for any command not on the agent's list of allowed programs. A terminal is the whole
machine, which is more than everything else in this document put together.

**The reader's own terminals** are tabs like any other (`lib/agents/workspace/
terminal-tab.ts`), what "look at my terminal" and "restart the server" are about. VS Code's
agent reads a terminal's output and JetBrains' asks before every command it types; nib does
both. `read_terminal` is the screen as words, under `context` because it is what the reader
sees. `type_terminal` is the reader's shell, so it is `terminal` and asks the same way: one
line whose program is on the agent's list, ended with Enter and nothing else, goes; a
second command, a line with no Enter (whose Enter could come in the next call, with no
command left to judge), and every key but an interrupt ask (`terminal-keys.ts`). A tab made
behind the one in front, or put back by a restart and not looked at since, has no shell
until it is shown; typing into one starts it off every screen, at a size of its own, and
the pane fits it the first time the tab is shown. The answer is what it printed until it
went quiet for a moment, so an agent rarely has to read again.

### 8.10 Under sync v2

Sync v2 makes every note a Yjs document on every device (`sync-v2.md` 5.1), and the
editor's binding to it already exists (`rooms/bind.ts`). Then an agent is **one more peer
on the note's document**: its edits are Yjs operations under a client id of its own,
anchors resolve to Yjs relative positions (which is how carets already travel in a room,
`rooms/peers.ts`), undo is Yjs's `UndoManager` tracking the agent's origin, and the agent's
caret is ordinary awareness. Nothing in 8.2 to 8.5 changes shape; what changes is that the
agent's edits merge with another device's as well as with the reader's, because they are
the same kind of thing. Lane `agent-live-docs` builds 8.2 to 8.5 on today's editor first,
behind an interface the Yjs peer replaces, and moves when `sync-client-engine` lands.

**The seam.** `lib/agents/docs/index.ts` is `NoteDocs` - `readNote`, `editNote`,
`writeNote`, `undoAgent` - over a `Desk` (`desk.ts`: the note's words, the note in front,
the one write path). On today's editor the open note is the document's shared state: one
CodeMirror transaction per call (`userEvent: "agent"`, `isolateHistory`, a mark the
history carries through `invertedEffects`), `SharedDoc.touchedWithin` for the reader's
last two seconds, `Track` and `Steps` for undoing one agent's edits (the history's own
bookkeeping over one agent), and `setAgents` on the room's caret layer. The Yjs peer is a
second `NoteDocs`: `editNote` resolves the same anchors against the `Y.Text` and applies
them in one `doc.transact(fn, origin)` under the agent's own client id; `Track` becomes an
`UndoManager` with `trackedOrigins: new Set([origin])`; the caret becomes the agent's
awareness state; the reader's last two seconds are the updates of the reader's own origin,
kept as relative positions. `anchors.ts`, `edits.ts`, `read.ts` and `rev.ts` stay as they
are.

---

## 9. Safety and permissions

### 9.1 An agent is a grant

**Settings > Agents** lists them. An agent is added the first time a client connects
through `nib mcp`: a bubble in nib - the client's name as it gives it (`Claude Code`), its
mark, **Don't allow** and **Allow** - the same bubble a site's question is asked in. Allow
makes a token for that client, kept by `nib mcp` in the app's config folder under the
client's name, so the question is asked once per client. A pasted token (for a client on
another machine, or a script) is the same grant made by hand.

Each agent holds:

| part | what it is | Emil's default |
| --- | --- | --- |
| scopes | `context`, `notes.read`, `notes.write`, `tree`, `workspace`, `workspace.focus`, `browser`, `browser.reader`, `browser.script`, `browser.network`, `browser.storage`, `settings`, `terminal` | all but `browser.script`, `browser.storage`, `settings`, `terminal` |
| spaces | which spaces it may reach; another space's tabs and notes do not exist to it | every space |
| sites | allow, deny, and "agent store only", by site (registrable domain, as `siteOf`) | none set |
| mode | `unsupervised` or `confirm` | unsupervised |
| asks | the categories in 9.3, each on or off | all on |
| limits | tabs, calls a minute, pages a minute | 4 tabs, 600 calls, 60 navigations |

A third-party agent starts with `context` off, `browser.reader` off and `confirm` mode.

The AI sidebar's own agents (one built-in grant per provider, "nib · Claude") ask as the
thread's mode says rather than as the grant does (docs/ai-sidebar.md 4.4), so Settings >
Agents shows them no "Asks first": Approve lays `confirm` with every category on over the
grant for each call, and Agent a third mode, `autonomous`, that asks for nothing but
paying and is never kept on a grant. A Claude Code or Codex session of the sidebar's
proves itself with a token lent for its thread's mode, so the endpoint knows which.

### 9.2 Sites

A denied site cannot be opened, navigated to, or acted in, in an agent tab or a reader's;
a navigation the page itself makes to one is stopped and reported. `browser.script` is per
site on top of the scope, because running script in a page is running as that page.

### 9.3 What it always asks first

In both modes, unless the reader turned the category off for that agent (and in the AI
sidebar's Agent mode, `autonomous`, only paying):

| category | how it is recognised, without trusting the model |
| --- | --- |
| **paying** | a press in a form with a card number, expiry or security code field (`autocomplete="cc-*"`, or a field whose label reads as one), or a press whose accessible name reads as paying (`Pay`, `Buy`, `Place order`, `Checkout`, `Confirm purchase`, in every language nib has a catalogue for), or a request to a known payment processor's host |
| **sending** | from the page, on any site: a press named `Send`, `Post`, `Reply`, `Publish`, `Comment` (every language) beside a message box - a `<textarea>` or an editable region that is no search box - or beside somebody to send to (an address or phone field, a field labelled To, Cc or recipient, an @-mention in the box); `Submit` beside a message box; any submit of a form that holds both; Enter or Control+Enter in a box that calls itself a message, a reply, a comment or a chat. A site on the mail, messaging and social list is one more signal. A search, a sign-in and a newsletter's Subscribe are none of these, and the tests hold them apart |
| **publishing and sharing** | anything in nib that puts words where somebody else can read them: publishing a space or a note, sharing a space, a room's door, a guest link; the palette's rows for them through `run_command` |
| **deleting for good** | a press named `Delete`, `Remove`, `Erase` on a site; emptying Recently deleted; `restore_version` over a note |
| **signing in** | any password field - by its type, its `autocomplete`, or masked by the page, so a show-password toggle is no way round - or a sign-in form: a takeover (7.3), never typed and never submitted. A press that submits one, Enter in one, and a press named `Sign in` beside a password field answer `password_field` |
| **settings** | `write_setting` |
| **the terminal** | any command not on the agent's list, in a shell nobody sees or typed into one of the reader's terminals; any key but `Ctrl+C` |

A call that needs asking answers at once, `{"status": "needs_approval", "approval": "a17",
"summary": "Place order on shop.example"}`, so an unsupervised agent can carry on with
something else rather than hold a connection open for an hour. The reader sees one system
notification and the question in the activity panel (the site's mark, the summary,
**Don't allow**, **Allow**, and **Always on this site**); `approval_status` tells the
agent. Unanswered questions expire after a day. In `confirm` mode every write asks the
same way, batched: an agent's ten form fields are one question.

Recognising these from the page rather than from the agent's own account of what it is
doing is the point. An agent that has been talked into buying something will describe the
press as whatever it was told to; the card field is still a card field.

### 9.4 Credentials

The agent never types a password and never reads one: `browser_type` refuses a password
field, a screenshot of a page with a focused password field is refused, and in every other
picture each filled secret field is painted over in flat grey; a page holding a filled one
is not printed to a PDF at all, where nothing could paint it over. Nor does it
read any other secret - a one-time code, a card's number, expiry or security code - by
any road: `browser_snapshot` writes such a field as `[filled]` or nothing, and nothing
under it (the engine's own value for a password is one bullet a character, and its words
inside the field the same, so either would say how long it is); `browser_find` never looks
inside one; a name the engine builds out of a field's value has the value taken out; and
`browser_read` and a clip carry no field's value in any shape. Signing in is a takeover, and so is
submitting a sign-in form.
The engine's password saving and autofill are off in agent tabs, so a saved password is
not filled in behind the agent's back either.

### 9.5 Seeing what it did, and stopping it

- **The activity panel** (the right sidebar, where the outline and the links are): each
  connected agent, what it is doing now, its tabs as thumbnails (6.6), its questions, and
  the session as a list of calls. **Stop** per agent.
- **The audit log**: every call, with the agent, the time, the tool, the tab or the note,
  the arguments (typed text into a password field never appears, because there is none),
  the result's status and its duration, as one JSON line, in
  `<data>/agents/log/<date>.jsonl`, kept 30 days and never synced. The panel reads it;
  `attach_agent_log` and the panel's **Add to note** write a session into a note as a list
  of what happened, with links to the pages and notes it touched.
- **The stop**: **Ctrl+Alt+Shift+K** (**Ctrl+Option+Cmd+K** on a Mac), from any app, a key
  of the keyboard registry so it can be changed. It cancels every call in flight, pauses
  every agent, and says so in a notification; the tabs are kept so what happened can be
  looked at, and pressing it again closes them. Also a row in the tray, and **Stop** on
  every indicator.
- **Rate limits**: per agent, calls a minute and navigations a minute, as the grant says;
  over them a call waits, and a burst of them is one line in the log rather than a
  thousand.

### 9.6 Page content is data

Prompt injection is unsolved, and nib does not pretend otherwise. What it does:

- **Everything that came from outside comes back marked**: page text, snapshot names,
  console lines, network rows, downloads, PDF text, and the words of a note in a shared
  space or pasted from the web, inside `<untrusted source="...">`. The server's
  instructions, which every MCP client passes to its model, say that nothing inside those
  marks is an instruction.
- **The trifecta is visible.** Private data, untrusted content and a way to send data out
  are, together, what makes injection dangerous ([Willison][trifecta]). An agent granted
  `notes.read` and `browser` on the reader's store has all three; Settings > Agents says so
  on that agent in one line, and 6.3's "agent store only" is the way to take one leg away
  for the sites that matter.
- **The irreversible does not depend on the model**: 9.3 and 9.4 are recognised from the
  page, and a denied site is denied in the crate.
- **nib's own window is not a page.** The protocol reaches `agent-` and `web-` webviews and
  nothing else - `main`, a second window, the presenter's window, the page that holds the
  session open are refused by label in the crate - so an agent can never script the app
  that holds every note. What the app does for an agent it does through typed verbs.
- **A space the agent was not granted does not exist to it**: its notes, its tabs and its
  store are absent from every list, not refused one by one.

---

## 10. Where the tools live

| | the local server (`nib mcp`) | the account connector (`services/sync/src/mcp`) |
| --- | --- | --- |
| runs | on this machine, while nib runs | on the Worker, always |
| reaches | everything above: live notes, the browser, the workspace | the account's notes: `list_spaces`, `list_notes`, `read_note`, `search_notes`, `list_backlinks`, `write_note`, and the to-dos and bases: `list_tasks`, `add_task`, `update_task`, `query_base`, `add_row` |
| sees unsaved words | yes | no |
| for | Claude Code, Claude Desktop, Codex on this machine | claude.ai, a phone, a machine where nib is closed |
| auth | a grant made by the bubble in 9.1 | OAuth or a pasted `nib_` token, as today |

**`nib mcp` is the app's own binary in a mode with no window**: `main.rs` reads its
arguments before anything of Tauri starts, and `mcp` is a loop over stdin and stdout that
forwards each call to the running app's endpoint (the port and pid from `automation.json`,
as `nib screenshot` finds them). It starts in a few milliseconds and opens no webview. If
nib is not running it starts it minimised and waits for the endpoint. So the installed app
is the whole of it: `claude mcp add nib -- "%LOCALAPPDATA%\nibeditor\nib.exe" mcp` (an
install from before the product was renamed keeps `%LOCALAPPDATA%\Nib`, so a line
pasted then still works), which Settings > Agents offers to copy. Not the Node CLI, which ships in no installer
(`docs/automation.md`); not a fixed HTTP port, which something else can be sitting on. A
client that only speaks HTTP can be given the endpoint's own `/mcp` later; nothing here
depends on it.

**The two servers share their names and shapes** for what both can do - `list_spaces`,
`list_notes`, `read_note`, `search_notes`, `list_backlinks` and `write_note`, and
`list_tasks`, `add_task`, `update_task`, `query_base` and `add_row`, are the
connector's eleven, with the same arguments, and the local ones only add to them - so a
prompt or a skill written against one works against the other, and the local server's
instructions say to prefer it while nib runs, because it sees the words on screen. Under
sync v2 a note with a document is written only by its room (`sync-v2.md` 5.3), and the
connector's `write_note` hands its text to the room's `ingest`, so a cloud agent and a
local one writing one note merge instead of overwriting each other.

**As built** (`src-tauri/src/mcp/`, std and serde only):

- **The line** is `claude mcp add --scope user nib -- "<nib.exe>" mcp` (user scope, so nib is
  there in every folder Claude Code starts in), `codex mcp add nib -- "<nib.exe>" mcp`, or
  the `mcpServers` entry for a client configured by file; `src/lib/agents/mcp.ts` writes
  all three for Settings > Agents from the crate's `mcp_program` (the installed exe, or an
  AppImage's own path).
- **Which nib.** The identifier comes from the build (build.rs reads the config the way
  tauri-build does), so a probe's `nib mcp` reaches that probe and never the reader's own
  nib. A port in `automation.json` is asked once with no credential, and only nib's own 401
  counts, before a secret or a token goes to it.
- **Pairing without holding anybody up.** `initialize` is answered at once with the
  instructions and `tools.listChanged`; the link to nib runs on a thread. A client with a
  token under `<config>/agents/clients/<client>` proves it with `agent_status`; one without
  asks through `agent_pair` twenty seconds at a time, looking between the waits for a token
  a second run of the same client was given. Until the reader answers, the one tool listed
  is `agent_status`, which says where the question stands; `tools/list` waits up to eight
  seconds for the answer (under the ten Codex gives a server to start), and the Allow sends
  `notifications/tools/list_changed`. Don't allow, and a token that stops working (the
  agent removed), are final for that run.
- **What is listed** is what the grant reaches (`browser.script` also needs a site), and of
  the window's verbs only those the running window answers, asked once with the secret
  (`verbs`). The modified times of `automation.json` and `agents.json` are read every two
  seconds; a change re-reads the grant or the endpoint and, when the list would differ,
  says `list_changed`.
- **Results are text, never `structuredContent`**: Claude Code and Codex show a model only
  the structured part when there is one, which would drop the marks. A snapshot is its tree,
  a find is snapshot lines, a screenshot an image with one line saying its words are the
  page's; `needs_approval` is not an error and says to carry on; an error is `isError` with
  its code, its sentence and, where it is not obvious, the next step. The contract's answer
  rides under `_meta["ch.emilvinu.nib/answer"]` for scripts and the harness; no model is
  shown `_meta`. The six tools shared with the connector answer in its words.
- **Starting nib**: on Windows through `cmd /c start /min` with no console, so the app's
  first window takes `SW_SHOWMINNOACTIVE` and none of the client's pipes; on a Mac `open -g
  -j`; on Linux a plain detached launch. Only at the start of a session: a reader who quits
  nib later has ended the job, and a call says so.
- `scripts/mcp-probe.py` drives all of it over real pipes against a probe build.

**The endpoint stays what it is**, with two changes: a request may carry an agent's token
instead of the installation's secret (the secret keeps meaning the reader's own command
line, with everything), and the browser verbs are answered in the crate (section 4). `eval`
is still off, and an agent's token never reaches it.

---

## 11. Performance

- **Nothing at launch.** No agent webview exists until `browser_open`; the crate's agent
  state is built on the first agent request; `nib mcp` is a process only while a client
  runs it; the endpoint's thread already exists.
- **Nothing in the first paint.** Everything the window does for agents is
  `lib/agents/`, imported on the first agent request the dispatcher sees, and the frame,
  the tab mark and the caret are a class and a peer on components that already exist.
  `weight.test.ts` holds the budget at 3,279,000 bytes and 376 modules, and the lanes add
  a test that `lib/agents` is never in that graph.
- **Nothing while idle.** The protocol's domains an agent needs (`DOM`, `Accessibility`,
  `Network`, `Runtime`) are enabled on a tab while an agent is using it and disabled after
  a minute of nothing, because an enabled `Accessibility` domain keeps the engine
  computing a tree nobody reads. `Runtime` is enabled only once an agent asks for a tab's
  console, because a page can tell that it is on (the "is devtools open" tricks read it),
  and everything else an agent does runs through `Runtime.evaluate` and
  `Runtime.callFunctionOn`, which need no domain. One timer, started with the first agent
  tab, parks what nobody used, closes what a gone agent left and puts idle pages to sleep.
- **Every verb, measured** by `scripts/agent-tab-probe.py` on this machine: `browser_open`
  90 to 105 ms; `browser_snapshot` 12 to 19 ms; `browser_find` 5 to 12; `browser_type`,
  `browser_select` and a date set 4 to 11; `browser_read` 4 to 8; `browser_navigate` to a
  local page 35; a press 150 to 200 ms and a key 140 to 160 ms, most of it the settle
  (the first press of a run up to 0.8 s); `browser_screenshot` 60 to 510 ms; a dialog
  answered 190 ms; a frame of another origin pressed 160 to 180 ms; a policy question
  answered in 5 ms.
- **Measured costs** (section 3): an agent page adds one engine process and about 40 MB
  on a small page (about 180 MB on a real one, as a reader's tab does); a snapshot of a
  small page is 7 ms and 446 characters; a click is five protocol calls and 25 ms.

---

## 12. Platforms

| | an agent's own tab | out of sight, unthrottled | reading, pressing, typing | screenshots | status |
| --- | --- | --- | --- | --- | --- |
| **`WebView2`** (Windows) | a shown child outside the window's client area | **measured** (3): 60 frames and 100 ticks a second | the `DevTools` Protocol: `Accessibility.getFullAXTree`, `Input.*` - trusted, inside the page | `Page.captureScreenshot`, 95 to 120 ms | every verb |
| **nib's own Chromium** (CEF) | a **windowless** browser: Alloy style, off-screen rendering, no native window at all | **measured**: 60 and 100, with the reader's window shown, hidden or minimised | the same protocol, through the browser's own agent (`SendDevToolsMessage` and a message observer) | the same, 105 to 155 ms | every verb on Windows; on a Mac the page is never built yet (12.1) |
| **`WKWebView`** (macOS) | none yet | **measured**: a child outside the window's content runs at the window's own rate while the window is on a screen, and stops with it minimised whatever `inactiveSchedulingPolicy` says | scripts in a `WKContentWorld`; an `NSEvent` sent to the view is trusted | `takeSnapshot`, even minimised | `unsupported_on_this_engine` |
| **`WebKitGTK`** (Linux) | none yet | **measured**: a `GtkOffscreenWindow` runs at full rate; a child outside the window's content gets no frames | scripts in a script world; script events only | `webkit_web_view_get_snapshot` | `unsupported_on_this_engine` |

Every tool answers `unsupported_on_this_engine` where it has no honest implementation,
rather than a weaker one pretending.

### 12.1 nib's own Chromium: a page with no window

`src-tauri/src/agents/engines/cef.rs`. An agent's tab is an Alloy-style browser with
off-screen rendering, which CEF makes without any native window: nothing that could be on a
screen, in front, or given the keyboard, and nothing the system can call hidden. It paints
into a buffer nobody reads at a frame rate of its own (60), is told it is shown
(`WasHidden(false)`), and is laid out at the tab's own size on a screen exactly that size at
one pixel a CSS pixel, so nothing it asks says anything about the reader's screen. CEF mixes
styles per browser, so the reader's tabs stay Chrome style beside it. Its `<select>` lists
are paints of the page too, never windows.

It is driven through the same protocol as `WebView2`'s, sent to the browser's own agent on
CEF's UI thread and answered through one observer per browser (no port, no socket), so every
verb in `browser.rs` and `page.rs` runs on it unchanged: `engines::View` is the one handle a
verb holds a page by, a webview or a windowless browser. Quiet by its own handlers: dialogs
held for `browser_dialog`, a window the page opens made another windowless agent tab with
its opener kept, permissions refused, downloads into the agent's folder under the ceiling,
the file chooser intercepted (and refused should one get past), a sign-in box and a client
certificate refused and said, no context menu, no sound, and a site the agent may not visit
stopped before it loads. A reader's tab on this engine is driven through
`engine/devtools.rs`, exactly as on `WebView2`, and nothing about who has the keyboard is
asked: the reader using a tab takes nothing from an agent (7.3).

**Only for somebody who uses agents.** Off-screen rendering is a switch CEF reads once, as it
starts, for the whole process, and its own documentation says it can cost browsers that never
render off screen. So it is on only in a run that starts with an agent paired
(`<config>/agents.json` names one); the first agent paired in a run gets its pages from the
next launch, and `browser_open` tells it so. **Show** (6.7) cannot move a page with no window
into the pane: the reader's tab loads the address again and the agent acts on there, under
either id.

Measured 2026-10-03 by `scripts/agent-tab-probe.py --chromium` through `run_probe`, on this
machine (Snapdragon X Elite, Windows 11, CEF 152 for arm64, a probe build), every check of
the probe passing, two runs:

| | the windowless agent tab | `WebView2`'s, same probe, same day |
| --- | --- | --- |
| `browser_open`, a twin's cookies handed over first | 394 ms (1.6 s the first run, the twin's profile made) | 748 ms |
| `requestAnimationFrame`, a 10 ms interval, a second | **60.0 to 60.1, 99.1 to 100.1**, visible | 60.0, 100.0 |
| with the reader's window hidden, minimised | 59.9 and 99.8, 59.9 and 100.1, visible | 60.2 and 99.1, 60.1 and 100.0 |
| the reader's own tab beside it | 59.8 to 59.9, 99.9 to 100.0 | 60.1, 99.9 |
| keys through the engine | 145 to 150 ms each, every one trusted, Enter submits | the same |
| a frame from another origin | its button `f1e8`, pressed in 160 ms | the same |
| `alert`, `confirm`, `prompt`, `beforeunload` | each held and answered, about 200 ms | the same |
| a popup | another agent tab, `window.opener` kept, the token posted back | the same |
| a screenshot, 1280 by 800 | 105 to 155 ms; an element 44 to 57 ms | 95 to 120 ms (one of 30 s, after the window was hidden and shown) |
| agent pixels in a picture of the whole window | **0** | 0 |
| the window in front, the app thread's focus | never changed | never changed |
| engine processes and working set | 9 processes and 705 MB before, 14 and 1557 MB with the tabs | 13 and 963 MB, 27 and 2059 MB |

On runners, `cef.yml` runs `scripts/agent-engines-runner.py` against the engine build of
Windows (x64) and a Mac (Apple silicon), as the reader's command line: the tab built, its
rates, a picture, a press and a key. (Linux has no engine build: `docs/browser.md` 10.)
2026-10-04: on Windows x64 the tab was built in 1.6 s (its twin's profile made), ran at 60.1
and 100.0, was photographed in 103 ms, and its press and key arrived trusted. On the Mac the
endpoint answered and `browser_open` did not: the page was never built (20 s), the same
family as the Mac's web tab that never loads (`docs/browser.md` 0) - a browser asked of
CEF's UI thread from a task posted there never arrives. Until a Mac is there to find that
wait, an agent's tab on a Mac's Chromium answers `failed` with that reason.

### 12.2 `WKWebView` and `WebKitGTK`: measured, not built

`scripts/webkit-agent-probe` puts the same page out of sight every way each engine offers,
on a runner (`.github/workflows/agent-engines.yml`), and reads its rates, a picture, a press
from an isolated world and, on a Mac, a click and a key as `NSEvent`s sent to the view.
2026-10-03, macOS 26.6 and Ubuntu 24.04 (WebKitGTK under Xvfb); frames and ticks a second:

| the page | shown | the window minimised | behind another window | |
| --- | --- | --- | --- | --- |
| Mac: a child in sight (the control) | 60, 76 | 0, 1, hidden | 59, 78 | |
| Mac: a child outside the window's content | **60, 72** | 0, 1, hidden | 59, 73 | picture 1280 by 800, minimised too |
| Mac: the same, `inactiveSchedulingPolicy = .none` set after it was built (read back as set) | 60, 73 | 0, 1, hidden | 59, 74 | |
| Mac: a `WKWebView` made with `.none` from the start, outside the content | 60, 74 | 0, 1, hidden | 59, 74 | |
| Mac: a borderless window of its own at (-10000, -10000), never key | 0, 1, hidden | 0, 1, hidden | 0, 1, hidden | the system counts it occluded |
| Mac: a child the engine is told is hidden (the control) | 0, 0.4, hidden | | | |
| Linux: a child in sight (the control) | 62, 83 | 62, 83 | 62, 83 | |
| Linux: a child outside the window's content | **0, 83**, visible | 0, 83 | 0, 83 | picture 1280 by 800 |
| Linux: a `GtkOffscreenWindow` | **62, 83**, visible | 62, 83 | 62, 83 | picture 1280 by 800 |
| Linux: a child told it is hidden (the control) | 0, 1, hidden | | | |

(The runner's timers top out near 75 to 83 ticks a second for the control as well; Xvfb has
no window manager, so its "minimised" changes nothing.)

What that says:

- **A Mac page is alive only while the reader's window is on a screen.** Outside the window's
  content it runs exactly as the window does, but minimising the window stops every page in
  it, and `inactiveSchedulingPolicy` - which governs a page WebKit thinks is *inactive* - does
  nothing for one it thinks is *hidden*: set late or from the start, the same zero. A window
  of the page's own off every screen is occluded and stops at once. So on a Mac an agent's
  page would be the reader's window's, and pause whenever the reader minimises nib.
- **On Linux the page belongs in an off-screen window**, where it runs at full rate whatever
  the reader's window does; as a child placed outside the window it gets no frames.
- **Isolated worlds work on both**: a script in a `WKContentWorld` or a script world reads and
  presses the page and cannot see a single global of the page's own. Its press is a
  script's (`isTrusted` false), which some sites refuse.
- **On a Mac, `NSEvent`s sent to the view itself are trusted** (`isTrusted` true for the click
  and the key), outside the window's content and from an off-screen window alike, and the key
  window did not change. On the runner nib's window was the key window throughout, so that is
  not yet proof that it holds for a window behind somebody else's.
- **Pictures work everywhere it was asked**: 1280 by 800, out of sight, and on a Mac with the
  window minimised.

**Why no verb runs there yet.** Keeping the page alive and driving it is shown possible. What
is not built is keeping it quiet: on both engines everything a page uses to reach a person is
the engine's delegate, which wry holds for the app's webviews - on a Mac an `<input
type=file>` opens a file panel (`runOpenPanel`), a camera request is a system prompt
(`requestMediaCapture`), `alert` returns at once unseen, a window the page opens is wry's to
make - and `WebKitGTK`'s `run-file-chooser`, `permission-request`, `script-dialog` and `create`
signals the same. An agent's page needs a delegate of nib's own on each (as `cef.rs` has
handlers of its own) before it can be opened without one of those reaching the reader, and
then the subset: the accessibility snapshot as a script in the isolated world (the logic of
Playwright's `ariaSnapshot`, Apache-2.0), presses and keys as `NSEvent`s on a Mac and as
script events on Linux (said in the answer: `isTrusted` false), pictures, navigation, waits,
`evaluate`; and no console, network log, file upload or drag, which have no road without a
protocol. Until then each browser verb answers `unsupported_on_this_engine` and says where
the browser runs.

### 12.3 The reader's logins, never their extensions

6.3: an agent's tab in `reader` or `space` is in that store's twin, on both engines that
drive pages - a profile of its own with extensions off and the reader's cookies handed in -
or, with the switch at `blocked`, in the agent's own store. Measured on both by
`agent-tab-probe.py`: the cookie the reader's tab set is in the twin's page, and the agent's
own cookie never reaches the reader's tab. `WKWebView` and `WebKitGTK` run no extensions,
so they would need no twin.

---

## 13. The implementation plan

Eight lanes on disjoint files, in three waves. Briefs are in the manager's scratchpad under
`agent-browser/lanes/`. Every lane reads this document first, follows `nib-agent-rules.md`,
and keeps the reader's window out of every probe (the family watch, every process under
the app, is in `scripts/probe_app.py`'s `run_probe`).

| lane | owns | depends on | wave |
| --- | --- | --- | --- |
| `agent-core` | `src-tauri/src/agents/` (the grant store, tokens, policy, audit log, limits, the stop; agent tabs: build, quiet, park, close, dialogs, popups, downloads, file chooser, permissions; the DevTools bridge with events; snapshot, refs, click, type, wait, screenshot, console, network), the endpoint's token check and crate-answered verbs, `web_tabs.rs`'s tab-to-label map | the spike | 1 |
| `agent-live-docs` | `lib/agents/docs/` (anchors, the transaction, typing wins, presence peer, undo of an agent's edits), the fix to `replaceInNotes`, `snapshot_note`'s source, `packages/editor` where a caret needs it | nothing for the editor path; the Yjs peer waits on sync v2's `sync-core` (`@nib/sync-core`, for `textops` and the relative positions) and `sync-client-engine` (the persisted documents) | 1, and again after sync v2's wave 3 |
| `agent-harness` | a fake agent (a scripted MCP client), scenario pages (injection, a shop, a sign-in, dialogs, popups, pickers), the family watch in `probe_app.py`, the weight guard for `lib/agents`, a nightly drive | the spike; each lane's verbs as they land | 1, running through 3 |
| `agent-mcp` | `main.rs`'s `mcp` mode, the tool schemas and descriptions, the untrusted marking, the pairing, `needs_approval` | `agent-core`'s verb contract (13.1), which it can build against a fake | 2 |
| `agent-workspace-tools` | `lib/automation/` agent verbs: tree, tabs, bookmarks, spaces without switching, search, versions, canvases, PDFs and highlights, settings allowlist, `capture_to_note`; `run_terminal` when the terminal lands | `agent-core`'s token and scope check | 2 |
| `agent-activity-ui` | `lib/agents/` UI, lazy: the frame, the tab mark, the tab's Stop, the activity panel with thumbnails, the questions, Show, the stop key in the registry and globally | `agent-core`'s events (13.1); starts on a fake | 2 |
| `agent-settings-ui` | Settings > Agents: the grants, the pairing bubble, sites, asks, mode, limits, the log viewer and Add to note, the copy line for `nib mcp`, locales | `agent-core`'s grant shape | 2 |
| `agent-engines` | CEF's windowless agent tabs; `WKWebView` and `WebKitGTK` subsets behind the same verbs, measured first | `agent-core`; the `engine` lane's CEF switch | 3 |

At most eight agents run at once and no wave needs more than five. Wave 1 can start now.

### 13.1 The interfaces the lanes meet at

- **Verbs**: `agent-core` publishes, as its first commit, `src-tauri/src/agents/verbs.rs`
  with every browser verb's name, arguments and answer as serde types, and
  `lib/agents/verbs.ts` with the window's; `agent-mcp` generates the tool schemas from
  those two files, so a verb and its tool cannot drift.
- **Events** from the crate to the window, on `nib://agent`, each with its `kind`:
  `acting {agent, tab, verb}`, `paused {agent}` (one agent stopped on its own),
  `resumed {agent}` (its stop lifted, or everybody's for an empty agent), `asked {approval}`, `answered {approval}`, `tab {agent, id, url,
  title}`, `closed {agent, id}`, `stopped {closed}`, `connected {agents}` (the agents that
  called in the last ten minutes and did not say goodbye, said whenever the list
  changes). An `acting` names a shown tab by the reader's id. The activity UI is built
  against a fake emitter of exactly these (`lib/agents/ui/fake.ts`).
- **The grant**: `{id, name, client, scopes[], spaces[] | "all", sites: {site: "allow" |
  "deny" | "agent-store"}, scripts[], mode, asks: {category: bool}, always: {site:
  [category]}, programs[], limits, created}`, stored by the crate in `<config>/agents.json`
  (0600) with each token's SHA-256 beside it and never the token, read and written by the
  settings pane through `agents_read` and `agents_write`; `agents_mint` makes one by hand
  and answers its token once.
- **The window's commands**, each answering only nib's own window: `agents_stop`,
  `agents_resume {agent?}`, `agents_answer {id, allow, always}`, `agents_ask {agent, category, summary, key}` for a window verb
  that asks first, `agents_state` for everything the activity panel draws at once,
  `agents_log {day}` with `agents_log_days` (the days there are, newest first) and
  `agents_log_clear {agent?}` (Settings > Agents' Clear), and `agents_adopt {agent_tab,
  tab}` for Show (6.7). The activity
  UI adds four: `agents_stop {agent?}` stops one agent where one is named (the panel's
  row and a tab's Stop), `agents_watch {tabs}`
  starts the screencast of those agent tabs (and stops the rest) with its frames on
  `nib://agent-frame`, `agents_shell {key, words}` hands the crate the stop's key in the
  system's notation and the words the tray and the notifications say, and `agents_hold
  {hide}` answers whether the asking window holds the agents' pages and, with `hide`,
  hides it instead of closing it (open question 6).
- **The window's verbs the crate asks**, on the endpoint's own road, each optional:
  `agent.reader_tabs` (the reader's web tabs of every space's set, with their space and
  whether in front), `agent.lend {tab}` (a reader's tab's page built or thawed and kept
  running out of sight while an agent acts in it, 7.3), `agent.store_for {space?, url}`
  (which store, as `web-data.ts` decides) and `agent.markdown {html, url}`. Without them the crate answers from what it knows: every
  reader's page it holds, the store every space shares, and the page's text.
- **The endpoint**: an agent's token reaches the crate's verbs and, from the window's, only
  the agent verbs of sections 5.1, 5.3 and 5.4, each checked against the scope it needs
  before the window hears it, with the grant handed to the window as `agent` beside the
  verb. Every call an agent makes is in its audit log, the window's verbs too.
- **The docs interface**: `readNote(path, include)`, `editNote(path, edits, ifRev)`,
  `undoAgent(agent, path)` in `lib/agents/docs/`, with the Yjs peer as a second
  implementation of the same three.

---

## 14. Open questions for Emil

Each has a recommendation, and the design above assumes it.

1. **Which store an agent's tab is in by default.** Recommendation: **yours**, so it is
   signed in where you are, with a per-site "agent store only" for mail and banking and a
   per-task `agent` store. The alternative, a signed-out store by default, is safer and
   makes most of your jobs impossible without a takeover each time.
2. **What unsupervised mode still asks.** Recommendation: **paying, sending, publishing and
   sharing, deleting for good, signing in (always a takeover), settings and the terminal**;
   everything else runs. Each can be turned off per agent.
3. **How you are asked while away.** Recommendation: **the call answers "needs approval" at
   once, you get one notification, the question waits in the activity panel for a day.**
   The agent carries on with whatever else it can.
4. **The stop key.** Recommendation: **Ctrl+Alt+Shift+K (Ctrl+Option+Cmd+K), from any
   app**, first press pauses everything, second closes the agents' tabs.
5. **When you click into a tab an agent is using.** Decided 2026-10-05: **nothing
   happens to the agent**; you and it share the tab, and the stop is how you stop it (7.3).
6. **Closing nib's last window while an agent works.** Recommendation: **the window hides
   and nib keeps working in the tray**, said once; Quit in the tray ends it. Otherwise
   closing the window ends the job and its tabs.
7. **Agent edits in an open note under Ctrl+Z.** Recommendation: **yes, each agent edit is
   its own ordinary undo step**, plus "Undo the agent's edits" for everything one agent did
   to a note, mapped around what you wrote since.
8. **The agent's caret in your note.** Recommendation: **yes**, a flag with its name that
   fades after three seconds.
9. **Scripts in pages (`browser_evaluate`).** Recommendation: **off for every agent, on per
   site when you say so.** Clicking and reading covers nearly everything, and a script runs
   as the site.
10. **What an agent sees of your screen by default.** Recommendation: **your own agents see
    the tab in front, your selection and the lines on screen**; an agent you add for
    somebody else's tool does not until you say.
11. **Showing an agent's tab.** Recommendation: **Show on its thumbnail makes it a tab of
    yours beside the one in front, without reloading**; the agent keeps working in it,
    framed, and nothing is handed back.
12. **How the local server is installed.** Recommendation: **`nib mcp`, the app's own
    binary**, with the line to paste in Settings > Agents; an HTTP address only if a client
    needs one.
13. **An agent and sync v2's leases.** Recommendation: **an agent's tab in your store holds
    the site's lease like you do and counts as you being active, and never takes one from
    another device you are using.**
14. **Engine order.** Recommendation: **build on `WebView2` now**, which the spike proved,
    and give CEF windowless agent tabs when the engine switch ships; the Mac and Linux
    subsets last.

---

## Sources

[cic-perms]: https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide
[cic-code]: https://code.claude.com/docs/en/chrome
[cic-banner]: https://github.com/anthropics/claude-code/issues/69287
[cic-groups]: https://github.com/anthropics/claude-code/issues/15436
[cic-prompts]: https://github.com/anthropics/claude-code/issues/84355
[operator]: https://openai.com/index/introducing-operator/
[atlas-hardening]: https://openai.com/index/hardening-atlas-against-prompt-injection/
[brave-comet]: https://brave.com/blog/comet-prompt-injection/
[brave-unseeable]: https://brave.com/blog/unseeable-prompt-injections/
[comet-reviews]: https://www.eesel.ai/blog/perplexity-comet-reviews
[edge-copilot]: https://blogs.windows.com/msedgedev/2025/10/23/meet-copilot-mode-in-edge-your-ai-browser/
[pw-snapshots]: https://playwright.dev/mcp/snapshots
[cdm-tools]: https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/tool-reference.md
[stagehand]: https://github.com/browserbase/stagehand
[browser-use]: https://docs.browser-use.com/open-source/customize/browser/all-parameters
[computer-use]: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
[app-schemas]: https://developer.apple.com/videos/play/wwdc2026/240/
[webmcp]: https://www.webfuse.com/webmcp-cheat-sheet
[trifecta]: https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/
[wry-1246]: https://github.com/tauri-apps/wry/issues/1246
[wv2-timer]: https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2settings.preferredbackgroundtimerwakeinterval
[wv2-suspend]: https://learn.microsoft.com/en-us/dotnet/api/microsoft.web.webview2.core.corewebview2.trysuspendasync

- Claude in Chrome: [permissions guide][cic-perms], [Claude Code integration][cic-code],
  complaints [#69287][cic-banner], [#15436][cic-groups], [#84355][cic-prompts].
- OpenAI: [Operator][operator], [hardening Atlas][atlas-hardening].
- Perplexity Comet: [Brave on indirect injection][brave-comet],
  [unseeable injections][brave-unseeable], [reviews][comet-reviews].
- Microsoft: [Copilot Mode in Edge][edge-copilot]; `WebView2`'s
  [background timer interval][wv2-timer] (prerelease only, which is why section 3 does not
  lean on it) and [`TrySuspend`][wv2-suspend].
- [Playwright MCP snapshots][pw-snapshots], [Chrome DevTools MCP tools][cdm-tools],
  [Stagehand][stagehand], [Browser Use][browser-use],
  [Anthropic computer use][computer-use], [Apple App Schemas][app-schemas],
  [WebMCP][webmcp], [the lethal trifecta][trifecta], [wry #1246][wry-1246].
