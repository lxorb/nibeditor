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
| Are these two paths one file? | The same file: `samePath`, `within` and `movedTo`, which set separators, composition and, where the space's disk does, case aside (each space's disk is asked once, `askCase`); `pathKey` for a set of them. A rename's own question, whether a name is written differently at all, is `sameSpelling`. `test/one-path.test.ts` forbids a bare `===` or `startsWith` between two paths in the workspace. |
| Something kept by path, and a file moves or goes? | `apps/desktop/src/lib/workspace/file-ops.ts`. Every operation says `created`, `moved` or `removed` once through `workspace.fileMoved`, `fileGone` and `fileCame`; a store follows (`keeping` for one kept under each space's root) and no operation names it. |
| What does a button's tooltip say? | `apps/desktop/src/lib/titled.ts`: `titled(name, id)`, the name and the key the registry holds for that command now, `Back (Alt+←)`, and the name alone on a touch screen or where no key is held. A `title` that names a command with a key goes through it. |
| What is a row of a menu? | `apps/desktop/src/lib/menu-item.ts`: `MenuItem` and `DIVIDER`, for a row's own menu, the app menu and the palette alike. What a row *draws* stays each list's own - a hint is a `kbd` in one and a word in another. |
| Dropping a key from a map? | `apps/desktop/src/lib/records.ts`: `without`, `withOrWithout`. |
| Fetching a part the first time it is asked for? | `packages/markdown/src/door.ts`: `door`, which keeps one fetch, tries twice and forgets a failure; `held` and `latched` in `apps/desktop/src/lib/surfaces.svelte.ts` for a component. A chunk the browser will not fetch again is `apps/desktop/src/lib/reloading.svelte.ts`'s. |

### The workspace store

`apps/desktop/src/lib/workspace.svelte.ts` is the app's centre: the spaces, the
tree, the tabs and the panes. What has a rule of its own lives in
`apps/desktop/src/lib/workspace/`, and the store hands its own calls through, so
`workspace.writeNow()` and the rest are the store's calls wherever they live.

| Module | What it owns |
| --- | --- |
| `saving.svelte.ts` | Writing what is open down, a moment after it changes: every note, canvas and page note, and a new tab the moment it has words. Its state is its own. |
| `drafts.ts` | What a new tab's file is called and whether it follows its first line. Pure. |
| `note-text.ts` | The words in a space's notes, read and written without opening them: a replacement, a tag renamed, a task ticked. |
| `composing.ts` | One note out of another, and two into one. |
| `spaces.ts` | The list of spaces: which exist, in what order, which is open. |
| `undoing.ts` | What each kind of file operation means going back. `undo.svelte.ts` is the stack it reads. |
| `file-ops.ts` | Every file operation said once, and everything kept by path following it: the open documents and tabs, positions, recents, the per-space stores, the link index, the papers and the account. |
| `panels.ts` | Which side a panel sits on. Pure: it answers what the three fields would be, and the store writes them. |
| the rest | One store each: `bookmarks`, `closed`, `device`, `documents`, `excluded`, `folder-icons`, `graph-settings`, `layouts`, `pane-tree`, `panes`, `positions`, `selection`, `session`, `zones`. |

Members of the class are not `private` because those modules read them:
`documents`, `positions`, `reload`, `retarget`, `persist`, `scheduleSession`,
`freeName`, and the tree-edit trio `entryAt`, `showEntry`, `freshEntry`. They are
the store's own rather than the app's - nothing outside `lib/workspace` touches
them.

Two decisions inside opening. The routing - which kind of tab a path is for - is a
decision rather than machinery, so it is `apps/desktop/src/lib/openers.ts`: a pure
`openerFor` with a branch for every kind and every build, tested apart from any
tab. And a website written as a note becoming a `.url` shortcut is a migration in
the browser's own domain, so it is `apps/desktop/src/lib/web-tab/convert.ts`, taking
the tree-edit trio as an interface.

What did **not** come out is the rest of opening - `openPdf`, `openCanvas`,
`openWeb`, `openPages`, `open` - and the reason is worth stating, because it is the
same reason **naming and creating** (`createNote`, `startRenaming`, `rename`,
`remove`) stayed. Both are consumers of one core loop: `document` builds a
document, `add` puts it in a pane, `dropScaffolding`, `showNote`, `remember`,
`walked`, `placeAt`. Those seven are each called a dozen-plus times, spread across
opening, creating, `restore`/`applyLayout`, and `split` - so the loop is owned by
no one cluster. A module that opened tabs would take twenty-odd of the class's
members as an interface, most of them that loop, and the same loop would still be
reached as `this.` by the creating and restoring code that stays. That is not a
seam; it is the class turned inside out. So the loop, and the two clusters built on
it, stay in the class.

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
  (`packages/markdown/src/html-block.ts`), and both wait for a press. Both run
  through one script, `packages/editor/src/frame-script.js`, which runs nothing
  outside an opaque origin.
- **Nothing loads from a third party until the reader asks.** An address a
  note points at is a card the size the frame will be, and the frame arrives on
  a press; see `packages/markdown/src/web-embed.ts`. Never one on the app's own
  origin: `framedPage` in `packages/editor/src/web-frame.ts` refuses it, because
  on the web that frame would hold `allow-scripts allow-same-origin` beside the
  app.
- **A path somebody else wrote is judged before anything on disk is touched.**
  `apps/desktop/src-tauri/src/paths.rs` holds the four judges, strictest first.
  `a_space`: a folder directly inside the spaces folder, for the commands that
  move a whole tree. `in_spaces`: inside the spaces folder and not the trash,
  which is every note, folder, tree, search and trash command, and every file a
  note points at (`read_file`, `read_asset`, `save_asset`). `openable`: that, or
  one of the app's own two settings files, `custom.css` and `snippets.json`,
  which Edit custom CSS and Edit snippets open in a tab; `read_note` and
  `file_stamp` stand behind it. And `chosen`: that, or where the reader picked
  a file in the system's own dialog, for `write_note`, `write_bytes`,
  `run_pandoc`, `print_pdf` and `import_document`.

**nib opens nothing from outside its spaces.** No bundle declares a file type,
no command line, second launch or Finder hand-off is read as a note (only a web
page, once nib is the browser; see `launch.rs`), there is no Open file, and a
file dropped where nothing takes it is not opened in place of the app
(`apps/desktop/src/lib/drops.ts`). A file from elsewhere comes in as a copy:
Import, a drop onto the file list or into a note, a share on the phone.
`packaging.test.ts` holds the bundles and the package managers to that, and a
tab left on such a file by a sitting from before is not put back (`tabsFrom` in
the workspace).

`chosen` is the one way past the spaces, and a narrow one. Inside the spaces
folder `in_spaces` decides alone, trash and all. Outside it, a path is let
through only when the reader picked it, or a file in the same folder, in the
save or open dialog this run: `Picked` hears every pick from the asset
protocol's scope, which the dialog plugin adds each one to and nothing else in
the app adds to after the launch. So an export lands where it was pointed, with
its pictures beside it, and a document an import reads is the one the reader
chose; nothing a note, a link or a script says can open that dialog for them.
A pick at the top of a disk reaches that one file and not the drive. `folded`
_collapses_ a `..` rather than refusing it, so a path is judged by where it
points. What stands in front of all four, and so what a new caller has to keep:

- **The window's own gestures.** The path came from `joinPath` off a space
  root, from the settings files the crate names, or from the file dialog.
- **The local endpoint and every `nib://` link**, the two roads another
  program has in. Both are judged by one function, `insideOnly` in
  `apps/desktop/src/lib/automation/inside.ts`: relative, `/` separators, no
  `..`, no drive letter, no control character, no name Windows keeps for a
  device. `insideSpace` then only concatenates, which cannot leave a root
  given steps that hold no `..`. A link reaches five verbs, and the two of
  them that write can only make a note or add to the end of one;
  `eval` is refused in the crate, before the window is asked, unless
  the endpoint file turns it on. A caller that names no path at all is
  answered about the note on screen, and that note is judged too: `noteFor`
  in `automation/space.ts` refuses a note outside every space through
  `withinSpace`, which is `insideOnly` under a space's root. The answer names
  a note relative to the space and never by a path on this disk.
- **A link inside a note**, because a note can arrive from a shared space, a
  room, a pull or a paste, so its prose is somebody else's. `followLink` in
  `apps/desktop/src/lib/workspace.svelte.ts` judges the target with that
  same `insideOnly` before making the note a link names.
- **A sync pull**, whose names were written by whoever shares the space:
  `placeable` in `apps/desktop/src/lib/sync/pass.ts`. A clash the reader
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
  directory and whose manifest asks for no storage permission. A share hands
  over bytes and a name, never a path, and nib is no file manager's "Open
  with": the manifest's one VIEW filter is the `nib://` link. The widget's
  `open` intent extra is an absolute path, judged against the spaces by
  `openable` in `apps/desktop/src/lib/mobile/handed.ts` and by `openable` in
  the crate.

So: a path that came from outside the app is judged by `insideOnly` on the
window's side, and by `in_spaces`, `openable` or `chosen` in the crate, before
anything on disk is touched. A caller that skips the window's judge is the bug,
not the command.

The policy that backs the first three is `apps/desktop/src/csp.ts`, which is
the one copy of the app's `Content-Security-Policy`: the Tauri config, the three
pages (`index.html`, `presenter.html`, `even.html`) and the dev server all carry
it and `apps/desktop/test/csp.test.ts` holds them to each other. Its script
lines are the load-bearing ones. There is no `'unsafe-inline'` for scripts on any
engine: the two inline scripts there are, the theme before the first paint and
the frame script, are named by their hashes, and the test hashes both again so an
edit to either cannot forget the policy. `script-src-attr 'none'` is why an
`onerror` in a file somebody was handed is inert even where that file's markup is
rendered. The sandboxed frames above inherit all of that - a `srcdoc` document
takes the policy of the page that made it - so a frame carries its program as
text and the frame script inline to run it. Inline and not fetched: on Windows a
request from an opaque origin never reaches the app's own `http://tauri.localhost`
and is refused. Prove a change with `python apps/desktop/test/e2e/frames.py`,
which serves the built app under the policy as a header, runs a fence, a block
and a slide in Chrome and in WebKit, and fails on any violation either browser
reports; and in the packaged app, where the policy is Tauri's header as well.

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

`apps/desktop/test/e2e/*.py` is a drive each: it opens the built web app in
Chromium, seeds a space through `window.nibApp`, walks the app and photographs what
it found into `apps/desktop/test/e2e/shots/`. A drive that checks something exits
non-zero when it does not find it; the rest print what they saw. They are not in
`pnpm test`, because each one is a build and a browser. They run every night
instead, in `.github/workflows/drives.yml`, and whenever that workflow is
dispatched; `smoke.py` alone also runs on every change, in `check.yml`.

Everything round a drive's steps is `apps/desktop/test/e2e/harness.py`'s, so a new
drive is its steps and nothing else:

```python
from playwright.sync_api import Browser

from harness import Drive

DRIVE = Drive(__file__)
say, wrong, shot = DRIVE.say, DRIVE.wrong, DRIVE.shot


def drive(browser: Browser) -> None:
    page = DRIVE.page(browser, viewport={"width": 1180, "height": 820})
    DRIVE.open(page)
    DRIVE.seed(page, "# Plan\n\nWhat we are doing.\n")
    DRIVE.open_note(page, "Plan")
    if "What we are doing" not in page.inner_text(".cm-content"):
        wrong("the plan is not on screen")
    shot(page, "01-plan")


if __name__ == "__main__":
    raise SystemExit(DRIVE.run(drive, "the plan is on screen"))
```

What that one import gives it, so that no drive writes any of it again:

- **One build.** `--mode drive`, the release shape with the two handles a drive
  steers by. A drive run by hand builds; `NIB_SKIP_BUILD=1` reuses
  `apps/desktop/dist`; `NIB_DIST` names a folder built by hand - the other half of a
  before-and-after - which is never rebuilt.
- **An origin of its own.** A port the system hands out and
  `http://<drive>.localhost:<port>`, so no storage, service worker or cookie is
  shared with another drive or with the dev server, and drives run side by side.
- **The server a deploy is.** HTTP/1.1, a hashed asset good for ever and the rest
  asked about every time, one fixed `Last-Modified`, the types written out rather
  than read from the Windows registry. `DRIVE.answers` adds a route of the drive's
  own; `DRIVE.side` starts a second server, such as a fake OpenAI-compatible
  provider.
- **The browser CI has.** Playwright's own Chromium, headless; `NIB_BROWSER=chrome`
  drives the machine's own Chrome instead.
- **The app's own word, not a clock.** `DRIVE.open` returns once the handle, the
  space and the launch order's last mark (`nib: launch order finished`, see
  `apps/desktop/src/lib/startup.svelte.ts`) are there, `DRIVE.open_note` once the
  editor shows that note, and `DRIVE.reading` once the reading view has drawn it. A
  new wait is `DRIVE.wait_for` on something the page can be asked, never a sleep.
- **One verdict.** `wrong` counts, a page error counts, and `DRIVE.run` exits
  non-zero when anything did. A drive that walks out half way still closes its
  browser, its servers and its Worker; a close that hangs is ended after
  `TEARDOWN` seconds, and a drive that hangs anywhere prints every thread's stack
  before the runner gives up on it.
- **Offline means the network.** `DRIVE.preload` puts every chunk of the build into
  the page before a drive takes the network away, because the installed app keeps
  its own files on the disk and a chunk first asked for offline never loads.
- **The real Worker**, `harness.Worker(DRIVE)`: `wrangler dev --local` with a
  database in a temp folder, every migration applied, an account written straight
  in, the mail it would have sent, and every process under it ended with it.
  `--local` switches the remote bindings off, so no Cloudflare token is wanted. The
  app such a drive loads is a build of its own, `dist-worker`, that asks its own
  origin for the API - as the web app at nibeditor.com does - so one build serves
  every Worker on any port, several drives run their Workers side by side, and
  `dist` is never rebuilt under a drive that is still fetching from it.
- **A native probe**, `harness.Native(DRIVE, exe)`: through `scripts/probe_app.py`'s
  `run_probe`, off every screen, with `NIB_SPACES_DIR` in a temp folder. Never the
  reader's own nib: the installed exe, a build under the release identifier
  `ch.emilvinu.nib` (whose launch the running nib would take) or one whose identifier
  nobody said is refused before it starts, and run-all.py skips a native drive
  pointed at one (`NIB_PROBE_EXE`, `NIB_PROBE_IDENTIFIER`). Nothing is ended by its
  name, only by the number of a process the harness started.

A drive that needs what a machine may not have says so at its top -
`NEEDS = ("native",)` - and is listed as skipped, with the reason, everywhere it is
missing. One that launches the desktop app is read as needing a native build
whether it says so or not. A drive whose honest run is longer than the fifteen
minutes any drive is given says that too, `BUDGET = 2400`, rather than every drive
being given more. And a failure a drive found that is already somebody's to fix is
named where the drive is made - `Drive(__file__, known={"words it says": "who has
it"})` - so the run goes past it as `known` in the table, every night, and says so
the night it stops happening, so the entry comes off rather than staying.

The whole set, on one build:

```sh
python apps/desktop/test/e2e/run-all.py                 # build once, run all
python apps/desktop/test/e2e/run-all.py --jobs 1        # one at a time, out loud
python apps/desktop/test/e2e/run-all.py --only tree     # the drives matching a word
python apps/desktop/test/e2e/run-all.py --no-build      # reuse apps/desktop/dist
python apps/desktop/test/e2e/run-all.py --list          # what would run, and how
```

Several at once - a quarter of the machine's cores, at most four, unless `--jobs`
says otherwise - each lane taking the next drive from one queue, longest first, so
no lane is left holding the slowest at the end. A drive that fails is run once more
on its own at the end, the way Playwright and Chromium's own harness retry, and one
that holds then is called `flaky` in the table - green, and named, so a drive that
only passes on a quiet machine is written down rather than hidden. The table says
what passed, what it cost and where the pictures went; it is also `shots/results.md`
and `shots/results.json`, each drive's own output is `shots/logs/<drive>.log` (a
retried one's first go beside it as `<drive>.first.log`), and the exit status is the
number of drives that failed. The nightly job is exactly this with `--jobs 2`: the
table on the run's own page, the shots and logs as its artifact, red when a drive
failed.

A run leaves the working tree dirty in one place: `store-shot.py` writes
`docs/media/screenshot.png`, which is tracked. Keep it when the app's look has
changed and it is the shot you wanted; otherwise check it out again.

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

The window opens where it was left: its size, its place and whether it was
maximised are written to `window.json` beside the settings as it closes, and put
into the window's config before it is built, so the first frame is already in the
right place. A place on a screen that is no longer plugged in is pulled onto one
that is. A window whose config names a place of its own, or any window of a run with
`NIB_OFF_SCREEN` set, is a probe's: it is built hidden, sent there, shown without
coming forward and kept under every other window, so no frame of it is ever in front of
anybody and the keyboard is never handed to it - and on Windows it is
created off the screen in the first place, because tao hands an off-screen starting
place to the system's cascade; see `created_away` in
`apps/desktop/src-tauri/src/placement.rs`. `scripts/probe_app.py` starts every probe
that way and ends one that shows up on a screen. It is on the trace as `window
placement`.

## Speed

Emil's rule, 2026-09-14: nib opens in under a second, on slower devices too, and looks
fully loaded when it does. What holds it, and how to measure it again:

- **The first paint's weight**, on every change: `apps/desktop/test/weight.test.ts`,
  our own source reached from `src/main.ts` without crossing a dynamic import, in bytes
  and in modules, held to what was measured plus one per cent. The walk reads an import
  prettier wrapped over several lines; until 2026-09-30 it did not, and 111 kilobytes of
  the launch were outside the budget.
- **The main thread after the paint**, on every change in the smoke job:
  `apps/desktop/test/e2e/long-tasks.py`. No task over fifty milliseconds between the
  first frame and the end of the launch order, but the one that builds the restored
  note's editor, on a fixed space of a hundred notes, against a line scaled to the
  machine it runs on. Red with a task of eighty reference milliseconds put into the
  search stage's turn, green without it.
- **The launch itself**: `python apps/desktop/test/e2e/launch.py` on a release probe
  build (its docstring says how to make one). Cold is a first launch on a profile the
  webview has never seen, warm is every one after, with a note open in the big space;
  every launch through `run_probe`, off the screen; the machine's load and free memory
  printed beside each table, because a machine out of memory pages the webview in from
  disk and takes seconds at a low processor load.
- **The slow device**: the same drive with `--throttle 4`, a warm launch whose page is
  reloaded with its main thread slowed four times through the DevTools protocol, on a
  port only the probe is given. The window and the webview's own start are the
  machine's and are not slowed, so the total is the warm native half plus the slowed
  page. No Android device or emulator answered adb on this machine, so there is no
  phone row.

Measured 2026-09-30 on a Snapdragon X Elite (X1E78100, 12 threads, 32 GB, Windows
26200, WebView2 154.0.4258.37) with other agents' builds on it: load 23-59 %, 5-8.5 GB
free. Milliseconds from before the process's first line, the median of seven launches
each, the two builds launched turn and turn about so the machine's load lands on both.
Before is main at bbef30bb, the first paint as this round found it (3,380,464 bytes of
source counted whole); after is main at 0fa05816 (3,190,959). Both carry the same crate.

| launch | window shown | page requested | modules | shell | tree read | first frame | pane | order done |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| cold, empty space, before | 312 | 300 | 497 | 528 | 562 | 658 | - | 758 |
| cold, empty space, after | 320 | 307 | 526 | 563 | 611 | 700 | - | 768 |
| warm, empty space, before | 321 | 307 | 438 | 478 | 504 | 557 | 590 | 676 |
| warm, empty space, after | 318 | 303 | 442 | 484 | 510 | 565 | 601 | 687 |
| cold, 5,000 notes, before | 409 | 387 | 542 | 584 | 645 | 749 | - | 1000 |
| cold, 5,000 notes, after | 439 | 423 | 589 | 633 | 703 | 818 | - | 1063 |
| warm, 5,000 notes, before | 393 | 377 | 532 | 576 | 629 | 667 | 754 | 821 |
| warm, 5,000 notes, after | 349 | 336 | 478 | 518 | 571 | 608 | 693 | 759 |

| four times slower, warm, after | page requested | modules | shell | tree read | first frame | pane | order done |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| empty space | 303 | 563 | 685 | 809 | 835 | 870 | 976 |
| 5,000 notes | 336 | 598 | 755 | 967 | 1023 | 1321 | 1634 |

Read it by its phases rather than its totals. `window shown` is late in a probe on
purpose: a probe's window is created off the screen and shown once its webview is built
(see `built_away` in placement.rs), where a real launch with a remembered ground is on
screen in its own colour at about fifty milliseconds (see ground.rs). `page requested`
is the webview coming up, which is native and none of the page's; `first frame` is the
shell and the file list painted; `pane` is the note the window was left on, drawn in its
editor, or the empty pane where there was none.

What it says. Every first frame is under a second, cold or warm, and so is every launch
order but the cold one over five thousand notes. At four times slower the empty space
is whole in 0.87 s and done in 0.98; five thousand notes are not, at 1.02 s to the file
list and 1.32 s to the note. The warm launch is not under half a second: it is 0.57 to
0.61 s to a painted window, and 0.30 to 0.34 s of that is the webview starting before a
line of the page runs. The 209 kilobytes of source this round took out of the first
paint (49 kilobytes built) move no row here by more than the machine's own noise: on a
machine this fast the page's own work is a quarter of a launch.

What is next, in the order the table asks. The webview's start, the largest phase of
every launch, overlapped with building the window rather than after it - a change to
the crate's engine and window builder (`engine.rs`, `launch.rs` and the builder in
`lib.rs`, under `apps/desktop/src-tauri/src`) that waits for the engine switch. Then the restored note on a slow device, 0.3 s of the
slowed launch over five thousand notes: the note drawn as it reads first and its editor
mounted a frame later, with nothing moving and the caret where it was. Then the listing
of a big space, 0.2 s slowed. Tried and not kept: dropping the JavaScript side of Vite's
module preloading, which took 87 ms off a first frame at full speed and put 55 back at
four times slower, where the preloads are what keeps a door's modules from arriving one
after another.

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
