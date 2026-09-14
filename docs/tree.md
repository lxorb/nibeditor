# The file list

Emil: *"no folders anymore as we can now nest notes already so they're
unnecessary."*

So the file list shows one kind of thing. Every row is a note. A note can hold
notes, and that is the whole of how a space is organised. The word "folder" is
not in the interface anywhere: not in a menu, not on a row, not as a mark and
not as a kind of icon to choose. What still says it, and why, is at the bottom
of this file.

On disk nothing changed. A note that holds notes is a folder holding a note of
the same name - the folder-note convention Obsidian's plugins read - and the
folders somebody else's vault arrived with are still folders. The filesystem is
the filesystem; only the interface stopped talking about it. `read_tree` and
`paths.rs` needed no change, and neither did sync, rooms, links, search, publish,
exports, the glasses or the clipper: all of them go on seeing files in folders.

## One row, and what it does

| | |
| --- | --- |
| the mark in front | what kind of file the row is: a page with writing on it for a note, two cards for a canvas, a book for a paper, a globe for a website, a plain page for a name nobody has written under yet. There is no folder mark, because no row is a folder; see `file-mark.ts`. Every mark comes off the name, the globe included: a website is a shortcut file, `Svelte docs.url`, which is the format Explorer and every browser write. It used to be a note with `url:` in its front matter, and the row had to ask the link index what the file said; see docs/web-tabs.md |
| the name | the note's, or the folder's for a row that is a folder - so a row whose note is somebody else's `index.md` is still called after its place |
| a click | opens what the row is |
| the twist at the far end | shows what the row holds, and only appears when it holds something |
| right, left | the twist for a keyboard: `tree.into` and `tree.out`, labelled "Show what it holds" and "Hide what it holds" |
| Enter, Space | open, the way a click does. Never fold: what a row holds is the arrows' business |
| a drag onto it | nests what was dragged inside it. A drag to the space under the last row un-nests. In Manual, the thin band at the top or the bottom of the row is the space between rows instead, and a drop there is a new order |
| Alt and up, down | in Manual, moves the row one step within its own group: `tree.move-up` and `tree.move-down`, labelled "Move up" and "Move down". Nothing in the other six orders, which are rules rather than arrangements |
| its menu | Open, New note inside, Rename, Move, Choose an icon, Bookmark, Duplicate, Delete - one menu for every row, differing only in the entries that mean something for it; see `row-menu.ts` |

**What the list itself makes** is under the panel's own menu, wherever in it you
ask: New note, New canvas and New web note - and a recording or a meeting on a
phone, where that menu is the plus. Each one puts a row in the tree waiting to be
named and writes nothing until it has a name, which is what Finder, Explorer and VS
Code all do. A website is named the same way, and what it is named is its title;
the address is asked for in the tab's bar afterwards. See docs/web-tabs.md. A
folder is not on that menu, because a note that holds notes is how a space is
organised; see below.

Clicking opens and the twist discloses, for every row without exception. That is
Notion's rule, and it is the one nib already had for a note that holds notes: the
name is the note, the caret beside it is what it holds. A row that opened on a
click in one place and folded on a click in another would be two kinds of row
wearing one design.

## What a bookmark may be

The row above the list keeps notes, folders, headings, blocks, searches, groups -
and one view of the space's graph. Each says where it points the way a link does,
relative to the space, so the list travels to every machine signed in.

A graph bookmark points at nothing on disk. It carries a whole set of graph
settings - the filter, the colour groups, the spread, the arrows, the sizes, how
far a neighbourhood reaches - as JSON in a field of its own, under the name the
reader gave it, and pressing it writes those settings into the space's own graph
settings and shows the graph. The space keeps one picture, which is what makes
the graph a command rather than something to open; a view is a second way of
looking at that one picture - the whole space, one project, what nothing links to
- without setting the card up again each time. `Bookmark this view` is the row
that makes one, at the foot of the graph's control card.

A build older than this one draws no row for a kind it has never heard of, and
writes the list back without it: a graph view made here disappears from a device
running an older nib rather than arriving broken. See
`workspace/bookmarks.svelte.ts` and `workspace/graph-settings.svelte.ts`.

## A folder somebody else made

A vault out of Obsidian is full of folders with no note of their own -
`Projects/` holding two notes and nothing else. nib never makes one of those: a
folder appears only because a note was nested, or because something outside nib
put it there. But they exist, they have to keep working, and the vault has to stay
a vault.

**Such a folder is drawn as the note it has not got.** The folder's name, the
plain-page mark, the row's quiet ink, and a twist for what it holds. Opening it
opens the note it would be - `Projects/Projects.md` - as an empty page, and
**nothing is written until somebody writes in it**. The first keystroke saves the
file the way every note in a space saves itself, and the row stops being quiet in
the same moment: the plain page becomes a page with writing on it. Nothing about
the vault changed by being looked at.

The alternative was a row that only expands and opens nothing. It was rejected
for the reason above: it is a second kind of row, and it would mean the list
quietly has two meanings for the same gesture depending on which vault a row came
out of. The quiet row says the honest thing instead - there is a name here and
nobody has written under it - and the way to change that is to write.

Two things follow, and both are deliberate:

- **A click never writes.** A reader browsing a hundred folders of somebody's
  vault leaves a hundred empty editors behind and not one file. This differs from
  following a link to a note the space has not got, which writes the note at once
  (`makeLinked`): the intent to have that note is in the reader's own text. A
  click on a row in a list is not that.
- **"New note inside" on such a row makes only the note asked for.** It does not
  make `Projects/Projects.md` on the way; nobody asked for that one.

## Which note a folder is drawn as

`folderNote` in `folder-notes.ts`, in this order:

1. **the namesake**, `A/A.md`. This is what nib writes, and what both of the
   folder-note plugins an Obsidian vault is likely to have look for by default -
   LostPaladin's `folder-notes` and xpgo's `folder-note-core`. The name has to
   match exactly: `Notes/notes.md` is a folder holding a note, because folding two
   rows into one over a disagreement about capitals would hide a row somebody
   meant to keep.
2. **the index**, `A/index.md` or `A/_index.md`, case insensitively. The other
   convention in the wild - the same plugins offer it, and every site generator
   calls a folder's own page that. Read on the way in, never written.

Read more widely than written, which is the rule for everything about somebody
else's vault. Two consequences:

- **Renaming** a row whose note is an index renames the folder alone. An index is
  named after its place rather than after itself, so the note keeps the name its
  convention gave it. A namesake is renamed with its folder, note first, because
  the links point at the note.
- **Un-nesting** only ever takes apart what nib itself made. Drag the last note
  out of `A/` and the namesake `A/A.md` comes back up as `A.md` and the folder
  goes, because the way in was one drag and dragging the last row out has undone
  it. A folder whose note is an `index.md` is left exactly as it is: that layout
  is somebody else's, and nib was asked to show the vault, not to rearrange it.

## Icons

A note keeps its icon in its own front matter, so it travels with the file; see
`docs/icons.md`. A folder has nowhere in itself to keep one, so the space keeps a
map of them - and that map is now only for folders that have no note yet, which
is the only kind of row that has no file of its own to write into.

The two meet in `chosen-icon.ts`: for `A/A.md` the map is asked under `A/`,
because the row wearing the mark is the folder and the note in one. So an icon
chosen on a vault's folder still dresses the row after somebody writes in it. The
file wins wherever it says anything, and the first icon written into the file
takes the map's word away for good (`setFileIcon` clears the key), so one row's
icon is never kept in two places.

The colour that icon is drawn in travels the same way, under the same keys: a
second map beside the first, sent in the same request, because one gesture in the
picker chooses both. It was this device's own until migration 0036 gave it a column
beside the icon it colours, which is why a tree dressed on a desktop used to arrive
on a phone in the plain foreground. See `docs/icons.md`.

There is no "folder icon" as a thing to choose. The menu says "Choose an icon" on
every row, and where the value goes is nobody's business but `file-icon.ts`'s.

## Moving something

The Move sheet - a row's own `Move`, and `Move this note` in the palette - offers
one target per row of the list, plus the space itself and any other space. No
folders, because there are none to offer: a note is offered as the folder it is
about to become, and a folder out of a vault as the row it is. Every target wears
a note's mark; a space wears the mark the switcher gives it, in the same box, so
the names still read as one column. See `move-targets.ts`.

## The order it is read in

Emil: *"there should be settings to decide the order of notes displayed in the
explorer, e.g. manual, name, etc. Manual will definitely need some work, make it
feel really really nice."* And: *"by name should be the default."*

Seven orders, behind the one glyph at the end of the panel's header - the same slot
the Links panel keeps its own two controls in. The row that is in force wears a
tick. The same seven are still on a right click on the Files tab, where the list's
sorting has always been, because one builder draws both.

| | |
| --- | --- |
| Name, A to Z | the default, and what the list has always done |
| Name, Z to A | |
| Modified, newest first | |
| Modified, oldest first | |
| Created, newest first | |
| Created, oldest first | |
| Manual | the order somebody arranged by dragging the rows |

Folders come first in all seven. That is what Obsidian, Finder and Explorer do, it
is what a reader looking for a folder expects, and it means a row only ever moves
within its own group: a note cannot be dragged above the last folder, and the gap
does not open where it could not land.

The names are spelled out rather than built from a key and a direction. A row
reading "Sort by modified" with an arrow beside it leaves the reader to work out
whether the arrow means the newest or the oldest; "Modified, newest first" says it.
Seven rows is also the whole answer in one glance, which a control that flips when
you press it twice never is.

**Which order is per space, and on this device.** Whether a space reads by name or
by age is how somebody is looking at it this afternoon: a space of meeting notes
wants the newest first and a space of chapters wants them in the order somebody
arranged, and a phone and a desktop can honestly disagree about it the way they
already disagree about which folders are open. So it sits beside how far down the
list each space was left, in `workspace/device.svelte.ts` under `nib:list-order`.
It used to be one choice for the whole app, in `nib:tree`; a value written there by
an older build is ignored.

**Nothing is read off the disk to change it.** The listing in memory is the
listing, and which order it is drawn in is arithmetic over it - `orderedTree` in
`tree-order.ts`, applied once in `shownTree`. That comparator is the only part of
this the first paint pays for, because the first paint *is* the file list; the lift,
the arithmetic of a drop, the seven words of the menu and the account's half of what
somebody arranged are fetched by the first drag, the first press and the first
syncing pass - `tree-lift.ts`, `tree-arranging.ts`, `order-menu.ts` and
`workspace/arranging.ts`, thirty-one kilobytes that a reader who never rearranges a
folder never loads. See `test/weight.test.ts` for the ceiling that keeps it so. So the rows are in their new places in
the frame the menu closes in, where this used to cost a round trip and a fresh
read of the whole space. It is also what makes Manual possible at all: the sort was
in the Rust crate and in the browser build's own listing, and an order the reader
arranged is one no listing can know about. Both of those now answer in name order
and nothing else reads their order as meaningful.

Names sort the way a reader reads them, through ICU with `numeric` on, so `Note 2`
comes before `Note 10` and the case of the first letter is no reason for one name to
come before another. Two names that compare equal fall back to an exact comparison
and then to their code points, because a list that reorders itself between two reads
of the same folder is worse than one with an opinion about capitals.

### Manual

The order lives on the space, not in it. One map per space, from a folder's path as
the space speaks it to the names of its children in the order they are drawn, kept
where a folder's icon is kept and synced the same way: the account for a space the
account knows, this machine for one it does not. Migration 0037 gave it the
`arranged` column, `workspace/arranged.svelte.ts` is this end of it, and
`spaces/arranged.ts` is the other. A dotfile inside each arranged folder would have
synced for free and survived a move without being told - and it would also put a
file into somebody's vault that every other tool walking it can see, which the space
does not do.

The list only runs as far as somebody actually arranged. A name the list does not
hold falls to the end of its group in name order, so pulling three notes to the top
of a folder of four hundred writes three names, and a folder that reads in name
order keeps no entry at all. Which is also why Manual starts out identical to Name,
A to Z instead of freezing today's listing into the space; see `trimmed` in
`tree-order.ts`.

The saving is at the front, and only at the front: the list is read from the
beginning, so saying that one row sits second from the bottom means naming every row
above it. Nudging the last note up by one in a folder of sixty writes sixty names,
where pulling it to the top writes one. That is the price of the rule that makes the
common case free, and it is bounded rather than unbounded: two hundred folders and
five hundred names each, against a column of thirty-two kilobytes.

A rename rewrites the name in place, so the row keeps where it was arranged to. A
move takes it out of the list it was in and leaves it at the end of the one it
arrives in. A folder that moves takes its own list and every list under it along,
re-keyed, which is the one thing the dotfile would have got for free. A delete takes
the name out. All four are hooked where `folderIcons.moved` and `folderIcons.gone`
already were, including the undo of a rename or a move.

### The drag

| | |
| --- | --- |
| lifting it | a press and a move with a mouse or a pen, which is the drag the platform starts; a press, a short hold of 250 ms and a move under a finger, which is the only gesture a touch screen has - it fires no drag events at all. The hold is shorter than the 500 ms the row's own menu waits, so a press that then moves is a drag and a press that stays put is a menu |
| what follows the pointer | a copy of the row, a little larger and with a shadow under it. The platform draws that itself for a drag it started; a lift draws its own, in `body`, so no scroll and no rebuild of the window can take it away mid-gesture |
| where it will land | the row's own place in the list, drawn hollow. The gap is the row, so there is no drop line to draw and nothing for the reader to translate: what they see is the answer |
| the other rows | slide out of the way over 180 ms, ease-out, measured before and after the order changes and started from their own old places. Instant for a reader who has asked for as little movement as possible |
| onto a folder | the middle half of any row is still the row: a drop there goes into it, exactly as it always has. Resting there for 400 ms opens it, so a drop can go further in than the row it started over |
| near an edge | the list rolls under the pointer, the same band and the same speed a drag has always had |
| Escape | everything slides back |
| the keys | Alt and an arrow, one step at a time, with the same slide |

The gap is written into the store rather than held in the component, which is what
makes the gap under the pointer the same gap the whole list is drawn from: one
source for the order, so the rows in the window, the rows the keyboard walks and the
row being dragged cannot come to different answers. It is computed from what the
folder keeps rather than from what is showing, so the answer depends on where the
pointer is and not on how it got there - a drag computed from its own last frame
drifts, and a row dragged down and back does not come back. And a pointer resting
over the row it is carrying holds the gap where it is, which is what stops it
flicking back and forth.

Virtualisation is not in the way of any of it. The window mounts a slice of the
rows and the lift reads the row under the pointer out of the page, so a drag works
the same in a space of twenty notes and one of five thousand; the rows that scroll
in while the order changes have a place to be rather than a distance to travel, and
are left out of the slide. See "Only the rows in view" below.

The search panel and the quick switcher are not affected by any of this. They rank
what they show by how well it matched, which is a different question about a
different list; see `search.svelte.ts`.

## What still says "folder", and why

- **The filesystem layer.** `read_tree`, `create_folder`, `remove_empty_folder`,
  `folderOf`, `targetFor`, `TreeRow.folder`, `is_dir`. These are about the disk,
  where folders are exactly what they have always been.
- **`folder-notes.ts` and `workspace/folder-icons.svelte.ts`.** Named after the
  convention they implement, which is what it is called everywhere outside this
  app.
- **`workspace/arranged.svelte.ts`**, whose map is keyed by folder and whose
  `folders` field says so. It is a map of paths on a disk, and a path is made of
  folders.
- **The settings that say where pictures go**: "Assets folder of the space", "A
  folder named after the note". Those name real folders on disk that another app
  will also look in.
- **"Open themes folder"**, which opens a folder in Explorer or Finder.
- **Two lines in the import sheet**: "A zip, a folder, or a file another app
  wrote", which is what may be dropped on it, and "{count} archived notes are in
  a folder called Archive", which names a folder the import makes. Both are
  about what another app wrote and where it went, which is the one place the
  reader is looking at somebody else's filing rather than their own notes.
- **The Files tab's mark**, which is a folder shape with its corners taken off.
  It names the panel rather than a row, and the panel's own label says FILES.

## Only the rows in view

A space of three thousand notes is a list of three thousand rows, and a panel shows
twenty of them. It used to draw all three thousand: three thousand buttons, three
thousand marks, and three thousand reads of the link index the moment that index
landed, which was the two hundred milliseconds of rendering left after the list
first appeared. Now it draws the twenty in view and six either side - thirty-two to
forty, measured - and the rest of the height stands in as one empty box above the
window and one below.

Nothing about a row changed. Same button, same classes, same marks, same menu, same
drag, same twist.

- **The list is flat.** `flatRows` in `tree-flat.ts` walks the tree once into one
  row per line the reader can see, each saying how far in it sits. The component
  no longer draws one of itself per open note - it could not, because a component
  that holds itself can count nothing, and a window needs the rows numbered.
  `visibleTree`, which the keys and the selection already walked, is that same
  list: one list, numbered once, so an arrow that lands on row forty and a window
  that mounts thirty to sixty agree about which row forty is.
- **No row is ever measured.** Every row is exactly `--row-height` tall, 28 under a
  pointer and 56 under a thumb, because a label is one line that gives way with an
  ellipsis. So where a row sits is `index * height`, and turning a twist lengthens
  the list rather than any row in it. `row-window.ts` is that arithmetic, and it is
  pure: what mounts for a given scroll position is a table of numbers in
  `row-window.test.ts` rather than something to drive with a mouse.
- **A twist still slides.** The band of rows coming out is drawn short and clipped
  and everything under it sits that much higher, over the same 190ms the wrapper's
  own `slide` took; a reader who has asked for less movement gets none. A twist
  going shut holds the list as it was for those 190ms, since the rows on their way
  out have already left it. The part of a band that is not out yet is not drawn at
  all: a row no pixels high adds no pixels, and a note holding four hundred notes
  would otherwise mount four hundred rows for the first frame of the slide.
- **Three rows are held wherever they are**: the row with the keyboard on it, the
  row whose name is being typed, and the row a key or an open has just asked for.
  Each is drawn at its own offset outside the window when the scroll has left it
  behind. A focus inside a row that has been taken away is a focus on nothing.
  Held and windowed are **one keyed list**, so a row that is being held and then
  becomes a row of the window is the same element throughout. Two lists made that
  one element ending and another beginning, and it cost the keyboard twice: End
  landed on nothing, and a name being typed lost its field the moment the folder
  under it finished opening.
- **A row is reached by pinning it and then asking the browser to scroll to it.**
  Not by arithmetic: what a scroll has to clear is more than the rows - the label
  above the list, the empty stretch below it, the box's own padding - and how far a
  scroll may go at all is the box's to say.
- **The scroll says nothing about where the rows are.** `overflow-anchor: none`:
  a browser keeps a reader's place through a change in height by holding the scroll
  to something on screen, which is right for a page of words and wrong for a list
  whose rows come and go - the row it anchored to has left the page a frame later.
  Turning a note's children out moved the scroll two thousand pixels on its own.
- **The bookmarks above the list are not windowed**, and should not be: they are
  what somebody chose to keep, which is tens of rows, not thousands. The section
  labels over the two groups are unchanged - they are siblings of the list in the
  same scroller, where they always were.
- **How far down each space was left** is remembered beside which notes are open,
  in `workspace/device.svelte.ts`: on this machine, per space, written down once the
  scrolling stops. It costs one assignment to restore, because the height is
  arithmetic rather than three thousand rows that have to exist first.
- **Which of those two wins when the panel appears**: the place it was left on. The
  first note the panel sees is the note that was already open - a launch, a panel
  switched back to - and that is not a note being opened. A note opened after that
  is brought into view, nearest, so a row already on screen is not pulled around
  under the reader.

## Seeing it

- `apps/desktop/test/e2e/plain-folders.py` - a vault with `Projects/` and a
  `Handbook/index.md`, on a desktop and on a phone: the quiet row, its menu, what
  opening it does and does not write, and what writing in it changes.
- `apps/desktop/test/e2e/nesting.py` - a note nested into a note and back out.
- `apps/desktop/test/e2e/tree-create.py` - the four things the list makes: a note
  and a canvas on the empty ground, a note inside a folder nobody wrote, and a
  note inside a note.
- `apps/desktop/test/e2e/big-list.py` - a space of three thousand notes: how many
  rows are in the page, and every gesture that has to reach one that is not.
- `apps/desktop/test/e2e/tree-order.py` - sixty files in five folders, photographed
  in each of the seven orders, then rearranged with a mouse and, at phone width, with
  a finger; and the browser relaunched against the same profile to prove the
  arrangement came back rather than never left.
- `scripts/order-probe.py` - the same seven orders in a built probe app, a row moved
  within the arranged one, and a relaunch of the process: the half only a built app
  can answer.
- `apps/desktop/src/lib/tree-order.perf.test.ts` - what an order costs at five
  thousand notes, counted in comparisons rather than timed.
