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
| a drag onto it | nests what was dragged inside it. A drag to the space under the last row un-nests |
| its menu | Open, New note inside, Rename, Move, Choose an icon, Bookmark, Archive, Duplicate, Delete - one menu for every row, differing only in the entries that mean something for it; see `row-menu.ts`. An archived row says Unarchive where Delete would be, and is never deleted; see `docs/archive.md` |

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

## What still says "folder", and why

- **The filesystem layer.** `read_tree`, `create_folder`, `remove_empty_folder`,
  `folderOf`, `targetFor`, `TreeRow.folder`, `is_dir`. These are about the disk,
  where folders are exactly what they have always been.
- **`folder-notes.ts` and `workspace/folder-icons.svelte.ts`.** Named after the
  convention they implement, which is what it is called everywhere outside this
  app.
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
