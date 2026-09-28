# Power-user gaps

The small things people from Chrome, VS Code, Obsidian, Typora and Notion expect without
thinking. Every row was checked against `main` at 5290c600 (2026-09-28). What already
exists is left out, and so is anything on the parity list (memory
`nib-gaps-2026-09-09.md`, `nib-parity-roadmap.md`), which is all on main now.

Paths: `lib/` = `apps/desktop/src/lib`, `ed/` = `packages/editor/src`, `rs/` =
`apps/desktop/src-tauri/src`. Size: S = hours, M = a day, L = more. Every batch keeps to
its own files, except three that everyone appends to: `lib/shortcuts/registry.ts`,
`lib/commands.ts` and the 39 locale catalogues. Rebase conflicts there are one-liners.

## In progress

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Links | Ctrl+click and middle-click on a note link or a list row opens a new tab | Chrome, Obsidian, VS Code | in progress | agent `ctrl-click`, branch `feat/ctrl-click-new-tab`; `ed/wikilink/follow.ts:63` reads button 0 only | M | high |

## Batch 1: web tab, the page itself

`rs/web_tabs.rs`, `rs/web_keys.rs`, `lib/web-tab/WebTab.svelte`, `lib/web-tab/pages.svelte.ts`. Rust batch: draft PR and CI.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Web | Ctrl+F finds in the page: nib's find bar over the engine's find, plus a Find row in the dots | Chrome | missing | `edit.find` is editor-scoped and a web tab has no editor; `docs/web-tabs.md:1123` "Find wants an in-page find bar" | M | high |
| Web | Ctrl+click or middle-click on a link in a page opens a tab behind; Ctrl+Shift+click opens it in front | Chrome | partial | every window a page asks for opens in front: `lib/web-tab/pages.svelte.ts:810` passes `behind = false`, and `rs/web_tabs.rs:912` drops the features | M | high |
| Web | Fullscreen video (YouTube `f`) fills the screen | Chrome | missing | no `ContainsFullScreenElementChanged` handling in `rs/web_tabs.rs`, so the element only fills the pane | M | high |
| Web | Ctrl+L, Alt+D and F6 reach the address field while the page has the keyboard | Chrome | partial | `rs/web_keys.rs:86-99` reserves only T/W/N/Tab/PgUp/PgDn/digits; Ctrl+L stays the site's (`docs/web-tabs.md:604`) | S | high |
| Web | Audio indicator on the tab, and Mute site | Chrome | missing | nothing reads `IsDocumentPlayingAudio`/`IsMuted` in `rs/web_tabs.rs`; no Mute row | M | med |
| Web | Page zoom stays in sync with Ctrl+wheel inside the page and is remembered per site | Chrome | partial | `lib/web-tab/WebTab.svelte:359` resets `zoom = 1` on every mount; `rs/web_tabs.rs:1348` only sets it, with no zoom-changed listener | M | med |
| Web | F12, Ctrl+Shift+I and Inspect open DevTools | Chrome | missing | the `devtools` feature is not in `src-tauri/Cargo.toml:64`, so release builds have none, although `docs/keyboard.md:319` lists F12 | S | med |
| Web | "View page source" in the engine's menu opens a tab | Chrome | partial | the `view-source:` window it asks for is dropped by `handed_over` (`rs/web_tabs.rs:557-583`) | S | low |

## Batch 2: the quick switcher and palette

`lib/Palette.svelte`, `lib/fuzzy.ts`, `lib/focus.ts`, `lib/search.svelte.ts`.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Palette | An empty field lists recently opened notes first | Obsidian, VS Code | done 84ad979a | `lib/Palette.svelte:37` ranks `workspace.files` with score 0, which keeps file order; recents appear only as `>` rows (`lib/commands.ts:929`) | S | high |
| Palette | With no match, Enter (Obsidian: Shift+Enter) creates the note | Obsidian, Notion | done 84ad979a | `lib/Palette.svelte:227` shows "Nothing found" and nothing else | S | high |
| Palette | Fuzzy matching on the folder path too, with the folder shown beside notes that share a name | VS Code, Obsidian | done 84ad979a | `lib/Palette.svelte:37` matches `shownName(one.name)` only, and rows show no path | S | high |
| Palette | Ctrl+Enter opens in a new tab, Ctrl+Alt+Enter to the side | Obsidian, VS Code | Ctrl+Alt+Enter done 786b37f5; Ctrl+Enter is agent `ctrl-click`'s | `choose` (`lib/Palette.svelte:66`) only ever calls `openEntry` | S | med |
| Palette | `#` jumps to a heading of the open note; `:42` goes to a line | VS Code (`@`, `:`), Obsidian | done 84ad979a | the only prefix is `>` (`lib/Palette.svelte:25`) | M | med |
| Palette | Recently used commands come first under `>` | VS Code | done 84ad979a | an empty term leaves `appCommands` in list order | S | med |
| Search | Ctrl+Shift+F with a selection starts the space search on it | VS Code, Obsidian | done 5ef06aa4 | `revealPanel` (`lib/focus.ts:133`) sets no query | S | low |

## Batch 3: file list, keys, clipboard and drops

`lib/Tree.svelte`, `lib/drag-paths.ts`, and the workspace file ops (`lib/workspace.svelte.ts`, copy and paste only).

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Files | Ctrl+C / Ctrl+X, then Ctrl+V into the focused folder, copies or moves the selected notes | Explorer, VS Code | missing | `onKey` (`lib/Tree.svelte:299-345`) handles only select all, delete, rename and move up/down | M | high |
| Files | Dropping files or folders from Explorer onto the list copies them into the space | Explorer, VS Code, Obsidian | missing | tree drops accept `text/nib-path` only (`lib/drag-paths.ts:46`); `dragDropEnabled: false` (`src-tauri/tauri.conf.json:22`) | M | high |
| Files | Ctrl+Z / Ctrl+Y with the list focused undoes or redoes the last file action | Explorer, VS Code | partial | undo is only a menu row and a palette row (`lib/row-menu.ts:161`, `lib/commands.ts:899`) | S | high |
| Files | Shift+↑↓ extends the selection and Ctrl+Space toggles a row | Explorer, VS Code | missing | the selection comes from clicks only (`lib/Tree.svelte:206-217`) | S | med |
| Files | Ctrl-drag (Alt on a Mac) copies instead of moving | Explorer, Finder, VS Code | missing | `effectAllowed = 'move'` (`lib/drag-paths.ts:31`), `dropEffect = 'move'` (`lib/Tree.svelte:612,621`) | S | med |
| Files | Ctrl+N with the list focused makes the note inside the focused folder | VS Code, Obsidian | partial | `app.new` → `workspace.openBlank()` (`lib/shortcuts/registry.ts:278`) ignores the list | S | med |
| Files | Ctrl+D duplicates the selected note | Finder, Notion | missing | Duplicate is a menu row only (`lib/row-menu.ts:78-81`) | S | low |

## Batch 4: everywhere

`rs/launch.rs`, `rs/lib.rs`, `src-tauri/tauri.conf.json`, `apps/desktop/src/App.svelte`, a new `lib/field-menu.ts`, `lib/StorageWarning.svelte` (the toast pattern). Rust batch.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Window | Size, position and maximised state come back at launch | every desktop app | done 5a67f3f7, d1372b4a | always 1180×760 (`src-tauri/tauri.conf.json:16`, `rs/launch.rs:56`); nothing saves the bounds | M | high |
| Fields | Right-click in a text field (address, search, find, rename, settings) gives Cut, Copy, Paste and Select all | every OS, Chrome | done fba14421 | `App.svelte:683` blocks every native menu, and the fields have none of their own | S | high |
| Undo | A deleted or moved file gets a short "Undo" toast | Notion, Gmail | done 897ecee5 | undo is reachable only through the menus (`lib/row-menu.ts:158-162`) | S | med |

## Batch 5: the tab strip

`lib/Tabs.svelte`, and the tab ops in `lib/workspace.svelte.ts`.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Tabs | Close tabs to the right | Chrome, VS Code, Obsidian | done 536bebb9 | `tabMenu` (`lib/Tabs.svelte:147-177`) has Close and Close others only | S | high |
| Tabs | Close all tabs, as a menu row and a palette row | VS Code, Obsidian | done 536bebb9 | same; the palette has only `close` | S | med |
| Tabs | Duplicate tab | Chrome, Obsidian | done 536bebb9 | no row and no command | S | med |
| Tabs | Move the tab to the other pane, or split and move, by menu and by key | VS Code (move editor), Obsidian | done 536bebb9 (Ctrl+Alt+Shift+Right) | `split` copies the tab (`lib/workspace.svelte.ts:3552-3569`); a tab can only be moved by dragging | S | med |
| Tabs | Rename the note from its tab (a menu row, F2 on a focused tab) | Obsidian, VS Code | done 536bebb9 | no Rename row in `tabMenu` | S | med |
| Tabs | A web tab's own menu: Reload, Copy link, Mute site | Chrome | partial 536bebb9: Reload and Copy link; Mute waits for batch 1 | `tabMenu` has no `kind === 'web'` rows; Mute needs batch 1 | S | med |
| Tabs | Dropping a URL or a link from another app onto the strip opens a web tab | Chrome | done 536bebb9 | `over` (`lib/Tabs.svelte:681`) accepts tree drags only | S | low |
| Tabs | The mouse wheel scrolls an overflowing strip | VS Code | done 536bebb9 | `.tabs` has `overflow-x: auto` and no wheel handler | S | low |
| Tabs | Ctrl+Tab in most-recently-used order, as an option | VS Code | done 536bebb9 (Settings, General) | `cycleTab` walks the strip in order (`lib/shortcuts/registry.ts:1037`) | M | low |

## Batch 6: web tab, bar and keys

`lib/web-tab/WebBar.svelte`, `lib/web-tab/AddressField.svelte`, `lib/web-tab/menu.ts`, plus `web.*` entries in the registry.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Web | F5 / Ctrl+R reload and Ctrl+Shift+R / Ctrl+F5 hard-reload while a web tab is in front | Chrome | missing | F5 is Present (`lib/shortcuts/registry.ts:718`) and nothing is bound to `Mod-r` | S | high |
| Web | The reload glyph becomes a cross while loading, and Escape stops the load | Chrome | missing | one glyph that only turns (`lib/web-tab/WebBar.svelte:180-192`) | S | med |
| Web | Right-click or long-press on Back or Forward lists the history | Chrome | missing | the arrows have `onclick` only (`lib/web-tab/WebBar.svelte:150-172`); note tabs already have `trailMenu` (`lib/Tabs.svelte:63`) | S | med |
| Web | Ctrl+1…9 jump to a tab while a web tab is in front | Chrome | partial | `rs/web_keys.rs:99` forwards Ctrl+digit, but the jump is bound to Ctrl+Alt+digit (`lib/shortcuts/registry.ts:788-799`) | S | med |
| Web | Alt+Enter in the address field opens the address in a new tab | Chrome | missing | `lib/web-tab/AddressField.svelte:218-224` reads Ctrl only | S | low |
| Web | Middle-click on Back, Forward or Reload opens the result in a new tab | Chrome | missing | the bar buttons handle `onclick` only | S | low |

## Batch 7: editor, line and text commands

`ed/lines.ts` (new), `ed/keymap.ts`, `ed/paste.ts`, `ed/commands.ts` (`toggleTask`), `EDITOR_ENTRIES` in the registry.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Editor | Pasting a URL over a selection makes `[selection](url)` | Obsidian, Notion, GitHub | missing | `richPaste` (`ed/paste.ts:113-165`) never looks at the selection | S | high |
| Editor | Delete line | VS Code Ctrl+Shift+K, Obsidian Ctrl+D | missing | Mod-Shift-k is Code block (`ed/keymap.ts:157`), and there is no command id | S | med |
| Editor | Expand and shrink the selection (word → inline → block → section) | VS Code Shift+Alt+→ | missing | CodeMirror's `selectParentSyntax` (Mod-i) is shadowed by Italic (`ed/keymap.ts:115`), and there is no id | S | med |
| Editor | Ctrl+Enter on a plain line or bullet makes it a task, and the next press ticks it | Obsidian | partial | `toggleTask` gives way on lines that are not tasks (`ed/commands.ts:185-202`) | S | med |
| Editor | Sort lines and reverse lines (the selection) | VS Code, Sublime | missing | no command | S | low |
| Editor | Upper, lower and title case for the selection | VS Code | missing | no command | S | low |
| Editor | Join lines | VS Code Ctrl+J | missing | no command | S | low |
| Editor | Insert a line above (Ctrl+Shift+Enter) | VS Code | missing | only below exists, as CodeMirror's `insertBlankLine` under Mod-Enter | S | low |
| Editor | Alt+Enter in the find bar selects every match | VS Code | missing | `edit.select-all-occurrences` has no key, and the find bar has no such press | S | low |

## Batch 8: editor, context menu and link gestures

`lib/editor-menu.ts`, `ed/wikilink/follow.ts`, `ed/images.ts`.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Editor | On a link: Copy link address, Edit link, Remove link | Chrome, Obsidian, Notion, Typora | missing | `linkEntries` (`lib/editor-menu.ts:516-523`) offers only Open in the browser | S | high |
| Editor | On a note link: Open in new tab, Open to the right, Copy link | Obsidian | missing | same; note links get no rows at all (the new-tab path comes from `ctrl-click`) | S | med |
| Editor | Ctrl+Alt+click on a note link opens it to the right | Obsidian | missing | `noteClicks` (`ed/wikilink/follow.ts:63-78`) reads button 0 plus the modifier only | S | med |
| Editor | On a picture: Copy picture, Open picture, Show in file list, Delete | Typora, Obsidian, Chrome | missing | `lib/editor-menu.ts` has no picture rows | M | med |
| Editor | Dropping any file (PDF, audio, zip) from Explorer into a note copies it beside the note and links it | Obsidian, Typora | missing | `ed/images.ts:108-121` accepts pictures only | M | med |

## Batch 9: file list menu, reveal, drag into a note

`lib/row-menu.ts`, `lib/Sidebar.svelte`, `lib/Pane.svelte` (drop), `workspace.revealFolder`.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Files | Dragging a row into a note's text inserts a link to it | Obsidian | missing | `lib/Pane.svelte:351` treats a tree drag as "open here", and the editor has no drop for `text/nib-path` | M | high |
| Files | Open in new tab and Open to the right in a row's menu | Obsidian, VS Code | missing | `rowMenu` (`lib/row-menu.ts:48`) has Open only | S | high |
| Files | Copy link: `[[Note]]`, in the link format the reader chose | Obsidian, Notion | missing | no row; the palette's "Copy link to this note" copies a `nib://` URI (`lib/commands.ts:924`) | S | med |
| Files | With several rows selected: Move, Bookmark and Open all, besides Delete | Explorer, Obsidian | partial | `selectionMenu` (`lib/row-menu.ts:95-107`) offers Delete and Undo only | S | med |
| Files | Collapse all folders | VS Code, Obsidian | missing | no command and no button | S | med |
| Files | Reveal the open note: unfold its folders and scroll to it (a command and a tab row) | Obsidian, VS Code | partial | `lib/Tree.svelte:877-891` scrolls only when the row is already unfolded; `revealFolder` (`lib/workspace.svelte.ts:2764`) serves bookmarks only | S | med |

## Batch 10: keyboard presets

`lib/shortcuts/presets.ts` and its test. Run after batch 7, which adds the commands these keys need.

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Keys | A VS Code preset: Ctrl+G go to line, Ctrl+Shift+K delete line, Ctrl+Shift+L all occurrences, Ctrl+B sidebar, Ctrl+\ split, Shift+Alt+→/← expand/shrink, Ctrl+]/Ctrl+[ indent/outdent | VS Code | missing | `PRESETS` (`lib/shortcuts/presets.ts:107`) is Default, Notion, Obsidian and Vim | S | med |
| Keys | The default indents on Ctrl+[ and outdents on Ctrl+], Typora's order and the reverse of VS Code, Obsidian and CodeMirror; the two presets swap them | VS Code, Obsidian | partial | `ed/keymap.ts:179-180` | S | med |
| Keys | The Obsidian preset also gets Ctrl+O (quick switcher), Ctrl+Alt+←/→ (back and forward) and Ctrl+D (delete paragraph) | Obsidian | partial | `OBSIDIAN` (`lib/shortcuts/presets.ts:44-51`) | S | med |
| Keys | The Notion preset gets Ctrl+D (duplicate block) and Ctrl+Shift+↑/↓ (move block) | Notion | missing | the grip has Duplicate and Move rows but no keys (`lib/editor-menu.ts:149-153`) | S | low |

## Later: too large for a batch

| area | behaviour | from | status | evidence | size | value |
| --- | --- | --- | --- | --- | --- | --- |
| Web | A private tab | Chrome | missing | no code; `docs/keyboard.md:316` describes it as if it were there (`docs/browser.md:1198` plans it for batch 6), and Ctrl+Shift+N is New window | L | med |
| Web | Dragging a link or a picture out of a page onto the strip or the file list | Chrome | missing | page drags stay inside the webview (`rs/web_tabs.rs:895`) | L | med |
| Tooltips | Hover titles carry the key, e.g. `Back (Alt+←)`, the panel tabs, the sidebar toggle, the find steps | Chrome, VS Code, Obsidian | partial | keys appear only in menus and the palette: `lib/Sidebar.svelte:571` `title={item.label}`, `lib/web-tab/WebBar.svelte:151`. Touches every surface, so it goes last | M | med |
| Files | Dragging a row out to Explorer or a mail | Explorer, VS Code | missing | a tree drag carries only `text/nib-*` types (`lib/drag-paths.ts:29-30`) | L | low |
| Tabs | Hover cards, tab groups, tab search, multi-select | Chrome | missing | `docs/chrome-tabs.md:134` | L | low |

## Decisions for Emil

The docs record these as skipped on purpose. People coming from other apps will still look for them.

| behaviour | from | recorded as | evidence |
| --- | --- | --- | --- |
| Reveal in Explorer / Finder, for a note | Typora, VS Code, Obsidian | not built on purpose | `docs/typora-parity.md:221-225` |
| Copy path / copy relative path | VS Code, Obsidian | not built on purpose | `docs/typora-parity.md:226` |
| Ctrl+Shift+L selects every occurrence | VS Code | the key is the sidebar's | `ed/keymap.ts:229-236`; batch 10 solves it through a preset |
| Double-clicking the empty strip opens a new tab | VS Code | it maximises, as in Chrome | `docs/chrome-tabs.md:105` |
