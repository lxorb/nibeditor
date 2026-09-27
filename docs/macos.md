# macOS

What the Mac build does differently from Windows and Linux, and the checklist it has to pass on a real Mac before a release. Everything under "Checklist" was built on Linux: the Rust type-checks for `aarch64-apple-darwin`, but none of it has run on a Mac yet.

## What is Mac-only

- **Frame.** The window keeps the system's traffic lights over Nib's own bar (`titleBarStyle: Overlay`, `tauri.macos.conf.json`, `appearance.rs` `own_frame`). The bar leaves `--traffic-lights` of room in whichever bar holds the top left corner: the tab bar, or the sidebar's head while it is docked open. Full screen gives the room back. No drawn window buttons and no hamburger on a Mac.
- **Menu bar.** Built from the same rows as the in-window menu (`native-menu.ts`, `native-menu-bar.svelte.ts`). The Edit menu uses the system's own Undo, Cut, Copy, Paste and Select All, so they work in every webview.
- **Lifecycle.** Finder opens files through `RunEvent::Opened`. Closing the last window keeps Nib in the Dock, and clicking the Dock icon opens a window again. Cmd+Q asks every window about unsaved work (`lifecycle.rs`, `start.ts`). The window frame is restored at launch.
- **Window.** Its title is the note's name, the edited dot means unsaved, and it knows which file it stands for (`document_window.rs`).
- **Keys.** Mac defaults and key symbols (`shortcuts/registry.ts`, `keys.ts`, `docs/keyboard.md`).
- **Files.**
  - pandoc is found in Homebrew's folders.
  - Renaming a file or folder to change only its capital letters works.
  - Names are compared NFC-normalised.
  - iCloud-evicted notes are listed and downloaded when opened.
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

### Frame

1. The traffic lights sit centred in the 38px bar, and nothing in the bar sits under them. Check with the sidebar closed, docked open, and as a drawer in a narrow window.
2. Full screen: the lights disappear, and the bar gives their room back.
3. Settings > Appearance > system frame: a normal title bar appears, and the bar does not double the buttons.
4. Double-clicking the empty part of the bar zooms the window. Dragging it moves the window.
5. In a right-to-left language (Persian, Pashto): check where the lights sit and where the room is left.

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

### Lifecycle

1. With Nib not running, double-click a `.md` in Finder: the note opens once and no error line appears. Open With and dropping a file on the Dock icon work too.
2. `open "nib://..."` from Terminal still works.
3. Close every window: Nib stays in the Dock, and clicking the Dock icon brings a window back where it was.
4. Press Cmd+Q with an unsaved note: the unsaved question appears. Cancel keeps Nib running; Save or Discard quits it. With two windows, and from the Dock menu's Quit, the question still appears once only.
5. Window title and edited dot:
   - Mission Control shows the note's name.
   - An unsaved note puts the dot in the red button.
6. Move and resize the window, then relaunch: it comes back in the same place. With an external display disconnected in between, it lands on a screen that is still there.

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

### Files

1. With Homebrew's pandoc installed and Nib started from Finder, the Word export appears.
2. Rename `idea.md` to `Idea.md`, a folder `work` to `Work`, and a space likewise: all go through.
3. For a note created with `touch "$(printf 'U\xcc\x88bersicht.md')"`, `[[Übersicht]]` resolves and backlinks work.
4. iCloud Desktop & Documents with a note set to "Remove Download": the note shows a cloud in the list, and opening it downloads it.
5. Right-clicking in a text field shows the system menu (Look Up, Spelling). Right-clicking in a note still shows Nib's own menu.
6. Reveal in Finder selects the file.

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
