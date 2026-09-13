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
| `space` | the panel's header, which is the space's name and its switcher |
| `panels` | the row of panel tabs |
| `search` | the search pill under them |
| `list` | whichever panel is open |
| `foot` | the row under it: the account, the theme, the settings |
| `tabs` | the strip of notes |
| `editor` | the note |
| `status` | the bar under it, over a note |
| `right` | the other side of the window, once a panel has been moved over to it |

They are marked in the page with one `data-region` attribute each, so the order
F6 walks is the order the window is built in and cannot drift from it. What is
not on screen is not in the ring: the sidebar may be shut, a phone has no strip,
the graph, a canvas and a page note have no status bar - the bar counts the
words of a note, and none of those three has a note for it to count; see
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
| Ctrl+P | the palette. Type for a note, `>` for a command (already there) |
| Ctrl+O | open a file (already there) |
| Ctrl+Shift+? | every key there is, which is the Shortcuts pane in Settings |

**The panels**

| | |
| --- | --- |
| Ctrl+Shift+E | Files |
| Ctrl+Shift+O | Outline |
| Ctrl+Shift+F | Search (already there) |
| Ctrl+Shift+B | Links |
| Ctrl+Shift+L | show or hide the sidebar (already there) |

Each of the four opens its panel **and puts the keyboard in it**, and pressing it
again while the keyboard is already there gives the note the keyboard back. One
key there and one key back: the alternative is a key that opens something and a
second key nobody remembers for leaving it.

They are letters and not digits, and that is not taste. Ctrl+Shift and a digit is
not a key a text editor can spend: on a layout where the digit itself is the
shifted character, which is every AZERTY, CodeMirror reads the press as Ctrl and
the digit and sets a heading level. Ctrl+Shift+3 used to open the file list and
turn the line into a heading, both. A letter cannot be read that way round,
because the shifted letter and the letter are different names for the key.

The same rule caught one that was already there: Actual size was on Ctrl+Shift+0
and Ctrl+0 is Paragraph, so on those layouts it reset the zoom and flattened the
heading the caret was in. It is Ctrl+Alt+0 now, which is still the 0 every
browser resets with. `shortcuts.test.ts` fails if another one appears.

**The notes**

| | |
| --- | --- |
| Ctrl+Tab, Ctrl+Shift+Tab | round the strip (already there) |
| Ctrl+Alt+1 to 9 | the note at that place (already there) |
| Ctrl+W | close (already there) |
| Ctrl+Shift+T | reopen the last closed one (already there) |
| Ctrl+Alt+Right, Ctrl+Alt+Down | split (already there) |
| Ctrl+Alt+O | the other pane (already there) |

Under the Obsidian preset the digits move to Ctrl+1 to Ctrl+9, which is
Obsidian's own, and the heading levels give them up.

**A web tab**

Four keys that only mean anything while the pane is showing a website, and they are
the four a browser has taught everybody. They are in the registry like the rest, so
they show in Settings, show in the palette and can be rebound.

| | |
| --- | --- |
| Ctrl+T | a new tab. In a web tab that is a new web tab, on the new tab page |
| Ctrl+W | close, which is the same key every other tab closes with (already there) |
| Ctrl+L | the address field, in the pane that has the focus |
| Ctrl+Shift+N | a private tab: an ephemeral profile, no extensions, nothing kept |
| Alt+Left, Alt+Right | back and forward, which in a web tab is the page's own history (already there) |
| Ctrl+F | find in page - nib's find bar over the engine's own find (already there) |
| F12 | the engine's developer tools |

Ctrl+L is also the chord CodeMirror selects a line with, and both keep it, because
the bar reads the press where the bar is rather than off the window: an app-level
binding would never reach the editor, while a pane showing a page has no editor to
shadow.

**And these work even while the page has the keyboard**, which is new and is the
whole reason the engine underneath matters. A child webview of the system's engine
hands the host no chance at a key, so after a click into a site Ctrl+L used to be
that site's shortcut and the app never saw the press. Chromium gives the host
`OnPreKeyEvent`, in the browser process, before the page's own handlers - so these
seven are the shell's and everything else is the page's, including a site that wants
Ctrl+K for itself. See docs/browser.md.

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
from zooming underneath; the window's own zoom hotkeys are off for the same
reason. What has just happened is said once, as a badge over the note, and goes.

The keys stay where they are: **Ctrl+Shift+=**, **Ctrl+Shift+-** and
**Ctrl+Alt+0**. Ctrl+= and Ctrl+- are Heading up and Heading down in the editor
and have been since the first version, Ctrl+0 is Paragraph, and Ctrl+Shift+0 is
the clash the digit rule above is about. These three are also Typora's own, which
is the editor nib is closest to. A surface with a zoom of its own - the canvas,
the graph, a page note - answers the same gesture on its own element, and the
note's rule stands down on anything one of them has already prevented.

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
| `apps/desktop/src/lib/text-size.ts` | Ctrl and the wheel over the note, and what it does not touch |
| `packages/editor/src/fold.ts` | the five folding commands, and what a level is |
| `packages/editor/src/emoji.ts` | the one popup every completion source shares |
| `apps/desktop/test/e2e/keyboard.py` | the whole thing driven with nothing but `page.keyboard` |
| `apps/desktop/test/e2e/fold-levels.py` | Fold more and Fold less, driven from the palette |
| `apps/desktop/test/e2e/completions.py` | `[[##`, `[[^^` and `#` in the popup, driven by typing |
