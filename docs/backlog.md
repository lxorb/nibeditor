# Backlog

Everything Emil asked for in nib that is not on `main` yet, checked against `main` at
4a0aa764 (2026-09-30). Sources: the memory files (`nib-task-queue.md`,
`nib-feature-batches.md`, `nib-gaps-2026-09-09.md`, `nib-parity-roadmap.md`,
`nib-browser-vision.md`, `nib-product-philosophy.md`, `nibeditor-naming-and-launch.md`,
`test-everything-after-pushes.md`), the open rows of `docs/power-user.md`,
`docs/typora-parity.md` and every "What is left" in `docs/`, and the four unmerged
branches. There are no TODO or FIXME comments in the code; every hit is Roam's or
Logseq's `TODO` marker.

Emil's words for the push (2026-09-30): finish every todo he gave, re-add the unfinished
ones, drop what no longer makes sense, clean up, and above all make nib a really nice
digital workspace. So the lanes are ordered by what a person feels first.

Paths: `lib/` = `apps/desktop/src/lib`, `ed/` = `packages/editor/src`, `md/` =
`packages/markdown/src`, `rs/` = `apps/desktop/src-tauri/src`, `worker/` =
`services/sync/src`. Size: S = hours, M = a day, L = several days, XL = a batch series.
Value: what it does for the workspace, high / med / low. "Asked" is where the request
lives, with its date.

One number every lane needs: the first paint's budget on `main` is 3,279,000 bytes over
376 files (`apps/desktop/test/weight.test.ts`). The briefs written earlier today still say
3,250,000; the Apple round raised it four times on 2026-09-29.

## Lanes

Each lane keeps to its own files, so several run at once. Every lane has a ready brief in
the session scratchpad under `backlog\lanes\<lane>.md`.

| # | lane | items | size | starts | surface |
| --- | --- | --- | --- | --- | --- |
| 1 | `hunt-7` - nothing half-working | 5 | L | now | fixes outside the in-flight surfaces, the rest reported |
| 2 | `launch-2` - under one second, proven | 5 | L | now; its Rust half after #46 and #51 | `main.ts`, `index.html`, `lib/startup.svelte.ts`, the weight guard, `launch.py` |
| 3 | `editor-feel` - writing feels right | 5 | M | now | `ed/`, `md/`, `packages/themes` editor and document CSS |
| 4 | `browser-parity` - Chrome's own features | 7 | L | after #40, #41, #46, #51 | `lib/web-tab/` (not `clip.ts`), `rs/web_*.rs` |
| 5 | `robust-core` - one path, one event | 4 | L | after #38, #39, #45 and sync v2's mirror lane | `lib/workspace*`, `lib/space-paths.ts`, the per-space stores |
| 6 | `tabs-hints` - tabs and hints like Chrome | 4 | M | after #33, #37, #45 | `lib/Tabs.svelte`, titles app-wide, `lib/drag-paths.ts` |
| 7 | `design-pass` - one design, no stragglers | 5 | M | after #42 and #50 | `packages/themes` tokens and base, component styles |
| 8 | `drive-harness` - drives anyone can trust | 3 | M | now | `apps/desktop/test/e2e`, `scripts/`, a nightly workflow |
| 9 | `perf-hotspots` - the slow spots left | 3 | M | now | `lib/canvas/paint.ts`, the link scan in `lib/web/commands.ts` and `rs/links.rs` |
| 10 | `naming-docs` - one name, true docs | 3 | S | naming now, docs after the wave | display strings, `packaging/`, `docs/`, `README.md` |
| 11 | `security-2` - the lows and the CSP | 4 | M | now; a migration number agreed with #43 | `worker/`, `apps/desktop/src/csp.ts`, the HTML entries |
| 12 | `rust-hardening` - the crate's leftovers | 5 | M | after #39 | `rs/notes.rs`, `trash.rs`, `updates.rs`, `downloads.rs`, `themes.rs`, `tree.rs` |
| 13 | `clipper-import` - one extractor | 3 | M | after #40 | `apps/clipper`, `md/`, `lib/web-tab/clip.ts`, `rs/apple_text.rs` |
| 14 | `iphone-platform` - what Android has | 4 | XL | after Emil answers Q6 | the iOS project, `lib/mobile/`, `apps/desktop/public/sw.js` |

## The top fifteen

1. Hunt the areas no hunt has reached (lane 1).
2. Native re-check of what was only driven in the web build, and the Apple round's shared changes on Windows (lane 1).
3. The one-second rule proven at 4x throttle, with a table in the docs (lane 2).
4. One path value, so `Plan.md` and `plan.md` can never be two documents (lane 5).
5. `#tags` drawn as tags (lane 3).
6. A quoted list value with a comma breaks on its way back from the properties rows (lane 3).
7. History in web tabs (lane 4).
8. Delete browsing data (lane 4).
9. A private tab (lane 4).
10. Every drive run nightly in CI through one harness (lane 8).
11. Tooltips that carry their key (lane 6).
12. The pointer hides while typing (lane 3).
13. A canvas of 10,000 strokes repaints in a frame (lane 9).
14. A huge file, a trash on another drive, a half-done copy: the crate stops failing silently (lane 12).
15. The name the reader sees is nibeditor everywhere (lane 10).

## 1. hunt-7 - nothing half-working

Emil's standing rule after big pushes (`test-everything-after-pushes.md`, 2026-09-13), and
482 commits have landed since the last hunt on 2026-09-17, a whole Mac and iPhone round
among them. Runs now on the surfaces nobody is rebuilding, and again after the wave.

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| The areas the 09-17 hunt never reached: sync, sharing, collaboration, sign-in and publishing on a local Worker; the ten exports and twelve importers in depth; PDFs (viewer, highlights, search, embeds); touch and drag-and-drop of tabs and rows | batches, 2026-09-17 "NOT REACHED" | each area driven with evidence, every bug fixed at the cause with a failing-first test, a clean list | L | high | none |
| Native re-check of what was only driven in the web build: address completion over a live page (#4), the Chrome strip's drag (#7), preview tabs for web, canvas, pages and PDF (#10), Ctrl and middle click inside a page with real input (#20) | task queue, 2026-09-27/28 | driven on a probe build through `run_probe`, CDP input on the probe's own webview, never the page-first key step | M | high | none |
| The Apple round's changes to shared code (format bar, menus, tables, sheets, palette, first-run space chooser) re-driven on Windows and the web build | commits 2026-09-28/29 | no Windows or web regression, or each one fixed | M | high | none |
| The Even plugin on the simulator after a month of strings and shell changes; repack and bump `even.app.json` only if the package changed | `nib-even-version-bump.md` | the simulator drive green, package under 8 MiB | S | med | none |
| The q-errors-2 follow-ups: a blank folder note written over, `openNote` answering null silently | task queue #28, 2026-09-28 | reproduced or ruled out with a test | S | med | none |

Off limits (report instead): saving and unsaved state, file associations and Ctrl+O, the
mirror and conflicts, web-tab injection, the palette, the terminal,
archive, the right sidebar, theme settings, CEF.

## 2. launch-2 - under one second, proven

Emil's hard rule (`nib-product-philosophy.md`, 2026-09-14): nib opens in under a second
even on slower devices and looks fully loaded. Round 1 (e39f3741) put the window up in its
own colour at 46 ms warm; round 2 was queued for a quiet machine and never ran.

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| A quiet re-measure, cold and warm, empty and 5,000 notes, on a release probe through `launch.py` | batches, startup round 2, 2026-09-15 | a table in `docs/conventions.md` with medians and the machine's load stated | S | high | none |
| A slow-device figure: CDP CPU throttling at 4x inside the probe's WebView2, and the Android APK over adb where a device answers | same | the sub-second claim holds at 4x, or the gap is named | M | high | none |
| A long-task guard: tasks over 50 ms between the first frame and the end of the launch order, counted in a drive and held in CI | same | a red build the day a launch grows a long task | M | high | lane 8 helps |
| The next levers if the table says so: CodeMirror and the live preview behind the tree's paint, the WebView2 environment overlapped with the window (358 ms, 58-62% of time to first paint), `lib/web-tab/pages.svelte.ts` out of first paint | batches 2026-09-15, q-perf 2026-09-28, task queue #12 | measured before and after; nothing lost | L | high | `rs/engine.rs` and `rs/launch.rs` after #46 and #51 |
| The budget back under 3,250,000: phone-only code the Apple round put in every desktop first paint behind doors | `apps/desktop/test/weight.test.ts` history, 2026-09-29 | `BUDGET` lowered, measured, no phone regression | S | med | none |

## 3. editor-feel - writing feels right

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| `#tags` drawn as tags: a quiet pill in the live preview and the reading view, a press searches `tag:`, the same class on published pages and exports | batches, hunt 2026-09-17 ("no visual treatment in a note, unlike Obsidian") | the tag reads as a tag everywhere a note is drawn; headings, code, links and URLs untouched | M | high | none |
| The pointer hides while typing in a note or a canvas card and comes back on the first move, as in Chrome, Word and VS Code; the engine's own hiding is off since b3162238 | task queue #18, 2026-09-28 | typing hides it, a move shows it, a web page is not affected | S | high | none |
| BUG: `flowItems` in `md/yaml.ts` splits a quoted value on its commas while `flowItem` writes exactly such values, so `["a, b", c]` comes back as three | batches #86, 2026-09-12 | round trip through the properties rows, Obsidian's reading kept, a fixture test | S | high | none |
| The format bar left on screen when a tab switches into the reading view | batches #93, 2026-09-12 | verified gone, or fixed with a test | S | med | none |
| Random note, a command and a palette row (Obsidian core) | gaps list, 2026-09-09 | opens a random note of the space, archived and excluded ones left out | S | low | none |

## 4. browser-parity - Chrome's own features

What `nib-browser-vision.md` (2026-09-13) keeps inside the browser and nib still lacks.
Everything here waits for the injection rework, the scroll fix, the engine switch and the
default-browser work, which all rewrite the same files.

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| History: every page a space's web data has visited, searchable, open, remove; Ctrl+H and a row in the dots | browser vision 2026-09-13; `docs/web-tabs.md` "What is left" | Chrome's shape, the per-space history rule kept, virtualised | M | high | #40 #41 #46 |
| Delete browsing data: cookies, cache, site data and history for a time range, per space store or all | same | cleared through the engine's own call (WebView2 `ClearBrowsingDataAsync`, `WKWebsiteDataStore`), `nib:web-visits` cleared with it | M | high | same |
| A private tab: an ephemeral profile that writes no history, visits or places, marked on the tab | power-user "Later"; browser vision "incognito as an ephemeral profile" | nothing it saw survives closing it; the key per Q3 | L | high | same |
| A search engine choice: Google is hard-coded in `lib/web-tab/address.ts` | browser vision "address bar and search engine choice" | one row, Chrome's list plus a custom `%s` | S | med | none |
| Dragging a link or a picture out of a page onto the strip (a tab) or the file list (a web note, a picture copied in) | power-user "Later" | both drops work; nothing else leaves the page | L | med | #40 #46 |
| After answering a site's permission bubble the keyboard goes back to the page | task queue #19, 2026-09-28 | the next key reaches the page | S | med | #40 |
| `URL=` follows the page on the notes' own idle delay and is flushed on quit; IndexedDB, service workers, permissions and zoom proven to survive a relaunch | Emil 2026-09-14, queue item 2 | `web-session-probe.py` extended and green; the across-devices half is sync v2's | S | med | #38 #43 |

## 5. robust-core - one path, one event

Emil, 2026-09-17: "Our application should be very robust." The architecture review found
identity kept in five places. One document per file (2bb7b06f) and rename keeping the note's
id (80b9de44) landed; two faults are left.

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| One path value with one comparison and one normalisation (separators, case, composition) for `documentAt`, `everyPath`, positions, arranged, excluded, folder icons, bookmarks and the link index | batches, identity round 2026-09-17 ("remaining hole") | `Plan.md` and `plan.md` on Windows and macOS are one document everywhere; the bare `===` comparisons gone, a scan test holds it | L | high | #38 #39 #45, sync v2's mirror lane |
| One file-operation event (created, moved, removed, with the old and new path) every store listens to, instead of the hand-written notifications per operation | batches, architecture verdict 2026-09-17 | a new store cannot forget a rename; the tests prove each store follows | L | high | same |
| The three finished migrations out: `nib:pinned` to bookmarks, the theme-side and contrast reads, the legacy mirror shapes | batches #122, 2026-09-13 | deleted per Q17; the mirror one with sync v2 | S | low | Q17 |
| `lib/search/tags.ts` reads the front matter block through the shared reader, the last copy | batches #91, 2026-09-12 | one reader | S | low | none |

## 6. tabs-hints - tabs and hints like Chrome

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| Every icon-only control's tooltip carries its key from the registry, `Back (Alt+←)`, through one helper | power-user "Later", 2026-09-28 | title bar, sidebar, panel tabs, web bar, find bar, canvas bar; a key rebound shows at once | M | high | #33 #37 |
| Tab hover cards after Chrome's delay: the name, where it lives, a still of a web page | power-user "Later"; `docs/chrome-tabs.md` | Chrome's timing, never over a menu, reduced motion honoured | M | med | same |
| Several tabs selected with Ctrl and Shift, then closed, moved, pinned or bookmarked together | same | drag carries the group; one undo | M | med | same |
| A file-list row dragged out to Explorer or a mail arrives as the file | power-user "Later" | an export by drag, nothing opened in place | L | low | #39 #45 |

## 7. design-pass - one design, no stragglers

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| 65 literal `z-index` values in the components onto a few tokens, with a guard | q-design, 2026-09-28 ("z-index tokens later") | one stack order, written once | M | med | #42 #50 |
| The round button's 18 px corner, the close glyph drawn in two view boxes, two footer vocabularies (`.primary`, `.pill` beside `.nib-button`) | batches #78, #90, #122 | one of each, guarded by one-of-each | S | med | same |
| `id="write"` twice in the presenter and in the hover card | batches #90 | ids unique, the themes still reach both | S | low | none |
| The explanatory copy: every sentence that explains rather than names, listed; the obvious ones cut, the rest to Emil | q-design 2026-09-28; the philosophy | a list with a proposed cut per line | M | med | Emil reads the list |
| Ink on an accent fill in dark mode (white is 3.98:1) | batches #78, #90, q-design | the token Emil picks in Q16 | S | med | Q16 |

## 8. drive-harness - drives anyone can trust

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| One harness for the 61 drives that each carry their own HTTP server: build once, serve, seed, wait on the handle, `NIB_SPACES_DIR` in a temp folder | batches, 2026-09-17 | every drive on it, `run-all.py` faster, new drives start from it | L | high | none |
| A nightly and on-demand CI job running `run-all.py` on the web build, shots uploaded, red on a failed drive | batches 2026-09-17 ("no CI job had ever run the drives"); only `smoke.py` runs | a nightly result nobody has to ask for | M | high | the harness |
| Hygiene: `space-rename.py` hangs in teardown, `speed.py`'s canvas part times out after a full run, per-test budgets for `account.test.ts`, `canvas/ink.test.ts` and the Worker's `share-items.test.ts` | batches #116, 2026-09-14, 2026-09-17 | green alone and under load | S | med | none |

## 9. perf-hotspots - the slow spots left

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| A canvas with 10,000 strokes spends about 400 ms per repaint filling one accumulated path: paths per region or a tile cache | batches, speed round 5, 2026-09-13/14 | a repaint under 50 ms at 10,000 strokes, a counted test | M | med | none |
| The link scan reads 128 notes at a time (`SCANNED_AT_ONCE` in `lib/web/commands.ts`), so a chunk holding a 7 MB canvas is one 600-985 ms read: chunk by bytes, the Rust twin in `rs/links.rs` too | batches #88, 2026-09-12 | no read over 50 ms, a counted test both sides | S | med | none |
| Measure first: the file list re-creating its rows on a space switch (~50 ms), the reading view's render of a 1.26 MB note (~250 ms) | q-perf 2026-09-28; batches #124 | measured; fixed only inside the constraints already written down | S | low | none |

## 10. naming-docs - one name, true docs

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| The name a reader sees is nibeditor: the welcome note (the old text still recognised as untouched), the sign-in and invite mails, the Mac menu bar, window titles, the OAuth resource name, the AUR and Nix `.desktop` files | `nibeditor-naming-and-launch.md`, 2026-09-08; hunt #123 | no "Nib" a reader sees; bundle id, winget ids and asset names untouched | S | med | Q18 |
| The docs made true: `docs/typora-parity.md` still has the mermaid-on-pages and Lines rows open (both built) and says Reveal is not built (it is, as Show in folder); `docs/power-user.md`'s "In progress" row is done; the "What is left" lists refreshed once the wave lands | this audit | every open row open, every done row done | S | med | the wave |
| README: a winget row once PR 429968 merges; the comparison's iOS cell once an installable iPhone app exists | batches #40, #49 | rows match what ships | S | low | external |

## 11. security-2 - the lows and the CSP

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| Form answers have no retention and no ceiling (about 11 GB a month is possible against D1's 10 GB) | security round, 2026-09-13 | a per-space ceiling and an age sweep in the nightly cron; the sheet says what it keeps | S | med | a migration number agreed with #43 |
| Second-factor secrets are sealed under `OPENAI_KEY_SECRET`, so rotating that key locks out every enrolled account: a secret of their own, re-sealed on next use | P10 and #89, 2026-09-12 | rotation of either secret leaves the other working | S | med | none |
| The desktop CSP keeps `'unsafe-inline'` for scripts on WebKit and Firefox because the frames' bootstrap is inline; `presenter.html` and `even.html` carry no policy | #94, 2026-09-12; q-security 2026-09-28 | the bootstrap an external same-origin script, `script-src` without `'unsafe-inline'` everywhere, both entries covered by `csp.test.ts` | M | med | none |
| An embed frame whose origin is the app's own is refused (allow-same-origin stays for YouTube and Vimeo) | security round, 2026-09-13 | one check, one test | S | low | none |

## 12. rust-hardening - the crate's leftovers

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| `read_note` reads any file whole: a multi-gigabyte file aborts the app | q-rust leftovers, 2026-09-28 | refused past a ceiling with a sentence, the web twin too | S | high | #39 |
| The trash is a `rename`, which fails across volumes: a space on another drive cannot delete | same | copy and remove when the rename says cross-device, tested | S | med | none |
| `copy_all` skips what it cannot read and reports success | same | all or nothing, or an honest partial answer | S | med | #39 |
| `offered` in `rs/updates.rs` checks the file name contains the version, so 0.1 matches 0.10.0 | this audit | the version matched as a whole token | S | med | none |
| The rest of the list: the downloads commands off the window's thread, the themes seed, the dead `sort` and `descending` in `TreeOptions` | q-rust 2026-09-28; batches 2026-09-14 queue item 5 | each done or ruled out; the draft-PR proof | S | low | none |

## 13. clipper-import - one extractor

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| Mozilla's Readability moves out of `apps/clipper/src/lib/extract.ts` into the markdown package so a web tab's Clip uses it too | `docs/web-tabs.md` "What is left" | one extractor, both clips produce the same note from the same page | M | med | #40 |
| The clipper's fortieth catalogue: `yue` still answers Hong Kong written Chinese | batches, fixer C2, 2026-09-14 | 40 catalogues, the same negotiation as the app | S | low | none |
| Apple Notes tables, drawings and scans are counted, not converted | batches #95, 2026-09-12 | tables as markdown tables, drawings and scans as pictures where the database holds them | M | low | none |

## 14. iphone-platform - what Android has

The Apple round (2026-09-29) made the iPhone build real. What Emil asked for phones in P13
(2026-09-09) exists on Android only, and the iOS project is generated by hand, not
committed. Waits on Q6.

| item | asked | done means | size | value | deps |
| --- | --- | --- | --- | --- | --- |
| A share sheet extension: text, links, pictures and files into a note | P13, 2026-09-09 | the same `applyImport` road the Android target takes | L | med | Q6 |
| Home and lock screen widgets | P13 | a WidgetKit widget drawing the rows the page decides, as on Android | L | med | Q6 |
| Siri, Spotlight and Shortcuts: new note, search, open a note | gaps list; P13 "quick action" | App Intents over the command registry | M | low | Q6 |
| The PWA as a share target: `share_target` plus a POST route in `apps/desktop/public/sw.js` | `docs/mobile.md` | a share from another app lands as a note in the browser build | M | low | none |

## In flight

Excluded from the lanes; the task numbers are the task queue's.

| state | work |
| --- | --- |
| running | #33 Alt+digits, #37 one global search, #40 Google Sheets and page globals, #34 the terminal, #43 sync v2 design |
| landed today | #35 the Ctrl+T cards (d4f88dc9), #36 Ctrl+W on a pinned tab (4a0aa764), #31 the empty strip's menu and the favicon drag (0f4d1024, 4e05de31), #29 account deletion (024d34fb) |
| queued | #50 theme picker, #49 the AI-native agent browser framework (design pending), #48 cleanup, #42 Glass, #41 web-tab scrolling, #38 autosave only, #39 no local files, #45 archive, #46 the engine switch, #47 the right sidebar's Ask panel and Properties, #51 nib as the default browser |
| held | #24 release v0.10.0 on branch `release`, waiting for #33 and #37 |

Suggested for #48 on top of its brief: the stale stash `worktree-agent-ac19bb2a115bf59b8`,
the Actions caches PR #76 left, and the `ci-check-*` branches still on origin.

The unmerged branches, all 482 commits behind `main`: `worktree-agent-archive` is #45's
reference, `worktree-agent-right-sidebar` #47's, `worktree-agent-adf3a62186e99c1e5` (CEF
batch 2) #46's, and `worktree-agent-crash-recovery` is dropped below.

Blocked on #46's verdict rather than a lane now: Chrome extensions, `chrome://` pages as
tabs, Translate, the extension list on the account, PDF export under CEF.

## Waiting on Emil, not code

- Store accounts and tokens: `SNAPCRAFT_STORE_CREDENTIALS`, the AUR key, the Flathub
  submission PR (AI may not open it), `PACKAGING_TOKEN` and `WINGET_TOKEN`, a Play account,
  an Apple developer team for TestFlight.
- The Even Hub public release, and the device checks on record: the Samsung tablet's S Pen
  and Android runtime list, the glasses' 16 kHz audio, the widget and tiles on a device.

## Product questions

Each has a recommendation; a lane that depends on one proceeds on it unless Emil says
otherwise.

| # | question | recommendation |
| --- | --- | --- |
| Q1 | Every desktop row menu offers Show in folder (Reveal in Finder on a Mac) since the Mac round, though Emil ruled on 2026-09-09 that there is no Reveal and no Copy path. Keep it? | Remove it: nib is not a file manager, which #39 makes stronger |
| Q2 | Tabs wear the file's chosen icon since 9e9c2cdf (2026-09-17); on 2026-09-13 Emil asked for an icon by kind, never the chosen one. Which? | Emil's 09-13 rule, unless the 09-17 change was his |
| Q3 | Chrome's Ctrl+Shift+N (private) is nib's New window. What opens a private tab? | Ctrl+Shift+N for the private tab; New window keeps its row and palette entry |
| Q4 | Comment threads and suggested edits on notes (the biggest collaboration gap to Notion and Google Docs) | Yes, as a design batch after sync v2 |
| Q5 | Boards and database views stay dropped with Bases, daily notes and templates? | Yes, for now |
| Q6 | Commit the iOS project and build its native targets (share extension, widgets), and is there an Apple developer team? | Yes once there is a team |
| Q7 | Do version bytes count against the 1 GB quota? | No; the 2 GB ceiling stays the limit |
| Q8 | The CI sync token is per account. Per space instead? | Per space (least privilege) |
| Q9 | Merged cells and coloured header rows as HTML tables? | No; pipe tables stay |
| Q10 | The updater's signing key: regenerate with a passphrase in a reviewed environment, with a rotation story? | Yes, before 1.0 |
| Q11 | Published sites as siblings of the app, API and mail on one domain, or a separate apex? | A separate apex before custom sites grow |
| Q12 | A published site's language: English, or the owner's? | The owner's |
| Q13 | OneNote `.one` import from Microsoft's published format | Skip; the HTML export route stays |
| Q14 | Highlight colours: does plain move to yellow? Does the line-break setting reach the glasses? | Neither |
| Q15 | The remaining small defaults kept as they are unless Emil objects: allow-same-origin on embeds, an `ai` fence's unterminated answer, the macOS CI row on every Rust change, `x-callback` only to web schemes, the automation eval switch in a file not a setting, no key file on Linux without a keyring, Alt+click for multi-select in the file list, "Copy link" singular for several blocks | Keep |
| Q16 | Ink on an accent fill in dark mode | A per-scheme ink token |
| Q17 | Delete the three finished migrations | Yes; every v0.5-era install has updated since |
| Q18 | The display name is nibeditor everywhere a reader sees it, identifiers untouched | Yes, per 2026-09-08 |

## Dropped

| item | why |
| --- | --- |
| Crash recovery for unsaved tabs (`worktree-agent-crash-recovery`, uncommitted) | #38 makes a blank tab a file on its first character, and a web tab is ephemeral on purpose; #48 keeps the patch |
| The unsaved-tab save sheet and Save as | #38 removes manual saving |
| `worktree-agent-tab-drag`, `web-furniture` | superseded by e309c1d0 (the Chrome strip) and 5290c600 (the notices row) |
| `fix/effect-test-flakes` | its commits are on `main`; what is left in its worktree is an untracked scratch tool |
| Web-note state across restarts (2026-09-14 queue item 2) as its own batch | session cookies last (f47877a4, fdf29aad), the address follows the reading; what is left is lane 4's last row and sync v2 |
| The rooms' remaining conflict races and the 5,000-body first upload | sync v2's |
| Notion Mail | shut down 2026-09-22 |
| An Articles flat list | the tree answers it (`docs/tree.md`) |
| Tab groups, Google Lens, Cast, the bookmark bar | dropped in the browser vision |
| Canvas nodes that rotate | JSON Canvas has no field for it |
| Background sync on Android | a second protocol in Kotlin; a note is a file and the next pass pushes it |
| Handwriting from Samsung Notes, GoodNotes, Notability, Apple Notes | none documents its format; PDF is the interchange |
| Liquid Glass imitation on the iPhone | WebKit cannot bend light; `docs/mobile.md` |
| A picture uploader (PicGo) | sync already carries pictures |
| The 630 ms frame at the end of a huge note | an Event Timing artifact; real keystrokes are 25-33 ms |
| Fewer lines by fewer comments | comment density is the house style |
| Pull-to-refresh on a phone | the window is pinned; the pull runs a command instead |

## Verified done since the lists were written

So none is queued again: a case-only rename on Windows and macOS (`rs/notes.rs`
`respelled`), a window coming back on the note it was left on (6bc7a645), one document per
file (2bb7b06f), a rename keeping the note's id on the account (80b9de44), a chord in a list
reaching the app (904f7a0b), Ctrl+Shift+Z redo, `present` on the drive handle, the shipped
build drivable (d4bdbad8), the audit fixers A1, A2, B, C1 and C2 (covers, properties, high
contrast, footnotes, stacked tabs, `content:`, Lines, RSS, the recorder on desktop, window
frame and translucency, Ctrl+=/-/0, `nib://append`), every power-user batch, links opening
as nib tabs (f7afb642), the web tab's session login across restarts, the legacy recovery
codes, the old `lxorb/nib` URLs (only the historical winget 0.4.0 manifest keeps them), and
the unguarded storage reads.
