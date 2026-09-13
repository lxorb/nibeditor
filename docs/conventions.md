# Conventions

What the code is held to, and how to check it before a commit. CI runs the
same commands on every push to `main`.

## Product

- As little text as it gets. No explanatory copy; a shape, a position or a
  short word says it. Nobody should have to learn the app: it behaves the way
  a person would guess, following file-manager, browser-tab and Typora habits.
- One design everywhere. The tokens in `packages/themes/src/tokens.css` are
  the only colours, spacings, radii and durations; a new surface reuses an
  existing component shape before it invents one.
- It answers at once and it moves. Every click has a pressed state, changes
  show optimistically, and state changes are eased with the short transitions
  already in use (100 to 190 ms). Editing a note should feel really nice.
- Fast is a feature. Nothing done per keystroke may scale with the document;
  measure before and after, and keep the numbers in the commit message.
- Well-written code is a requirement: DRY, one responsibility per file, small
  functions with names that say what they return.

## Layout

| Package | What it owns |
| --- | --- |
| `packages/editor` | The CodeMirror 6 live-preview editor: parsing, decorations, widgets, commands. No app concerns. |
| `packages/markdown` | The renderer used for export and publishing, and the converter back the other way that a paste and the clipper share. Pure functions between markdown and HTML. |
| `packages/themes` | Design tokens and the stylesheets, shared by the editor, the app and published pages. |
| `packages/glasses` | A note as pages of pixels for the Even Realities G2. Pure but for the rasteriser; see `docs/even.md`. |
| `apps/desktop` | The Svelte 5 app (stores in `src/lib/*.svelte.ts`, components in `src/lib/*.svelte`), the browser shim in `src/lib/web`, and the Tauri crate in `src-tauri`. |
| `apps/cli` | `nib`, which drives the running app over its local endpoint. One Node script, no dependencies, and no knowledge of what any verb does; see `docs/automation.md`. |
| `services/sync` | The Cloudflare Worker: sync, publishing, MCP, accounts, and the theme store's catalogue. Tests run routes against real SQL. A published page is the note; see `docs/publishing.md`. |

One file, one responsibility. A file that has to explain two jobs in its
header comment is two files.

### One way to do each thing

Where to look before writing a helper. Each of these is the only one of its
kind; a second copy is the bug the file's own header describes.

| The question | Where it is answered |
| --- | --- |
| What did an earlier run write down? | `apps/desktop/src/lib/stored.ts`. `storedText` for a word, `stored` for a shape, `keep` and `forget` to write. Never `localStorage` in a store of its own; two guards in `stored.test.ts` hold both directions. |
| How long should this wait? | `apps/desktop/src/lib/backoff.ts`: `pollDelay`, `roomDelay`, `NUDGE_DELAY`. Numbers, tested on their own. |
| Wait, then. | `apps/desktop/src/lib/timing.ts`: `waited` for a pause, `afterQuiet` for after the typing stops, `onceAFrame` for work that reads the layout. `breathe.ts` is the other half - handing the thread back inside a long pass. |
| How long may it move for? | `apps/desktop/src/lib/motion.ts`: `dur`, and `LAYER` for every layer the app puts up. A bare number is a transition that ignores a reader who asked for less movement; `test/motion.test.ts` forbids one. |
| Where does this path point? | `apps/desktop/src/lib/space-paths.ts`. `nameOf` and `folderOf` split a path whichever separator wrote it; `relativeTo`, `withinSpace`, `insideSpace` and `insideAnyOf` convert; `insideItsSpace` judges what a store may keep. |
| What is a row of a menu? | `apps/desktop/src/lib/menu-item.ts`: `MenuItem` and `DIVIDER`, for a row's own menu, the app menu and the palette alike. What a row *draws* stays each list's own - a hint is a `kbd` in one and a word in another. |
| Dropping a key from a map? | `apps/desktop/src/lib/records.ts`: `without`, `withOrWithout`. |

### The workspace store

`apps/desktop/src/lib/workspace.svelte.ts` is the app's centre: the spaces, the
tree, the tabs and the panes. What has a rule of its own lives in
`apps/desktop/src/lib/workspace/`, and the store hands its own calls through, so
`workspace.save()` and the rest mean what they always did.

| Module | What it owns |
| --- | --- |
| `saving.svelte.ts` | Writing what is open down, and the dot beside a name. Its state is its own. |
| `note-text.ts` | The words in a space's notes, read and written without opening them: a replacement, a tag renamed, a task ticked. |
| `composing.ts` | One note out of another, and two into one. |
| `spaces.ts` | The list of spaces: which exist, in what order, which is open. |
| `undoing.ts` | What each kind of file operation means going back. `undo.svelte.ts` is the stack it reads. |
| `panels.ts` | Which side a panel sits on. Pure: it answers what the three fields would be, and the store writes them. |
| the rest | One store each: `bookmarks`, `closed`, `device`, `documents`, `excluded`, `folder-icons`, `graph-settings`, `layouts`, `pane-tree`, `panes`, `positions`, `selection`, `session`, `zones`. |

Seven members of the class are not `private` because those modules read them:
`documents`, `positions`, `reload`, `retarget`, `persist`, `scheduleSession`,
`freeName`. They are the store's own rather than the app's - nothing outside
`lib/workspace` touches them.

Two clusters stayed in the class on purpose. **Naming and creating** -
`createNote`, `startRenaming`, `rename`, `remove` - needs fourteen of the
class's internals, because a row appears in the tree before the file exists;
that is the same responsibility as putting a tab on screen, not a separate one.
**Opening** - `openEntry`, `openPdf`, `openCanvas`, `openWeb`, `openPages` - is
the routing every kind of document shares. Separating either is a design change
rather than a move.

### The theme package is the vocabulary

`packages/themes/src/base.css` holds the shapes more than one component wears:
`.nib-scrim` behind a layer, `.nib-layer` for a thing that floats, `.nib-screen`
for one that replaces part of the screen, `.nib-row` for a row somebody presses,
`.nib-setting` for a row they read. A scrim's place in the stack and its ink come
in as `--scrim-z`, `--scrim-ink` and `--scrim-blur`, and `.is-clear` is the one
that only catches a tap.

The rule: **a shared shape lives there, per-sheet geometry stays scoped.** Svelte
scopes a component's CSS, so a rule in one component cannot reach an element
rendered by another - which is why the sheets share their scrim, their motion and
their dialog contract but each still owns its own width, top and padding, and why
`Sheet.svelte` is not a shell every sheet renders through.

### The Worker

`services/sync/src` after the same pass:

| Module | What it owns |
| --- | --- |
| `body.ts` | Nothing parsed is trusted, whichever direction it arrived from. `readBody` for a route that asks field by field, `objectBody` for one that reads its own, `listIn` and `objectIn` for a stored column, `textAtMost` for somebody else's server. |
| `spaces/columns.ts` | The columns a client writes whole: what each may hold (`MOST_BYTES`, `fits`) and the one write that says the space changed (`writeColumn`). |
| `spaces/paths.ts` | What a path in one of those columns may be: `LONGEST_PATH`, `staysInside`. |
| `refused.ts` | The sentences more than one module refuses with. Wire text: the app shows them, so the bytes are the contract. A sentence one route sends stays beside that route. |

Three name rules, and they are three because merging any two breaks something:

- **a person's** - `cleanPersonName` and `NAME_LIMIT` (60) in `services/sync/src/crypto.ts`. Inner whitespace collapses.
- **a space's** - `spaceName` and `SPACE_NAME_LIMIT` (80) in `services/sync/src/spaces/index.ts`. Whitespace stays: the name is also a folder on somebody's disk, and the app matches a space by it.
- **a client's** - `clientName` in `services/sync/src/oauth/clients.ts`, out of a document somebody else serves, so it may not be a string at all.

`personName` in `services/sync/src/spaces/share.ts` is a fourth thing: what to
*call* somebody in a sentence. `services/sync/test/names.test.ts` says which is
which on the two inputs that tell them apart.

## Security

A note is a file, and a file can come from anywhere: a download, a repository,
a folder somebody shared. Four rules follow, and none of them is widened
quietly: a change that touches one says so where it is made.

- **Whose markup is markup.** Raw HTML in a document of the reader's own is
  rendered, the way Typora and Obsidian render it. In a room, in a shared
  space, in anything a guest can see, and in anything markup was pasted into,
  it is the characters it is made of. The one place that decides is
  `apps/desktop/src/lib/trust.ts`; every surface asks it through
  `trustsHtmlIn` or `trustsHtmlAt` and passes the answer to the renderer as
  `escapeHtml`. A published page always escapes: blogs share a domain.
- **Nothing runs in the app.** Code that came out of a note runs in a frame
  sandboxed without `allow-same-origin`, so its document has an opaque origin
  and the app's DOM, storage and notes are cross-origin to it. That is the
  ` ```js ` fence (`packages/editor/src/run`) and a block of a note's own HTML
  (`packages/markdown/src/html-block.ts`), and both wait for a press.
- **Nothing loads from a third party until the reader asks.** An address a
  note points at is a card the size the frame will be, and the frame arrives on
  a press; see `packages/markdown/src/web-embed.ts`.
- **A path somebody else wrote is judged before anything on disk is touched.**
  `apps/desktop/src-tauri/src/paths.rs` holds the four judges, strictest first.
  `a_space`: a folder directly inside the spaces folder, for the commands that
  move a whole tree. `in_spaces`: inside the spaces folder and not the trash,
  which is every note, folder, tree, search and trash command. `beside_a_note`:
  that, or beside a note the app was asked to open from elsewhere, which is the
  reach a note's own pictures get. And `chosen`, which is any path at all.

`chosen` is the deliberate exception, not a gap in the other three: nib edits
files, and a file worth editing is wherever it already is, so `read_note`,
`write_note`, `write_bytes`, `file_stamp` and `import_document` take whatever
path they are handed. It checks that the string names a file, and `folded`
_collapses_ a `..` rather than refusing it, so a path climbing out of a space
is not an error there: it is a different file, created if it is missing and
replaced if it is not. Those five are safe because of what
stands in front of them, which means a new caller of one of them is exactly
where that stops being true:

- **The window's own gestures.** The path came from the file dialog, the
  command line, a shell hand-off, or `joinPath` off a space root. The reader
  chose it.
- **The local endpoint and every `nib://` link**, the two roads another
  program has in. Both are judged by one function, `insideOnly` in
  `apps/desktop/src/lib/automation/inside.ts`: relative, `/` separators, no
  `..`, no drive letter, no control character, no name Windows keeps for a
  device. `insideSpace` then only concatenates, which cannot leave a root
  given steps that hold no `..`. A link reaches four verbs and no writing
  one; `eval` is refused in the crate, before the window is asked, unless
  the endpoint file turns it on. A caller that names no path at all is
  answered about the note on screen, and that note is judged too: a note
  opened from a downloads folder is outside every space, so `noteFor` in
  `automation/space.ts` refuses it through `withinSpace`, which is
  `insideOnly` under a space's root. The answer names a note relative to
  the space and never by a path on this disk.
- **A link inside a note**, because a note can arrive from a shared space, a
  room, a pull or a paste, so its prose is somebody else's. `followLink` in
  `apps/desktop/src/lib/workspace.svelte.ts` judges the target with that
  same `insideOnly` before making the note a link names.
- **A sync pull**, whose names were written by whoever shares the space:
  `placeable` in `apps/desktop/src/lib/sync/mirror.ts`. A clash the reader
  answers a launch later is judged a second time, because its path was
  written down and read back: `settle` in
  `apps/desktop/src/lib/sync/record.svelte.ts` asks which space holds it and
  writes the path built back up from that space.
- **An import**, where every format reader puts each path component through
  `safeName` before `applyImport` joins it to the space root, and where
  `applyImport` then puts every path through `insideOnly` itself, in one pass
  in front of the writing, so a new format that forwards a zip entry's own
  name unsanitised writes nothing rather than escaping. The judge's own answer
  is the string that is joined to the root.
- **The browser build**, which has no filesystem: the same three commands
  are rows in IndexedDB (`apps/desktop/src/lib/web/commands.ts`), and
  `web/paths.ts` clamps at the virtual root.
- **The phone**, whose spaces folder is inside the app's own external files
  directory and whose manifest asks for no storage permission, so the whole
  of `chosen`'s reach there is this app's own sandbox. A share hands over
  bytes and a name, never a path. The one road bounded by nothing but that
  sandbox is the `open` intent extra in
  `apps/desktop/src/lib/mobile/handed.ts`, which the widget sends as an
  absolute path and which reaches `read_note` unjudged.

So: a path that came from outside the app is judged by `insideOnly` on the
window's side, or by `in_spaces` in the crate, before it reaches any of those
five. A caller that skips both is the bug, not the command.

The policy that backs the first three is `apps/desktop/src/csp.ts`, which is
the one copy of the app's `Content-Security-Policy`: the Tauri config,
`index.html` and the dev server all carry it and
`apps/desktop/test/csp.test.ts` holds them to each other. Two lines in it are
load-bearing. `script-src-attr 'none'` is why
an `onerror` in a file somebody was handed is inert even where that file's
markup is rendered. And `script-src-elem 'unsafe-inline'` is why the sandboxed
frames above still work at all: a `srcdoc` document inherits the policy of the
page that made it, so a policy with no room for an inline script is a policy
that switches those two features off. Prove a change to it with
`python apps/desktop/test/e2e/frames.py`, which serves the built app under the
policy as a header and fails on any violation the browser reports.

## Checks

```sh
pnpm check          # types: tsc per package, svelte-check for the app
pnpm lint           # eslint, type-aware, strict rule sets
pnpm format:check   # prettier; `pnpm format` rewrites
pnpm knip           # unused files, exports and dependencies
pnpm test           # vitest in every package
```

The Rust crate: `cargo fmt --check`, `cargo clippy -- -D warnings` (the lint
policy lives in `Cargo.toml`), `cargo test`. It does not compile on every
machine; CI is the reference.

## Drives

`apps/desktop/test/e2e/*.py` is a drive each: it serves the built web app on a
port of its own, seeds a space through `window.nibApp`, walks the app in the
machine's own Chrome and photographs what it found into
`apps/desktop/test/e2e/shots/`. A drive that checks something exits non-zero
when it does not find it; the rest print what they saw. They are not in `pnpm
test`, because each one is a build and a browser.

The whole set, one build and then one drive at a time:

```sh
python apps/desktop/test/e2e/run-all.py              # build once, run all
python apps/desktop/test/e2e/run-all.py --no-build   # reuse apps/desktop/dist
python apps/desktop/test/e2e/run-all.py --only tree  # the drives matching a word
python apps/desktop/test/e2e/run-all.py --list       # what would run, in order
```

It prints a table of what passed, what it cost and where the screenshots went,
and exits with the number of drives that failed. Every drive is run with
`NIB_SKIP_BUILD=1`, which is how a drive is told the build in
`apps/desktop/dist` is the one to use; a new drive should honour it. The build
is a development one, because a production build hides the `window.nibApp` the
drives seed through.

One set at a time on a machine. Every drive serves the same
`apps/desktop/dist`, and a drive that builds replaces it: a build landing under
a drive that is already running changes the asset hashes it is fetching, and the
page fails on a chunk that is no longer there rather than on anything about the
app. The runner is one drive at a time for that reason, and two runners at once
undo it. Ports belong to the machine too, so a drive run by hand beside a set
takes the port the set was going to want.

A run leaves the working tree dirty in one place: `store-shot.py` writes
`docs/media/screenshot.png`, which is tracked. Keep it when the app's look has
changed and it is the shot you wanted; otherwise check it out again.

Six of them - `collaborate`, `draw-together`, `first-sync`, `publishing`,
`share`, `signin` - start the real Worker under `wrangler dev`, and two things
follow from that. They want `CLOUDFLARE_API_TOKEN` in the environment, because
the Worker binds Workers AI and that has no local emulation, so wrangler opens a
remote proxy session for it and cannot without one; nothing the drives do
reaches the AI. The two that hold a socket open, `collaborate` and
`draw-together`, do not start without it; the ones that only make requests have
been seen to carry on. And they bake their own Worker's address into `dist` as
the API, so the runner makes the shared build again after each of them.

A drive whose port something else already holds is reported `blocked` rather
than failed, because that is not the app being wrong.

### Proving a change moved nothing

A refactor that is meant to change nothing on screen is proved by the pixels
being the same pixels: build, drive, change, drive again, compare.
`apps/desktop/test/e2e/compare.py` does the comparing - bytes first, and where
two shots differ it counts the pixels and the worst channel between them.

**`shell.py` has no floor: two runs of one build are byte-identical, all 83
shots. `access.py` comes to 63 of its 66, and the three that move do so by a
pixel or none.** Both get there by settling rather than by sleeping, and the
recipe is `apps/desktop/test/e2e/settling.py`, which both import - a drive that
wants the same imports it too. Five things:

- **Motion off.** The context is made with `reduced_motion="reduce"`. A sheet
  caught half way through its slide differs from the same sheet by more than half
  the pixels on the screen, which is what one of these shots used to do. What the
  motion itself looks like is `touch-move.py` and `motion.test.ts`.
- **Wait for the thing the shot is about.** Not for a number of milliseconds. A
  step that presses a key and sleeps photographs whatever was there when the sleep
  ended, which on a busy machine is the surface underneath - and it does it
  silently, so the shot looks like a design regression rather than a drive that
  missed. Every layer this drive opens is waited for by selector, and `dismiss`
  waits to see the layer go before the next step clicks anything.
- **Ask the browser whether it has stopped.** `document.fonts.status`,
  `document.getAnimations()`, and the overlay scrollbar's own `is-lit` class,
  which dims on a timer of its own - so whether the bar is in the picture used to
  depend on how long the step before took.
- **The keyboard settled.** Where a sheet puts the focus when it opens is not
  always reached before the first shot, and both states are still - so two
  matching frames do not catch it. `document.activeElement` is read twice and has
  to be the same element both times. This was the last of `access.py`'s shots to
  move: four hundred pixels of focus ring, round a close button in one run and a
  back button in the next.
- **Two matching frames.** Every shot is taken twice and kept only when the two
  match byte for byte, which catches what the page never declared: a face that
  arrived in between, an image decoding, a shadow settling. The caret cannot be
  caught that way because both of its states are still, so it is hidden outright.

What is left of `access.py`'s floor, measured on this machine: `desktop-dark-launch`
and `still-reduced-motion` move by one pixel with a worst channel of three, and
`contrast-contrast-more` differs in its bytes with zero pixels changed. Nothing
else. A shot that differs by the same file and the same magnitude as that is the
floor; a scrim painted a different grey is every pixel over a note, and looks
nothing like it.

`access.py` also writes `axe.json` per run, which is compared by reading: a count
that went up is a regression, one that went down is worth saying in the commit
message. Those counts are untouched by any of the above.

A drive that checks rather than photographs settles the same way, and for the
same reason: `find-bar.py` failed about one run in three, and all three causes
were the drive believing something without asking. It opened its note without
activating it, so the pane went on showing whichever note the space opened on; it
read the document through `window.nib`, which is whichever editor was made last
rather than the focused one; and it left other tabs open, so `.cm-content` picked
by document order was another pane's editor. The keys then walked a note nobody
was looking at and every check after that read as a bug in the find bar.

## The launch

A slow launch can only be measured on the machine that has one: the disk, the
antivirus and the webview runtime are the three biggest terms in it and none of
the three is in this repository. So the app says it itself. Set
`NIB_TRACE_STARTUP` and every launch appends a page to `startup-trace.log` in the
app's log folder - `%LOCALAPPDATA%\ch.emilvinu.nib\logs` on Windows,
`~/Library/Logs/ch.emilvinu.nib` on macOS, `~/.local/share/ch.emilvinu.nib/logs`
on Linux:

```powershell
setx NIB_TRACE_STARTUP 1      # then start Nib the way you always do
setx NIB_TRACE_STARTUP ""     # and off again
```

One page, one launch, two clocks on one axis: the crate's steps from before its
own first line to the window being shown, and the window's own from the page
being requested to the last stage of the launch order. Each line says when it
happened and how long since the line above it, which is the column the answer is
in. `windows, before our first line` is the machine loading the binary, and a
launch whose cost is in that row is not one this code can make faster. See
`apps/desktop/src-tauri/src/trace.rs` and `apps/desktop/src/lib/trace.ts`.

Off costs one environment read and a push onto an array, so there is no build to
make and no flag to pass: the app somebody already has is the app that answers
this.

## Types

Every package extends `tsconfig.base.json`. Beyond `strict`: an index may
miss (`noUncheckedIndexedAccess`), an optional property is not the same as one
set to `undefined` (`exactOptionalPropertyTypes`), overrides say so, switches
do not fall through, parameters nothing reads go. Fix the cause: a check, a
better shape, a narrower type. `!` and `as` are last resorts and each carries a
reason in the line above.

Values crossing a boundary (`invoke`, `JSON.parse`, `fetch`, `localStorage`,
`postMessage`) are unknown until checked. Validate them once, at the
boundary, into a typed shape; the rest of the code trusts the type.

Storage goes through one place in both directions: `keep` and `forget` to write,
`storedText` and `stored` to read, all in `apps/desktop/src/lib/stored.ts`, and
never `localStorage` in a store of its own. A setter throws three ways - site
data blocked, a private window with no quota, a storage that is full - and the
getter throws the first of them; none is a reason for a method to throw. What a
failed write loses is a cache, never the state, which is in memory and true. The
failure is in the log once a run. `apps/desktop/src/lib/stored.test.ts` holds
both halves of the rule and names the one file still to be converted.

## Lint

The strict and stylistic typescript-eslint sets, plus Svelte's. A promise is
awaited, returned, or dropped with `void`. Every `catch` either handles the
error, reports it to the person (`message(error, ...)`), or says in a comment
why it may be ignored. A disable comment names its reason and is rare.

## Tests

A bug fix ships with a test that failed before it. Pure logic gets unit tests;
routes get harness tests; editor behaviour gets state-level tests without a
DOM where possible. Widgets extend `NibWidget`; a test enforces it.

A test measures the code, not the queue in front of it. Loading a module graph
is seconds of compiling that belongs to no one test, so a file whose hooks
re-import the app's stores imports them once at module scope first: a timeout
that fires is then about the test and not about what else the machine was
doing. For the same reason a state the editor parses is read through
`packages/editor/test/parsed.ts` rather than as it comes, and work a whole
file shares is done once, in a hook.

The app runs them in two projects; see `apps/desktop/vitest.config.ts`. The
`node` one is everything, and the `effects` one is the files named
`*.effect.test.ts`. A rune compiled for the server is not reactive - `$state`
is a plain field there and `$effect` does not exist at all - so no test in the
node project can run an effect; the effects project is `jsdom`, which Vitest
serves out of Vite's client environment, where the runes compile exactly as
they ship. A store test belongs there when what it is about only happens
because something is watching: a store method called from an `$effect`, a
`$derived` read inside one, an effect's teardown giving something back.
Everything else stays in the node project, which is the faster of the two. A
rune is syntax rather than a function, so a plain `.ts` test cannot write one:
`$effect`, `$effect.root` and `$state` come from
`apps/desktop/test/effects/runes.svelte.ts`.

And the rule those tests hold: **a store method called from an effect must
never read the state it writes.** A read inside an effect is a dependency and a
write to it is the next run, so a method that decides anything from its own
state runs away as soon as one effect calls it. Svelte abandons the batch with
`effect_update_depth_exceeded` and the page is drawn and never updates again -
no menu opens, no space can be chosen. Decide from what was passed in, or from
a plain field the reactive one is written through; see
`apps/desktop/src/lib/said.svelte.ts`.

## Writing

Comments say why, in plain prose, not what the next line already says. No em
dashes anywhere, in code, comments, strings or docs; tests forbid them in the
catalogues. User-facing strings in the editor go through `labels.ts`; in the
app through `t()`; every key is translated in every catalogue.

## Words the reader sees

`apps/desktop/src/lib/i18n.svelte.ts` is the whole mechanism, and
`apps/desktop/src/locales/` holds one catalogue per language. **The English
string is its own key**, so nothing can come out blank: a language that has not
translated a row shows the English. The clipper says the same thing in the same
languages with its own rows; see *The clipper's half* below.

### Adding a string

1. Write it in English at the call site, through one of four shapes:

   | Shape | For |
   | --- | --- |
   | `t('Save')` | a string translated where it is written |
   | `key('Save')` | a string something further along translates, in a table of rows |
   | `message(error, 'could not reach the server')` | the sentence a failure falls back to |
   | `plural(n, { one: '{count} note', other: '{count} notes' })` | anything a number decides |

2. Add the row to `locales/de.ts`, which is the reference every other catalogue
   is held to, and then to the rest.

`src/lib/i18n.test.ts` is the check: it fails the build when a catalogue is
short of a row, carries one nothing asks for, has the wrong count forms for its
language, loses a placeholder, or holds an em dash. Run it alone with

```sh
pnpm --filter @nib/desktop exec vitest run src/lib/i18n.test.ts
```

Rules the tests enforce:

- **No English in the markup.** `test/localised.test.ts` walks the source and
  fails on a phrase, a `title`, an `aria-label`, a `placeholder`, an `alt` or a
  `label:` that is not an expression. Sample values (`you@example.com`) and
  single glyphs are exempt by name.
- **A count goes through `plural()`**, never through `count === 1 ? … : …`.
  English has two forms, Polish four and Arabic six; which one a number takes is
  `Intl.PluralRules`'s answer. The `other` form is the key the row is filed
  under, and a catalogue holds either one string (a language with one form) or
  exactly the categories `Intl` gives that language.
- **A date, a time or a number goes through `when()` or `amount()`**, which ask
  `Intl` in the app's language rather than the browser's. Never
  `toLocaleString()`: somebody reading a German app on an English machine should
  read German dates.
- **Nothing is concatenated.** One row is one whole sentence with `{placeholders}`
  in it; two halves joined with `+` cannot be reordered by a language that wants
  them the other way round.
- **A sentence the Worker answers with is a row too.** `services/sync` replies in
  English, the client throws it, and `message()` looks the text up like any other
  string. A new `{ error: '…' }` a reader can bring about needs a row in every
  catalogue; the ones a correct client never sends (`send an object`, `not a
  request`) are deliberately left in English.

### A language that reads the other way

Arabic, Persian, Pashto and Urdu turn the interface round. `directionOf` in
`apps/desktop/src/lib/direction.ts` names them, `i18n.load` writes the answer as
`dir` on the root element beside `lang`, and everything that mirrors keys off that
one attribute - so adding a fifth is a line in that list and nothing else. A note
is a separate question and answers it itself: see *Which way the words run* in
`docs/design.md` for what mirrors, what stays physical and why.

Two things to keep in mind while writing a string:

- **A name goes in through a placeholder**, never around one. `t()` isolates a
  value that reads the other way from the sentence, which is what keeps a Latin
  file name from losing its extension inside an Arabic sentence.
- **Left and right in a label mean the screen's sides**, because that is what
  somebody looking at the screen means by them. A region or a key that means
  "further along the line" is named for that instead; see `docs/keyboard.md`.

### Adding a language

1. Add it to `LANGUAGES` and to `CATALOGUES` in `i18n.svelte.ts`, named the way
   its own speakers write it, with `machine: true` unless somebody has read the
   catalogue through. The `CATALOGUES` map is written out entry by entry so the
   bundler and `knip` can both see every file; each catalogue is fetched when it
   is chosen, not at start.
2. Add the tags a system might send it under to `ALSO` where they are not the id
   (`zh-TW`, `tl`, `prs`).
3. Write `locales/<id>.ts`. `node scripts/locale-template.mjs <id>` writes a
   starting file into `target/locale-templates/` with the right rows in the right
   order, the section comments, and every count row already shaped for the plural
   forms that language has. Translate the values and change nothing else.
4. `python scripts/locale-e2e.py --languages <id>` photographs every surface at
   desktop and phone widths and fails on anything the translation cut off that
   the English does not. A row that asked for the ellipsis it was offered is
   listed rather than failed: the element said its text may be cut. For a language
   that reads right to left it also measures which side the list ended up on,
   which way each mark points, and that the note did not follow the interface, so
   add the id to `RIGHT_TO_LEFT` there as well as in `direction.ts`.

### The clipper's half

The extension says the same thing in the same languages, with its own sixty rows:
`apps/clipper/src/lib/translate.ts` is the mechanism and `apps/clipper/src/locales/`
holds the catalogues. The language list, the tags a browser is answered under and
the shape of a count row are the app's, row for row, and a change to one of the
three belongs in both files - a deliberate copy rather than a shared package,
because an extension bundle and an app bundle have nothing else in common and the
two catalogues hold different rows. The pages wrap it in a rune the way the app
does; the service worker, which Chrome stops between clips, asks `words()` for a
catalogue and translates without one.

A language is added the same way, and the rows the app already has for it are
**lifted from `apps/desktop/src/locales/<id>.ts`** rather than translated again:
half the extension's rows are words the app already says, and one word per term is
the whole point. `apps/clipper/src/lib/i18n.test.ts` is the gate, and
`python apps/clipper/test/e2e/locales.py` photographs the popup at the width Chrome
gives it and the options page at its own, in the same five hard languages.

The handful of words **Chrome** draws rather than the extension - the tile on
`chrome://extensions`, the store listing, the shortcut list - live in
`apps/clipper/public/_locales/<tag>/messages.json`, because Chrome's own mechanism
is the only one those surfaces have and it picks the folder by the browser's
interface language, not by what somebody chose in the options page. Only languages
Chrome has an interface in can be folders there, which is thirty-one of the
thirty-nine; the rest read the whole extension in their own language with Chrome's
tile beside it in English. The gate holds the two halves to the same languages and
checks that every `__MSG_*` the manifest asks for is answered.

Keep one word per term. nib's own vocabulary, and what to follow:

| nib's word | What it is | Precedent |
| --- | --- | --- |
| space | a folder of notes that syncs and is shared as a unit | Obsidian's *vault*, Notion's *workspace*. de `Bereich`, fr `Espace`, ja `スペース` |
| note | one markdown document | Obsidian's *note*, Notion's *page*. de `Notiz`, fr `Note`, ja `ノート` |
| canvas | a board of cards, pictures and ink | Obsidian's *Canvas*. de `Leinwand`, fr `Canevas` |
| room | a live session two people write one note in | the language's word for a collaboration *room* |
| mark | the markdown characters live preview hides | the language's word for a *syntax mark* |
| journal | the dated daily note | Obsidian's *daily note*. de `Tagebuch` |
| theme | a colour scheme | de `Design`, fr `Thème` |
| share | letting another person into a space or a room | de `Teilen`, fr `Partager`, ja `共有` |
| publish | putting notes on the web at an address | Notion's *publish*. de `Veröffentlichen`, fr `Publier` |
| drawer | the panel that slides in from the side on a phone | de `Schublade`, fr `Panneau` |
| foot row | the strip of state under the note | de `Fußzeile`, fr `Barre d'état` |

`Nib`, `nibeditor`, format names (`Markdown`, `PDF`, `HTML`), other products
(`Obsidian`, `Notion`, `OpenAI`) and key names (`Ctrl`, `Enter`, `⌘`) are never
translated.

The glasses' own words are drawn on a 576×288 panel of eight lines, so they must
be no longer than the English: `i18n.test.ts` holds every string `lib/even` asks
for to one line of it, and to half again its English for the two the English
itself does not fit. The firmware's font is the other half of that story: it
covers Latin, Cyrillic, Greek, CJK and emoji, and draws a box for everything
else, so the Devanagari, Bengali, Tamil, Telugu, Kannada, Malayalam, Gurmukhi,
Gujarati, Arabic, Thai, Burmese and Ethiopic catalogues are translated for the
app's own panes and cannot reach the glass. Those rows are worth writing anyway
and are not worth shortening for a panel they never reach.

The language setting follows the system by default: the first of
`navigator.languages` the app has a catalogue for, longest tag first, English if
none. `catalogueFor()` is that rule and is tested on its own.

Most catalogues were written in one pass and never read through. The language
row says so and links to the folder, which is the only honest thing to do and
the only way they get better.

## Commits

`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `style:`, `chore:`,
then a short lowercase phrase, one line. Authored by the person committing,
no trailers.
