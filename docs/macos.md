# macOS

What the Mac build does differently from Windows and Linux, and the checklist it has to pass on a real Mac before a release. Everything under "Checklist" was built on Linux: the Rust type-checks for `aarch64-apple-darwin`, but none of it has run on a Mac yet.

## What is Mac-only

- **Frame.** The window keeps the system's traffic lights over Nib's own bar (`titleBarStyle: Overlay`, `tauri.macos.conf.json`, `appearance.rs` `own_frame`). `lights.rs` centres them in the bar and puts them back whenever AppKit lays the titlebar out again, which it does on every resize, new title and edited dot. The bar leaves `--traffic-lights` of room in whichever bar holds the top left corner: the tab bar, or the sidebar's head while it is docked open. Full screen gives the room back. No drawn window buttons and no hamburger on a Mac.
- **Menu bar.** Built from the same rows as the in-window menu (`native-menu.ts`, `native-menu-bar.svelte.ts`). Cut, Copy and Paste are the system's own rows, so they work in every webview. Undo, Redo and Select All hand their key to the page first, where the note, a canvas or a deck answers it, and to the system's own action when nothing there does, which is how a field and a web tab get it (`standIn`, `menu_bar.rs`).
- **Lifecycle.** Finder opens files through `RunEvent::Opened`. Closing the last window keeps Nib in the Dock, and clicking the Dock icon opens a window again. Cmd+Q asks every window about unsaved work (`lifecycle.rs`, `start.ts`). The window frame is restored at launch.
- **Window.** Its title is the note's name, the edited dot means unsaved, and it knows which file it stands for (`document_window.rs`).
- **Keys.** Mac defaults and key symbols (`shortcuts/registry.ts`, `keys.ts`, `docs/keyboard.md`).
- **Files.**
  - pandoc is found in Homebrew's folders.
  - Renaming a file or folder to change only its capital letters works.
  - Names are compared NFC-normalised.
  - iCloud-evicted notes are listed and downloaded when opened: the `.icloud` placeholder macOS 13 leaves, and the dataless file macOS 14 and later leave under the note's own name (`notes/icloud.rs`).
  - The file list has "Reveal in Finder".
- **WebKit.**
  - PDF export and printing go through WKWebView's print operation (`pdf.rs`).
  - Web tabs ask before using the camera or microphone.
  - Web tabs keep logins across restarts, and have download progress and snapshots.
  - pdf.js falls back to its legacy build on WebKit older than Safari 18.2.
- **Signing.** Ad hoc (`signingIdentity: "-"`) until a Developer ID exists. `release.yml` switches to real signing and notarization by itself once the `APPLE_*` secrets are set.

## Checklist

Run it on a Mac, on Apple silicon and, if possible, on Intel. For each item that fails, note the macOS version.

### Install

1. Download the `.dmg` from the release, open it, and drag Nib to Applications. Gatekeeper warns, because the build is not notarized. Open Anyway in System Settings > Privacy & Security starts it. It must not say "damaged".
2. The Dock and Finder icon is the same size as other apps' icons, with rounded corners.

> macOS 26.6 (25G72), Apple M5. 1 passes: the dmg, quarantined as Safari quarantines a download, says Apple could not verify Nib, and Open Anyway starts it. That depends on the ad-hoc signature this branch adds. The 0.9.1 release carries only the linker's signature on its binaries (`codesign --verify` says "not signed at all"), which is what Apple silicon calls "damaged". 2 passes on macOS 26 only because the system masks a full-bleed icon itself; the icon is an opaque square, so macOS 13 to 15 show it square and larger than its neighbours until it is on Apple's grid.

### Frame

1. The traffic lights sit centred in the 38px bar, and nothing in the bar sits under them. Check with the sidebar closed, docked open, and as a drawer in a narrow window.
2. Full screen: the lights disappear, and the bar gives their room back.
3. Settings > Appearance > system frame: a normal title bar appears, and the bar does not double the buttons.
4. Double-clicking the empty part of the bar zooms the window. Dragging it moves the window.
5. In a right-to-left language (Persian, Pashto): check where the lights sit and where the room is left.

> macOS 26.6 (25G72), Apple M5. All five pass after this round's fixes. 1: the lights sit on the bar's centre line, 19 of 38 points measured off the pixels, beside the sidebar button and the space's name on the same line, with the sidebar closed and docked open. A desktop window never becomes a drawer (`viewport.drawer` is a phone's and an upright tablet's), so the third case does not arise. Before, tao's `trafficLightPosition` left the lights three points above that line at launch and moved them to three points from the top on the first redraw; `lights.rs` places them now. 2: Nib's own Fullscreen puts the bar away altogether, and the green button's full screen gives the room back to the panel's head. 3: a white titlebar with the lights where AppKit keeps them, centred in its 32 points, and none in the bar. Switching used to leave the lights three points low and the page without the keyboard, so Escape and every shortcut went nowhere until a click. 4: a double click fills the screen and a second puts it back; a drag moves the window by exactly as far. 5, in Arabic: the lights stay at the left and so does the room for them, and the sidebar, docked at the right, has no gap at its far edge. The room used to follow the reading direction to the right.

### Menu bar

1. The bar reads Nib / File / Edit / Paragraph / Format / View / Window / Help, and its key hints match Settings > Keyboard.
2. In a note, Cmd+B, Cmd+W, Cmd+N and Cmd+Shift+T each run once.
3. Cmd+B typed in the sidebar search does not bold the note.
4. In a web tab:
   - Cmd+W closes the tab, not the window.
   - Cmd+T opens the new tab dialog.
   - Ctrl+Tab switches tabs.
   - Cmd+C, Cmd+V and Cmd+Z work in the site.
5. Edit > Undo and Paste, clicked from the menu, act on the note.
6. Cmd+, opens Settings.
7. Switching the language in Settings relabels the menu.
8. With two windows, the menu bar follows the focused window.
9. Open Recent lists recent notes, and so does the Dock icon's menu. Clear Menu empties both.

> macOS 26.6 (25G72), Apple M5, ABC - QWERTZ layout. On this macOS a key that a row of the menu bar holds never reaches the page: the menu answers it first, where a key no row holds (Cmd+Down) reaches the page as a keydown. Two items failed on that and pass after this round's fixes: 5, since Edit > Undo and Cmd+Z went to WebKit's own history, which holds only what was typed, so nothing made by a command (a heading, a list, a paste) could be undone, and a canvas or a deck never saw the key at all (Undo, Redo and Select All now hand their key to the page first; see `standIn` in native-menu-bar.svelte.ts); and 3, since Cmd+B typed into the search field arrived as the Bold row and bolded the note behind it (`keyRuns` in native-menu.ts). The rest pass. 1: the order is right; the hints are AppKit's, which localises a key equivalent for the layout in use, so on QWERTZ Source mode reads Cmd+ß, Zoom in Cmd+* and Code Ctrl+<, where Settings > Keyboard writes the registry's Cmd+/, Cmd+= and Ctrl+`. Both keys work. 2: Cmd+B, Cmd+W, Cmd+N and Cmd+Shift+T each ran once. 4: in a site, Cmd+W closes the tab and leaves the window, Cmd+T opens the dialog, Ctrl+Tab switches, and Cmd+A, C, V and Z act on the site's field. 6, 7 (German, and back), 8 (Cmd+N in the second window adds its tab there and nowhere else, and the Window menu lists both) and 9 pass. The Window menu used to gain a line every time the window came to the front, and View had AppKit's own Enter Full Screen beside Nib's.

### Lifecycle

1. With Nib not running, double-click a `.md` in Finder: the note opens once and no error line appears. Open With and dropping a file on the Dock icon work too.
2. `open "nib://..."` from Terminal still works.
3. Close every window: Nib stays in the Dock, and clicking the Dock icon brings a window back where it was.
4. Press Cmd+Q with an unsaved note: the unsaved question appears. Cancel keeps Nib running; Save or Discard quits it. With two windows, and from the Dock menu's Quit, the question still appears once only.
5. Window title and edited dot:
   - Mission Control shows the note's name.
   - An unsaved note puts the dot in the red button.
6. Move and resize the window, then relaunch: it comes back in the same place. With an external display disconnected in between, it lands on a screen that is still there.

> macOS 26.6 (25G72), Apple M5. 1: a double-click on a `.md` in Finder with Nib not running opens the note once, with no error line, and `open -a Nib` (the Apple event Open With and a drop on the Dock icon send) opens another in a tab of the running window. 2: `open "nib://new?name=..."` makes the note. 3: closing the last window leaves Nib in the Dock, and a click on the icon brings the window back where it was, moved and resized included. 4: Cmd+Q with an unsaved note asks once, with two windows open as well, and so does the Dock menu's Quit. Cancel keeps Nib running, and Save or Don't save quits it. Don't save used to bring the note's draft back with the next window. 5: the window's title is the note's name, which is what Mission Control and the Window menu list, and an unsaved note puts the dot in the red button. 6: a moved and resized window comes back in the same place and size, after Cmd+Q and after the Dock brings it back. The Mac first had a window-state plugin of its own for this, which came back a step off wherever a drag ended and was seen for fourteen milliseconds at the default size before jumping there, because tao moves a Mac window on the main queue and shows it at once. `placement.rs` does it on every desktop now, by building the window where it was left rather than moving it there, and the Mac uses it too, the window the Dock brings back included (`reopened`). A Mac's window is still built hidden, so its traffic lights are placed before anything is drawn. The external display half was not tried: this Mac has one display.

### Keys

1. Cmd+Ctrl+F toggles full screen.
2. In the file list:
   - Cmd+Backspace deletes; a bare Backspace does nothing.
   - Cmd+Return renames.
3. Tabs:
   - Cmd+1 to Cmd+9 switch tabs.
   - Shift+Cmd+] and Shift+Cmd+[ step through tabs.
4. Formatting:
   - Opt+Cmd+1 to Opt+Cmd+6 set headings.
   - Ctrl+` makes inline code.
   - Opt+Cmd chords work on a German keyboard layout.
5. Cmd+` still cycles Nib's windows.

> macOS 26.6 (25G72), Apple M5, ABC - QWERTZ layout. 1: Ctrl+Cmd+F toggles full screen. 2: in the file list a bare Backspace does nothing, Cmd+Backspace deletes the note, and Cmd+Return renames. 3: Cmd+1 to Cmd+9 switch tabs; Shift+Cmd+] and [ step through them on a US layout. On QWERTZ that key is AppKit's Cmd+* for Zoom in, since AppKit rewrites a row's key for the layout (see menu_bar.rs), so there Ctrl+Tab and Ctrl+Shift+Tab are the way to step. 4: Opt+Cmd+1 to 6 make headings 1 to 6, and Ctrl+` makes inline code, which QWERTZ presses as Ctrl+<, the key the menu shows. Opt+Cmd+5 and 6 folded and unfolded the note instead for a while this round, when the rewrite had been turned off: QWERTZ types `[` with Opt+5, and that is Fold's Opt+Cmd+[. And a Ctrl chord the Mac has no binding for, Ctrl+Q, Ctrl+R or Ctrl+^, typed an invisible control character into the note; it types nothing now (the editor's control.ts). 5 needs a real keyboard: Cmd+` is the system's, and a posted key does not reach it.

### Files

1. With Homebrew's pandoc installed and Nib started from Finder, the Word export appears.
2. Rename `idea.md` to `Idea.md`, a folder `work` to `Work`, and a space likewise: all go through.
3. For a note created with `touch "$(printf 'U\xcc\x88bersicht.md')"`, `[[Übersicht]]` resolves and backlinks work.
4. iCloud Desktop & Documents with a note set to "Remove Download": the note shows a cloud in the list, and opening it downloads it.
5. Right-clicking in a text field shows the system menu (Look Up, Spelling). Right-clicking in a note still shows Nib's own menu.
6. Reveal in Finder selects the file.

> macOS 26.6 (25G72), Apple M5. 1 was not run: Homebrew is not installed on this Mac. 2: renaming a note, a folder with notes in it and a space by their capitals alone goes through, which tests in notes.rs now check on the Mac's own case-insensitive disk. 3: a note whose name the disk keeps decomposed is reached by `[[Übersicht]]` and links back (link-index.test.ts). 4 was not run: this Mac is not signed in to iCloud. `notes/icloud.rs` now also knows the dataless file macOS 14 and later leave under the note's own name, where it knew only the `.icloud` placeholder of macOS 13. 5: the sidebar's search field gives the system's menu (Look Up, Translate, Spelling and Grammar, Substitutions), and a note gives Nib's own. 6: Reveal in Finder opens the space's folder with the note selected.

### WebKit

1. PDF export of a long note, of a canvas and of slides:
   - several real pages, with the right paper size and orientation;
   - margins not doubled;
   - backgrounds printed;
   - no dialog and no flashing window.
2. Cmd+P opens the print sheet.
3. A web tab on a camera test site:
   - Nib's question appears, and Don't Allow denies.
   - A camera and microphone request asks twice.
   - File upload and `target=_blank` still work.
4. Sign in to a site, then quit with the window closed or with Cmd+Q, and relaunch: still signed in.
5. Downloads in a web tab show real progress, and Cancel stops them.
6. PDFs open on macOS 13 or 14. This is the legacy pdf.js path.

> macOS 26.6 (25G72), Apple M5. 1: a long note comes out as six A4 pages, the German locale's paper, upright, with one 20 mm margin on every side, the code block's and the table head's backgrounds printed, no blank page at the end, and no window on screen but the save sheet. A canvas is one page the size of the drawing, with its colours, arrows and labels. A deck came out portrait, each slide small in the corner of a tall page, because `pdf.rs` told AppKit "portrait" beside a sixteen by nine sheet; it is one 960 by 540 point page per slide now (`on_its_side`). WebKit's pagination has two limits Chromium's does not. It does not keep a heading with what follows it (`break-after: avoid` in export.css), so a heading ended a page, twice in that note; in WebKit alone each heading now reserves three lines under it, and both open their pages. And it does not repeat a table's head on the next page, which is still so. 2: Cmd+P is Command palette on a Mac, as in Obsidian, so the key the item names is not Nib's; File > Print opens the system's print sheet with all six pages. Opening it made macOS ask whether Nib may find devices on local networks, which is the sheet looking for printers, with no sentence of Nib's in the question: `NSLocalNetworkUsageDescription` belongs in the bundle's Info.plist. 3 was not run: the camera and microphone need the usage sentences the mac/bundle branch adds. 4: a login in a session cookie was lost whenever the window was closed before the quit. On this macOS a cookie made from properties that hold `Discard` at all is session-only, "FALSE" included, so every cookie `web_cookies.rs` wrote back was the same session cookie again; the key is left out now, and a session cookie set on httpbin.org came back after closing the window and quitting, and after Cmd+Q. 5 was not run: it downloads a file. 6 does not arise on macOS 26, which takes the modern pdf.js build; there the exported long note opens from the file list with its six pages.

### First launch

1. Launch with an empty `~/Documents/Nib`, cleared storage, and signed out: the space chooser appears, and the traffic lights stay usable.
2. Create a space: it opens with "Read me.md" and the file list.
3. Import a folder:
   - The folder picker opens.
   - Pick an Obsidian vault: it becomes a space.
4. Sign in and Create account open the sign-in sheet with the matching heading.
5. Type in a blank tab and press Cmd+S: a "Notes" space is made and the note is saved into it.

### Recording and dictation

1. The recorder asks for the microphone with Nib's sentence, then records.
2. Dictation asks for speech recognition.
