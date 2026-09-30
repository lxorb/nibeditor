# The keyboard

Nib is meant to be usable with no pointer at all. Not "usable" as in you can Tab
through it if you are patient: usable as in a hand that never leaves the home row
can open a note, read down a folder, switch space, change a setting and get back
to writing.

This is what the keys do, region by region, and why each of them is that key.

## What the others do

Three apps worth copying from, and each of them answers a different question.

### Discord

The one with an actual model, and the closest thing to what a notes app needs.

- **A region is a named section**: server list, channel list, messages, member
  list. **F6 moves to the next one, Shift+F6 back.** That is the whole trick.
- **Tab moves between controls; arrows move within a list.** Lists are
  deliberately kept out of the tab order, and their docs say why: "these things
  can have hundreds of entries at a time."
- **Escape means step back out one level**, from a focused message to the chat
  box. It is also mark-as-read, which is the one thing not worth copying: an
  Escape that changes something is an Escape nobody can undo.
- **The focus ring is not a setting.** Press Tab and you are in "keyboard mode"
  and the ring appears. There is no toggle in their accessibility tab; the
  checked-for-it list has a saturation slider, high contrast, reduced motion and
  no keyboard entry at all.
- Ctrl+K quick switcher, Ctrl+/ for the key list, Alt+Up/Down between channels,
  Alt+Shift+Up/Down between unread ones, Ctrl+Alt+Up/Down between servers.

### Obsidian

No focus model at all, and it does not pretend to have one. Everything is a
**named command** found through Ctrl+P and bound in Settings. The commands to
move focus between panes exist (`editor:focus`, `editor:focus-top`) and **ship
with no key bound**. Both sidebar toggles ship unbound too. Getting the keyboard
into the file tree in the first place has no default key: you click.

What it does have is a good tree. Up and down move, left and right collapse and
expand, Shift extends the selection, Ctrl+Up/Down moves and opens as it passes,
F2 renames, Escape clears the selection only if there is one and otherwise falls
through. Ctrl+Tab and Ctrl+Shift+Tab go round the tabs, Ctrl+1 to Ctrl+8 jump to
one and Ctrl+9 jumps to the last.

Tab is not a navigation key there. All six places Obsidian binds it are
autocomplete popups; everywhere else it indents.

### Notion

Also no regions. The keyboard lives inside the page, and **Escape is the mode
switch**: from the caret it selects the block you are in, again and it clears.
Then arrows move the block selection and Ctrl+Shift+arrows move the blocks.
Tab and Shift+Tab nest and unnest. Getting around is search and history rather
than focus: Ctrl+P, Ctrl+[ and Ctrl+], Ctrl+Shift+U up a level.

Nothing about focus, focus rings, sidebar keys or Tab traversal appears anywhere
in their docs. Ctrl+backslash for the sidebar, which everybody repeats, is not on
their shortcuts page either.

### And the ARIA practices

The W3C's authoring practices say the same thing Discord does, in colder words:

- **One tab stop per composite widget.** Tab and Shift+Tab move between
  components; the arrows move inside one. Not every control gets a tab stop, and
  the ones that do not are reached from the one that does.
- **Roving tabindex**: exactly one row of a list carries `tabindex="0"` and the
  rest carry `-1`. On a key press the 0 moves and the row is focused, which also
  scrolls it into view for free.
- **Tab into a list arrives at the selected thing**, not at the top.
- A **tree**: right opens a folder and then steps into it, left closes one and
  otherwise steps out; Home and End; type a letter to jump to a name.
- **Tabs**: left and right with wrapping, Delete closes one, and choose on
  arrival only "as long as their associated tab panels are displayed without
  noticeable latency."
- A **dialog**: Tab wraps inside it, Escape closes it, and focus returns to what
  opened it.
- A **focus ring** must be at least 2px solid, at 3:1 against what is next to it.
  One pixel fails.

There is no standard for F6. It is a convention: Windows cycles a window's
elements with it, Chrome and Firefox move between their own panes with it, VS
Code has `focusNextPart` on F6 and `focusPreviousPart` on Shift+F6, and Discord
documents it as its section key. The APG has an open issue proposing Ctrl+F6 for
the same job and it has sat there since 2020.

## Nib's model

Four sentences.

1. **Tab moves between things, arrows move inside one.** Every list, strip and
   tab row in the app is one tab stop.
2. **F6 walks the regions, Shift+F6 walks them back**, and it works from inside
   the note, which Tab cannot because Tab indents.
3. **Escape steps back exactly one level and never does anything.** In a list it
   drops the selection first and then hands the keyboard to the note.
4. **The note is where people live.** Every road out of everywhere ends there.

### The regions

Nine, in the order the window draws them, which is the order Tab already walks:

| | |
| --- | --- |
| `space` | the panel's header, which is the space's mark and name, and its switcher |
| `panels` | the row of panel tabs |
| `search` | the search pill under them |
| `list` | whichever panel is open |
| `foot` | the row under it: the account, the theme, the settings |
| `tabs` | the strip of notes |
| `editor` | the note |
| `status` | the bar under it, over a note |
| `right` | the other side of the window, while it is showing |

They are marked in the page with one `data-region` attribute each, so the order
F6 walks is the order the window is built in and cannot drift from it. What is
not on screen is not in the ring: the sidebar may be shut, a phone has no strip,
the graph and a canvas have no status bar - the bar counts the words of a note,
and neither of those has a note for it to count, while a page note keeps its bar
for the one thing it does have to say, which page of how many is in front; see
`hasStatusBar` in regions.ts, which is the one rule the window draws from - and
most windows have no right side at all.

The right side is one region rather than five. It has no header and no foot -
those belong to the window, and the left side carries them - so what is over
there is its own tab strip and whichever panel it holds, and a reader stepping
out of the note wants that panel rather than four stops inside it.

#### Which way round, under a language that reads the other way

Arabic, Persian, Pashto and Urdu turn the whole interface round: the list is on
the right of the window, the note on the left, the bar at the foot at the far
left. None of that changes the ring. F6 walks the regions in the order the window
is built in, which is the order a reader of that language reads them in, and
`left` and `right` in the table above are names for the two sides of the window
rather than for two edges of the glass: the `right` side is the side a line ends
on, so under Arabic it is against the left of the screen. The command that moves
a panel over says the screen's own side, because that is what somebody looking at
the screen means by it.

Inside a list the two sideways keys trade places. A list that runs across the
window runs the other way, and a closed folder's own mark points the other way,
so under Arabic it is Left that steps into what a row holds and into a submenu,
and Right that comes back out - the key pointing the way the mark does. Up and
down are untouched: a list still runs down the screen. See `steppedKey` in
`apps/desktop/src/lib/direction.ts`, which is the one place that says so.

The space switcher is a menu that drops out of the panel header, so
Ctrl+Shift+Space presses that header's own control rather than opening a second
copy of the list somewhere else - and the list it opens walks with the arrows,
spells with a letter and gives the keyboard back to the name it came from, like
every other list here.

### In a list

Every `.nib-row` list in the app behaves the same way, because they all go
through one module. The file tree, the bookmarks above it, the outline, the tags,
the search results, the backlinks, the strip of notes.

| Key | What it does |
| --- | --- |
| Up, Down | the row before, the row after. The ends do not meet: falling off the bottom of a nested note into its top loses your place |
| Left, Right | in a tree, hide and show what a row holds; right on an open one steps into it, left on a closed one steps out to the row holding it |
| Home, End | the top and the bottom |
| a letter | the first row whose name starts with it. Keep typing to narrow; a pause starts a new word |
| Enter | open it, and the note takes the keyboard. Every row in the file list opens something, including a note that holds notes; see `docs/tree.md` |
| Space | open it and stay here, so a space can be read down without leaving the list. Obsidian has the same idea on Ctrl and an arrow |
| Shift+F10, Menu | the row's own menu, the same one a right click gives |
| Delete | on the strip of notes, close the tab |
| Escape | drop the selection; with none, back to the note |
| Tab | out of the list entirely, because a list is one tab stop |

Two exceptions, both from the practices. The **panel tabs change as you arrive**
at them, because what each shows is already worked out and arrives without a
wait. The **strip of notes does not**: each of those is a file to read off a
disk, so an arrow moves and Enter opens.

Left and right are the arrows in a list that runs across (the strip, the panel
tabs), and those two leave up and down alone so the page underneath still
scrolls.

#### In the file list

What only a list of files has, on top of the walk above. The ones that are the
app's keys elsewhere - Undo, Redo, New note, the clipboard - are read off the same
entries, so a rebind of one is a rebind of both.

| Key | What it does |
| --- | --- |
| Ctrl+A | select every row |
| Shift+Up, Shift+Down | take the row above or below into the selection too |
| Ctrl+Space | put the row in the selection or take it out |
| F2 | rename |
| Delete, Backspace | delete the selection |
| Ctrl+C, Ctrl+X, Ctrl+V | copy or cut the selection, then paste into the folder the row is, or sits in |
| Ctrl+D | a copy of each selected row, beside it |
| Ctrl+N | a new note in the folder the row is, or sits in, waiting for its name |
| Ctrl+Z, Ctrl+Y | undo the last file change, and do it again (Ctrl+Shift+Z too; Cmd+Shift+Z on a Mac) |
| Alt+Up, Alt+Down | move the row in the order somebody arranged |

See `docs/tree.md` for what a copy is called and where it lands.

The file list is a list of buttons and not an ARIA `tree`. The roles were left
off on purpose: nib's markup puts what a row holds beside the row rather than
inside it - one flat column, in which what a note holds is the rows under it - and
a `tree` built that way announces worse than no tree at all. The keys are the tree
keys either way. Each row does say how many rows there are and which of them it is
(`aria-setsize`, `aria-posinset`), because the page holds the rows in view and not
the other two thousand nine hundred and eighty.

Which is the one thing the walk had to be told about. It is a walk over the rows
rather than over the elements: End, Home and a spelled name all land on a row that
is not in the page, so `roving.ts` asks the list to **reach** it - draw it at its
own place, scroll to it - and moves the focus once it is there. The row the keyboard
is on stays in the page however far the scroll then goes, because a focus inside a
row that has been taken away is a focus on nothing. See `row-window.ts` and
`docs/tree.md`.

### The chords

Everything below is in the shortcut registry, so it shows in Settings, it shows
in the palette, and it can be rebound. What was already there is marked.

**Getting around**

| | |
| --- | --- |
| F6, Shift+F6 | next section, previous section |
| Ctrl+P | the palette. Type for a note, `>` for a command, the ones run lately first (already there). Empty, it lists the notes opened lately, the one before this first; a note is found by its folder too (`uni/lec`), and says its folder where another shares its name |
| Enter, Shift+Enter in the palette | with nothing matching, Enter makes the note typed (`Uni/Lecture 3` makes the folder too); Shift+Enter makes it whatever matches, as in Obsidian |
| Ctrl+Alt+Enter in the palette | the note in a pane to the right, the pane in front left as it was (Obsidian's chord; Ctrl+Alt+click too) |
| Ctrl+Alt+click on a link to a note | the same, from the note: the linked note in a pane to the right, made first if the space has none by that name. A pointer gesture rather than a chord, so it is not in the registry |
| `#`, `:` in the palette | `#` lists the headings of the note in front, `:42` goes to its line 42 - VS Code's `@` and `:` |
| Ctrl+Shift+P | the same palette, opened on the commands: the field arrives holding `>` with the caret after it, so deleting the mark is the way back to the notes. Pressed while it is open, it puts the `>` in front of whatever is typed, once |
| Ctrl+O | open a file (already there) |
| Ctrl+S | nothing to save: every note writes itself a moment after it changes. The key is harmless out of habit - it writes what is waiting at once and keeps the note in front as a version, with no question and no file picker. A command somebody puts on it answers instead; see `writeKey` in `shortcuts.svelte.ts` |
| Ctrl+Shift+W | close the window; whatever is waiting to be written goes down first, and nothing is asked. On a Mac, Cmd+W in a window with nothing left open closes it too, as in Safari and VS Code |
| Ctrl+Shift+? | every key there is, which is the Shortcuts pane in Settings. Not on a Mac, where Shift+Cmd+? is the search field every app's Help menu has; there the list is the first row of Help |

**The panels**

| | |
| --- | --- |
| Ctrl+Shift+E | Files |
| Ctrl+Shift+O | Outline |
| Ctrl+Shift+F | Search (already there). Over a few words selected on one line, it searches for them |
| Ctrl+Shift+B | Links |
| Ctrl+Shift+A | Ask, the conversation about the space |
| Ctrl+Shift+L | show or hide the sidebar (already there) |
| Ctrl+Alt+B | show or hide the right side, VS Code's key for its secondary side bar |
| no key | Show in the file list: the note in front, its rows unfolded and scrolled to. Collapse the file list: every row folded |

The two without a key ship unbound in Obsidian and VS Code as well. Both are rows in
the palette, Show in the file list is a row in a tab's own menu too, and while a row
is unfolded the collapse is a glyph beside the order of the files.

Footnotes and Properties have no key of their own. A combination nobody asked for is
a key taken away from whatever a reader might have wanted it for: the tab strip and
the palette are how they are reached, and both are rows in the Shortcuts pane with no
key on them, so a reader who wants one has a row to put it on.

Each of the five opens its panel **on whichever side it lives, and puts the keyboard
in it** - for the Outline, the Links and Ask that is the right, so the key opens that
side as well, and Ask's key lands in its field - and pressing it again while the
keyboard is already there gives the note the keyboard back. In a browser Ctrl+Shift+A
is the browser's own tab search, so there the tab and the palette reach Ask. One
key there and one key back: the alternative is a key that opens something and a
second key nobody remembers for leaving it.

They are letters and not digits, and that is not taste. Ctrl+Shift and a digit is
not a key a text editor can spend: on a layout where the digit itself is the
shifted character, which is every AZERTY, CodeMirror reads the press as Ctrl and
the digit and sets a heading level. Ctrl+Shift+3 used to open the file list and
turn the line into a heading, both. A letter cannot be read that way round,
because the shifted letter and the letter are different names for the key.

The rule reads both ways round now, because the app reads a digit the same way on
purpose: a chord that wants a digit and no Shift is matched by the key underneath, so
Ctrl+0 reaches the text size on AZERTY as it does everywhere else (see
`matchesCombination` in `keys.ts`). Which means Ctrl+Shift+0 and Ctrl+0 are one press
on those keyboards whichever of the two something is bound to, so nothing may hold one
while anything holds the other. That is why Paragraph never took Ctrl+Shift+0, where
Notion puts it, and it is the one key of Notion's the Notion preset cannot take.
`shortcuts.test.ts` fails if a pair appears, in either direction.

**Paragraph has no key at all**, and wants none: a heading key undoes itself. Ctrl+2 on
a line that is already a second-level heading turns it back into prose, which is what
every other format key on the keyboard already does, so there was nothing left for a
chord of its own to do. It keeps its row in the Paragraph menu, the palette and the
shortcut list and can be given a key there, the way Comment can. The chord it held,
Ctrl+Shift+P, is the palette on commands - where every editor that has a command
palette puts it. See `setHeading` in `packages/editor/src/commands.ts`.

**A press a surface has already answered is spent.** The window's handler is the last
one to run, and the plane, the page column and the file list read their own keys off
their own element before the press gets there. So the app stands down on anything one
of them has stopped - the same rule the wheel follows - which is what makes a
`contextual` binding work as the registry describes it: one that found nothing to do
stops nothing, and the app still gets the key.

**The notes**

| | |
| --- | --- |
| Ctrl+N | a new note |
| Ctrl+Shift+N | a new window |
| Ctrl+T | **a new web page**, the way every browser answers it; held, **what kind**: a dialog in the middle of the window - a note, a canvas, a website, a page note, a terminal - standing on the website |
| Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgDn, Ctrl+PgUp | round the strip. Settings, General, can put Ctrl+Tab in order of use instead: the tab used last, and one further back for each press while Ctrl is held (VS Code's). Ctrl+PgDn and Ctrl+PgUp walk the strip either way |
| Alt+1 to 9, Alt+0 | the tab at that place along the focused pane's strip, the last tab. Pinned tabs count, and a place past the end does nothing |
| Ctrl+Alt+1 to 8, Ctrl+Alt+9 | the same eight places and the last, as second keys |
| Ctrl+Shift+PgUp, Ctrl+Shift+PgDn | move the tab one slot, stopping at either end |
| Ctrl+W | close (already there) |
| Ctrl+Shift+T | reopen the last closed one (already there) |
| Ctrl+Alt+Right, Ctrl+Alt+Down | split (already there) |
| Ctrl+Alt+O | the other pane (already there) |
| Ctrl+Alt+Shift+Right | carry the tab to the other pane, or into a new one beside its own when there is none: split right, taking the tab along rather than a copy. VS Code has it on Ctrl+Alt+Right, which is Split right here |
| F2, on a tab in the strip | rename its file, on its row in the file list, which comes out for it |

The rest of a tab's own menu has no key out of the box and is in the palette and the
shortcut list so one can be given: close the tabs to the right, close all tabs,
duplicate the tab. Chrome gives none of them a key, and VS Code's are two-stroke
chords, which the registry does not hold.

Under the Obsidian preset the digits move to Ctrl+1 to Ctrl+9, which is
Obsidian's own, and the heading levels give them up.

**Alt and a digit is the tab at that place.** Emil, 2026-09-30: *"Add shortcuts alt + 1,
alt + 2, ... where alt + x opens the tab at position x and alt + 0 opens the last tab."*
No heading level is in its way, and no Ctrl to reach past. Every digit is its own place,
the ninth included, and the nought is the last - Chrome and Firefox on Linux have Alt and
a digit for their tabs too, but make the ninth the last. A place past the end does
nothing, as Chrome's Ctrl+1 to 8 do. It works wherever the keyboard is: a note, a canvas,
a page note, the file list, and inside a web page, which never gets the chord (see
below). They are second keys of `app.note-1` to `app.note-8` and of Last
note, `app.note-1.alt` to `app.note-9.alt`; the ninth place, `app.note-ninth`, had no key
before. Nothing had Alt and a digit, in the defaults or any keyboard, so nothing moved;
strikethrough's Alt+Shift+5 is Shift and the key, and the editor reads it first.

Alt is Alt and nothing else. AltGr is Ctrl and Alt together on Windows, so a Swiss `@` or
a German `{` is never a tab, and Alt pressed and let go of on its own is left alone. A
press an input method is composing is its own too. None of this is on a Mac, where
Option and a digit types ¡ ™ £ ¢ ∞ § ¶ • ª º: Cmd and a digit are the tabs there already.

**Ctrl+T is a browser's key first.** Emil, 2026-09-27: *"Ctrl + T should always open
a webpage by default. And that should always be the selected option in the modal when
holding the Ctrl."* Tapped, it makes a web page and draws nothing. Held, it is Alt+Tab's
shape: after a beat a dialog comes up in the middle of the window with the kinds as
cards and the website standing, each further T steps one along (Shift+T back), the
arrows walk them too, and letting Ctrl go makes the one that stands. Each card's letter
- N, C, W, P, and R for a terminal, since T is the chord's own step - makes it outright,
Enter and a click make the one pressed, Escape makes nothing. The terminal's card has a
chevron in its corner: pressed, or Shift held with R, Enter or a click, it lists the
other shells instead of starting the default one (see docs/terminal.md). A phone has no web tab, so there the note stands. The palette's New opens the
same dialog on the same card. See `new-kind-chord.ts`, `NewKindSheet.svelte` and
`new-kind-choice.ts`.

The plus keeps its menu at the pointer, because that is where the hand already is; the
dialog is the keyboard's. Both read the one list in `new-kinds.ts`, and so do the
buttons a pane with nothing open shows. Nothing remembers which kind was made last any
more: every door opens on a place that never moves.

**A pane with nothing open is a state the window is allowed to be in.** Closing the
last note used to make a blank one; now the pane shows those same kinds as buttons and
makes nothing until one is pressed. The keyboard lands on the first button and the
arrows walk them. They are the dialog's cards, drawn in the pane; see `NewHere.svelte`
and `KindCard.svelte`.

**Lines and the selection**

What VS Code, Sublime and Obsidian taught every hand that writes, in the editor. Each is
in the registry and the palette like the rest; the ones with no key have none in VS Code
either, or want a key nib already spends.

| | |
| --- | --- |
| Shift+Alt+Right, Shift+Alt+Left | the selection a step outwards - the word, the words inside the marks, the marks, the block, the list, the section, the note - and back down the same steps. Ctrl+Shift+Cmd and the arrow on a Mac, where Alt, Shift and an arrow is a word at a time |
| Ctrl+Enter | ticks the task; on words, a bullet, a number or an empty line it makes the task first, so the next press ticks it (Obsidian). A JavaScript fence runs instead, and in code, a heading, a quote or a table the press is the library's line below (already there) |
| Ctrl+Shift+Enter | a new line above, indented like this one |
| Ctrl+J | the next line joined onto this one, its indent and marker gone, or every selected line onto the first |
| Alt+Enter, in the find bar | a cursor on every match, and the bar goes |
| no key | Delete the line, Sort the lines, Reverse the lines, Upper case, Lower case, Title case. Duplicate the block and Move the block up or down, the grip's own rows, for the block the caret is in or every block the selection lies across |

Delete the line has no key because both of the ones people know are taken: VS Code's
Ctrl+Shift+K is Code block, Typora's key for it, and Obsidian's Ctrl+D is Select word. The
VS Code and Obsidian keyboards give it theirs, and the Notion one puts the block rows on
Notion's keys; see the keyboards below. Sort reads past list markers and boxes, ignores
case and counts `2` before `10`; with nothing selected it sorts the list or paragraph the
caret is in.
None of these reaches into front matter that is hidden: they stop at the first line
that shows. See `lines.ts`, `case.ts` and `grow.ts` in `packages/editor/src`.

**An address pasted over words links them.** Selected words and a URL on the clipboard
make `[words](url)`, which is what Obsidian, Notion and GitHub do with that paste. In
code, in a link, in a formula or in markup the paste goes in as it stands, and
Ctrl+Shift+V is always plain. See `linkedPaste` in `packages/editor/src/paste.ts`.

**A web tab**

The keys that only mean anything while the pane is showing a website, and they are
the ones a browser has taught everybody. They are in the registry like the rest, so
they show in Settings, show in the palette and can be rebound.

| | |
| --- | --- |
| Ctrl+T | a new tab. In a web tab that is a new web tab, on the new tab page |
| Ctrl+W | close, which is the same key every other tab closes with (already there) |
| Ctrl+L, Alt+D | the address field, in the pane that has the focus. F6 too, from inside the page |
| F5, Ctrl+R | reload. F5 is Present over a note; over a page there is no note to present |
| Ctrl+Shift+R, Ctrl+F5 | reload past the cache |
| Escape | stop a page on its way in, once whatever is open over it has had its Escape |
| Ctrl+1 to 9 | the tab at that place along the strip, the ninth the last; over a note it is Ctrl+Alt, because Ctrl and a digit is a heading level there. Alt+1 to 9 and Alt+0 as everywhere |
| Alt+Enter in the address field | the address in a tab of its own |
| Alt+Left, Alt+Right | back and forward, which in a web tab is the page's own history (already there) |
| Ctrl+F | find in page: nib's find bar over the engine's own find. Enter, Shift+Enter, Ctrl+G and F3 step, Escape closes |
| F12, Ctrl+Shift+I | the engine's developer tools for the page (Cmd+Alt+I on a Mac): `web.devtools` |
| Escape, F11 | give the screen back from a video in full screen |
| none | Mute site, which Chrome gives no key either: `web.mute`, for a reader to bind |

Ctrl+L is also the chord CodeMirror selects a line with, and both keep it, because
the bar reads the press where the bar is rather than off the window: an app-level
binding would never reach the editor, while a pane showing a page has no editor to
shadow. F5, Ctrl+Shift+R and Ctrl and a digit share keys with Present, the editor
and a heading level the same way, and the bar reads them before the window does; see
`lib/web-tab/bar-keys.ts`. F6 in the app still walks its regions: only an F6 pressed
inside the page is Chrome's way back to the address field.

**The browser's own chords work while the page has the keyboard.** Emil, 2026-09-27:
*"if I press Ctrl+T right now while I'm in a browser window, nothing happens."* Chrome's
rule, on `WebView2`: Ctrl+T, Ctrl+Shift+T, Ctrl+W, Ctrl+N, Ctrl+Shift+N, Ctrl+Tab,
Ctrl+Shift+Tab, Ctrl+PgUp and Ctrl+PgDn (with Shift too), Ctrl+1 to 9, nib's own Alt+0
to 9, and F6 to the address field are never offered to the page. Alt and a digit is no
character on Windows, so what a page loses with it is only an `accesskey` on a digit, as
it does in Chrome on Linux; AltGr and a digit, which is Ctrl and Alt, stays the page's.
The find keys - Ctrl+F, Ctrl+G, Ctrl+Shift+G, F3 and Shift+F3 - and the address
field's other two, Ctrl+L and Alt+D, are the page's first, as they are in Chrome, so a
site with its own find (Google Docs, Notion, VS Code on the web) or its own Ctrl+L keeps
them; a line of script in the page
asks for nib's answer when nothing in it took the key (`src-tauri/src/web_opens.rs`). The engine tells the host
about a chord before the page sees it (`AcceleratorKeyPressed`), the crate keeps these,
hands the keyboard back to the app and says which key it was, and the window plays it
on itself - so it goes through the same handler, the same bindings and the same held
Ctrl+T as anywhere else. A Ctrl let go of in the page is said too, which is the release
a held Ctrl+T chooses on. F5 and Ctrl+R need nothing: pressed in a page they are the
engine's own reload, as in Chrome. Everything else, a site's own Ctrl+K among them, is
the page's. See `src-tauri/src/web_keys.rs` and `lib/web-tab/keys.ts`. `WKWebView`,
`WebKitGTK` and nib's own Chromium have no such event reachable yet, and there the page
keeps every key; Chromium's `OnPreKeyEvent` is the same hook, see docs/browser.md.

**A terminal**

A shell reads nearly every chord there is, so a terminal gives the app only the keys
VS Code gives its workbench, checked against its own list, and everything else goes to
the shell. See `lib/terminal/keys.ts`, which is the rule, and docs/terminal.md.

| | |
| --- | --- |
| Ctrl+T, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgUp, Ctrl+PgDn (and with Shift), the numbered tabs | the app's, as everywhere |
| Ctrl+P, Ctrl+Shift+P, Ctrl+comma, F11, F6, Shift+F6 | the app's: the palette, the settings, full screen, and the way a keyboard leaves the terminal - Tab cannot be, the shell completes with it |
| Ctrl+Shift and any other app command, Ctrl+Alt and an arrow | the app's: a terminal cannot tell Ctrl+Shift+E from Ctrl+E, and no shell has one on it |
| Ctrl+W, Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+R and every other Ctrl and a letter | **the shell's**: delete a word, the history, search it. Close a terminal with `exit`, its cross or its menu, or Cmd+W on a Mac |
| Ctrl+Shift+W | nobody's: Close window here and Close tab in every terminal there is, so neither |
| Ctrl+C | always the interrupt |
| Ctrl+Shift+C, Ctrl+Shift+V, Shift+Insert | copy, paste. Ctrl+V pastes too on Windows, as in Windows Terminal. Cmd+C and Cmd+V on a Mac, and a selection is copied as it is made |
| Ctrl+F | find, in nib's find bar |
| Ctrl+=, Ctrl+-, Ctrl+0 | the terminal's type, larger, smaller, as it was; the same size as Settings, General, Terminal |
| Cmd+A, Cmd+K | select all, clear, on a Mac (Terminal's own) |
| every app command on Cmd | the app's, on a Mac: no shell ever sees Cmd |

AltGr is never a chord: Windows says it as Ctrl and Alt, and a key that came out as
anything but its own letter or digit is somebody typing `@` or `{`.

**The spaces**

| | |
| --- | --- |
| Ctrl+Shift+, | the space before |
| Ctrl+Shift+. | the space after |
| Ctrl+Shift+Space | the space switcher, from anywhere |

Discord switches servers with Ctrl+Alt and an arrow, which is the same shape of
thing. Here both of those arrows are the panes', so the two keys every app uses
for "the one before" and "the one after" take it instead. The switcher is on the
space bar because that is where the word is written, and it opens the sidebar
header's own menu rather than a second copy of it.

**Undo and redo**

| | |
| --- | --- |
| Ctrl+Z | undo (already there) |
| Ctrl+Y | redo (already there) |
| Ctrl+Shift+Z | redo as well, on Windows and Linux |

Two keys for redo because the rest of the world has two. Ctrl+Y is Windows's own
and was always here; Ctrl+Shift+Z is what Obsidian, VS Code and Word answer, and
it is the key a hand that has just pressed Ctrl+Z reaches for without thinking.
CodeMirror bound it on Linux alone, which left a Windows reader pressing a key that
did nothing. Nothing else holds the chord on either platform, so it is a second key
rather than a trade. On a Mac it is Cmd+Shift+Z and that is redo's only key, which
is the platform's own convention; the entry there is Redo itself rather than an
alias. Both are in the registry as `edit.redo` and `edit.redo.alt`, so the list
shows the second one as a second key and either can be rebound. The canvas and a
page note keep their own history and answer both.

**Folding**

| | |
| --- | --- |
| Ctrl+Alt+[ | fold whatever the caret is in, and open it again (already there) |
| Ctrl+Alt+] | open all of it (already there) |
| no key | Fold everything, Fold more, Fold less |

The three without a key are three rows in View and three rows in the palette, and
that is deliberate rather than unfinished. Obsidian ships all three unbound too.
Folding everything is the press nobody makes twice in a row, and the two level
commands are read-with-one-hand presses rather than writing presses, so none of
them is worth a chord that the writing would otherwise have. Any of the three can
be put on a key in Settings, like everything else in the registry.

**The popup at the caret**

One popup, whatever opened it: `/` for a block, `:` for an emoji, a snippet's own
word, `[[` for a note, `[[##` for any heading in the space, `[[^^` for any block,
`#` for a tag.

| Key | What it does |
| --- | --- |
| a letter | narrows the rows; the letters that matched are marked in each |
| Up, Down | the row before, the row after |
| Enter | take it: the row replaces what was typed, and a link closes its own brackets |
| Escape | leave it; what was typed stays exactly as typed |

One surface for seven things, because the alternative is seven popups with seven
sets of keys and one of them getting Escape wrong. It is CodeMirror's own
completion tooltip, which is why it behaves the same at the caret on a phone as
it does on a desktop.

### On a Mac

`Mod` is Cmd, and the keys are written the way a Mac writes them: signs for the
modifiers in the order ⌃⌥⇧⌘, and signs for the keys with no character, ⎋ ⌦ ⌫ ↩ ⇥ ⇞ ⇟
↖ ↘. Where a key above means something else to a Mac, or is a media key on its
laptops, the Mac has its own default. Windows and Linux are unchanged.

| | On a Mac | Elsewhere | Why |
| --- | --- | --- | --- |
| Full screen | ⌃⌘F | F11 | F11 is Show Desktop; ⌃⌘F is every Mac app's Enter Full Screen |
| Present | ⌥⌘P | F5 | Keynote's Play Slideshow |
| Focus, Typewriter, Read-only | ⌃⌘O, ⌃⌘T, ⌃⌘R | F8, F9, F10 | media keys; Obsidian has none, so Nib's own on the Ctrl+Cmd row beside ⌃⌘F |
| Round the strip | ⌃⇥, ⌃⇧⇥, ⇧⌘], ⇧⌘[ | Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PgDn, Ctrl+PgUp | ⌘⇥ is the app switcher; the brackets are Safari's, Chrome's and VS Code's |
| The note at a place | ⌘1 to ⌘9 | Alt+1 to 9 and Alt+0, Ctrl+Alt+1 to 9 | Obsidian's and Safari's; ⌥ and a digit types a character |
| Heading 1 to 6 | ⌥⌘1 to ⌥⌘6 | Ctrl+1 to 6 | trades places with the notes, as Notion has them on a Mac |
| Numbered, bulleted list | no key | Ctrl+Shift+[, Ctrl+Shift+] | the brackets walk the tabs; Obsidian ships none |
| Quote | ⌥⌘Q | Ctrl+Shift+Q | ⇧⌘Q is Log Out; ⌥⌘Q is Typora's on a Mac |
| Inline code, strikethrough | ⌃\`, ⌃⇧\` | Ctrl+Shift+\`, Alt+Shift+5 | ⇧⌘\` steps through windows, ⌥⇧5 types a character; Typora's Mac keys |
| Back, forward | ⌃[, ⌃] | Alt+Left, Alt+Right | ⌥ and an arrow is a word at a time, ⌘ and a bracket indents, as in Obsidian |
| Delete files in the list | ⌘⌫, ⌘⌦ | Del, Backspace | Finder's and Obsidian's; a bare ⌫ deletes nothing |
| Rename in the list | ⌘↩ | F2 | Finder renames on ↩, which opens in every list here |
| Canvas: zoom to what is picked, to front, to back | ⌥⌘1, ⌥⌘], ⌥⌘[ | Ctrl+1, Ctrl+Shift+], Ctrl+Shift+[ | ⌘1 and ⇧⌘] are the tabs'; Figma's order keys |

F6 stays: VS Code walks its parts with it on a Mac too, and ⌃F6 is the system's. The
settings warn about the keys a Mac keeps for itself - Spotlight, the switchers, the
screenshots, Mission Control, ⌘\` and the rest - see `SYSTEM_KEYS` in the registry.

### The keyboards

Settings, Shortcuts, has a keyboard to start from: Default, Notion, Obsidian, VS Code or
Vim. Each holds only where it differs from Default, so a key Default gains later reaches
all of them. The rule for a clash is the other app's: its key goes to what it does there,
and the Nib action that held it is left with no key rather than moved somewhere nobody
would look. Those rows read "Not set" in the list, and are still in the menus and the
palette. `presets.test.ts` fails if a keyboard writes one chord twice, or leaves any two
actions on one key.

Default indents on Ctrl+[ and outdents on Ctrl+], which is Typora's order. VS Code,
Obsidian and CodeMirror have it the other way round, and so do those two keyboards.

**VS Code**

| | |
| --- | --- |
| Ctrl+G | go to line; Ctrl+G on a Mac too, as there |
| Ctrl+Shift+K | delete the line |
| Ctrl+Shift+L | a cursor on every one like the selection |
| Ctrl+\ | split right |
| Ctrl+], Ctrl+[ | indent, outdent |
| Shift+Alt+Right, Shift+Alt+Left | the selection outwards and back, which Default has already |
| no key | find next (F3 stays), Code block, Clear formatting, show or hide the sidebar |

Ctrl+B stays Bold. It is the sidebar in VS Code, but in a note it is bold, which is what
VS Code's own markdown extensions do with it too. So the sidebar has no key, and
Ctrl+Shift+E, VS Code's key for the files, opens them.

**Obsidian**

| | |
| --- | --- |
| Ctrl+O | the palette on the notes, which is the quick switcher |
| Ctrl+P | the palette on the commands, which is the command palette; Ctrl+Shift+P as well |
| Ctrl+1 to 9 | the notes on the strip |
| Ctrl+Alt+Left, Ctrl+Alt+Right | back, forward |
| Ctrl+D | delete the line, Obsidian's delete paragraph |
| Ctrl+\, Ctrl+Shift+\ | split right, split down |
| Ctrl+G | the graph |
| Alt+Enter | follow the link |
| Ctrl+], Ctrl+[ | indent, outdent |
| no key | Open file, the heading levels, find next (F3 stays), Select word, Clear formatting, the canvas's zoom to what is picked |

**Notion**

| | |
| --- | --- |
| Ctrl+Shift+1, 2, 3 | headings |
| Ctrl+Shift+4, 5, 6 | task list, bulleted list, numbered list |
| Ctrl+Shift+8 | code block |
| Ctrl+E | inline code |
| Ctrl+Shift+S | strikethrough |
| Ctrl+\ | show or hide the sidebar |
| Ctrl+D | duplicate the block |
| Ctrl+Shift+Up, Ctrl+Shift+Down | move the block |
| no key | the reading view, Clear formatting, Select word |

On a Mac, Notion's Cmd+Shift+Up and Down move the block here too, which takes selecting to
either end of the note away from those keys, as Notion does.

**Vim** is Default's keys with modal editing on top; see `packages/editor/src/vim.ts`.

The keyboards are fetched with the Settings sheet, and the launch reads only a keyboard's
name. See `lib/shortcuts/presets.ts` and `lib/shortcuts/preset-ids.ts`.

### Layers

Sheets, menus, the settings, the pickers, the palette. All of them:

- hold the keyboard while they are open, so Tab goes round the inside rather than
  off into the note behind, which is still full of buttons nobody can see;
- close on Escape, through one stack, newest first;
- **hand the keyboard back to whatever opened them.**

The palette is the exception to the last one, and deliberately: choosing in the
palette is how you arrive at a note, so it gives the keyboard to the note. It is
also a combobox now - the keyboard never leaves the box, the arrows move which
row it is pointing at, and the rows are out of the tab sequence, because forty
notes would otherwise be forty presses of Tab between the palette and the note
behind it.

A text field's own menu is the other exception. A right click, Shift+F10 or the
Menu key in any field - the address bar, the search box, the find bar, a name
being renamed, a field in the settings - gives Cut, Copy, Paste and Select all,
and the field keeps the keyboard while it is up, the way it does under the
system's own menu: a name commits and an address goes back to the page's when
its field loses it. So the menu is walked from the field. The arrows, Home and
End light a row, Enter chooses it, Escape closes the menu and nothing else, and
any other key closes it and goes on into the field. See `lib/field-menu.ts`.

### The ring

One token, `--focus-ring`, in `packages/themes/src/tokens.css`, and one rule in
`base.css` that puts it on everything a key can land on. Two pixels, solid, in
the accent, which is the thinnest ring WCAG counts and the one colour in the app
that carries 3:1 against every surface it sits on.

It is drawn on `:focus-visible` and never on `:focus`. That is the whole of what
Discord spends a mode on: a click leaves nothing behind, a key leaves the ring,
and the browser has known which of the two it was for years.

Thirty rules had their own copy of the same two lines before this, which is
thirty chances for one of them to be a different thickness. `one-of-each.test.ts`
now fails if a component draws its own.

### The size of the text

Ctrl and the wheel over the note, which is also what a trackpad pinch arrives as
on every platform. It changes the app's own text size - `--zoom`, the value the
slider in Appearance sets and the value the keys step - and never the webview's
zoom: that would scale the panel and the tab strip with the words, would not be
remembered, and would not reach the phone or the browser build. The listener is
not passive and prevents the default, which is what stops WebView2 and WKWebView
from zooming underneath; the engine's own zoom hotkeys are off in the app's page for
the same reason. What has just happened is said once, as a badge over the note, and goes.

The keys are the three every browser uses, and Obsidian and Typora with them:
**Ctrl+=**, **Ctrl+-** and **Ctrl+0**. A reader who wants bigger words presses one of
those before they open a shortcut list, so those are what they are. Ctrl+0 is matched
by the key rather than by the character it printed, which is what makes it Ctrl+0 on
AZERTY too, where the nought is the shifted character; see the digit rule above.

Over a web page the same keys, and Chrome's Ctrl and `+` beside them, zoom the page
rather than the words, as they do in Chrome: the bar in the focused pane reads them before
the window does. Inside the page, Ctrl and the wheel and the keys are the engine's own,
switched on for a web tab's page alone. See "Zoom" in `docs/web-tabs.md`.

They were Heading up, Heading down and Paragraph in the editor. The first two moved one
modifier over, to **Ctrl+Shift+=** and **Ctrl+Shift+-**; Obsidian binds neither at all,
so nothing carries over from it, and the heading levels keep Ctrl+1 to Ctrl+6, which are
nobody else's. Paragraph has no key now - Ctrl+2 on a second-level heading is what turns
it back into prose - and **Ctrl+Shift+P**, which it held for a while, is the palette on
commands; see the digit rule above.

The plane's Fit is Ctrl+Alt+0 for the same reason: it is read off the plane and the
press goes on to the window afterwards, so the two on one key would fit the plane and
resize the words at once. A surface with a zoom of its own - the canvas, the graph, a
page note - answers the same gesture on its own element, and the note's rule stands
down on anything one of them has already prevented, keys as well as the wheel.

**A page note's zoom is the same three keys, one modifier over.**

| | |
| --- | --- |
| Ctrl+Alt+= , Ctrl+Alt+- | a notch in and out of the paper |
| Ctrl+Alt+0 | fit the width, and keep the paper fitted from then on |
| Fit page | the whole of the page in the pane. No key out of the box; it is a row in the menu the percentage on the bar opens |
| Add a page | a page at the end. No key either: the gesture is carrying on scrolling past the last sheet, and the silhouette there is the button |

They share Ctrl+Alt+0 with the plane's own Fit and are not a clash, because both
are contextual and read off their own surface: only one of the two is ever in front
of a reader. `shortcuts.test.ts` pins all three keys, that none of them is one of
the text size's, and that the two commands with no key have none.

### Not covered

The canvas and the Even glasses. The plane has its own keyboard already, one
letter per tool, and it is a drawing surface rather than a list of names; the
glasses have no keyboard at all. Touch is unaffected by every word above.

## Where the code is

| | |
| --- | --- |
| `apps/desktop/src/lib/regions.ts` | which regions there are and which one a step lands in. Pure, tested |
| `apps/desktop/src/lib/focus.ts` | the same, against the real page: what is on screen, where the keyboard is, how to put it somewhere |
| `apps/desktop/src/lib/roving.ts` | one tab stop per list, and the arrows inside it. Every `.nib-row` list uses it |
| `apps/desktop/src/lib/walk.ts` | where a press moves a cursor down a list of rows |
| `apps/desktop/src/lib/list-keys.ts` | spelling a name, shared by every list |
| `apps/desktop/src/lib/tree-keys.ts` | left and right in a list that holds lists |
| `apps/desktop/src/lib/trap.ts` | a layer holds the keyboard and hands it back, and lands it on the layer's `[data-lands]` where it says so |
| `apps/desktop/src/lib/shortcuts/registry.ts` | every chord there is |
| `apps/desktop/src/lib/terminal/keys.ts` | which of them a terminal lets the app have. Pure, tested |
| `apps/desktop/src/lib/text-size.ts` | Ctrl and the wheel over the note, and what it does not touch |
| `apps/desktop/src/lib/camera.ts` | one notch of a zoom, for every surface that has one |
| `apps/desktop/src/lib/Pages.svelte` | the paper's own keys and the four other ways it is zoomed |
| `packages/editor/src/fold.ts` | the five folding commands, and what a level is |
| `packages/editor/src/lines.ts` | delete, join, sort and reverse lines, and a line above |
| `packages/editor/src/grow.ts` | the selection a step outwards, and back |
| `packages/editor/src/case.ts` | upper, lower and title case |
| `packages/editor/src/emoji.ts` | the one popup every completion source shares |
| `apps/desktop/test/e2e/keyboard.py` | the whole thing driven with nothing but `page.keyboard` |
| `apps/desktop/test/e2e/fold-levels.py` | Fold more and Fold less, driven from the palette |
| `apps/desktop/test/e2e/completions.py` | `[[##`, `[[^^` and `#` in the popup, driven by typing |
