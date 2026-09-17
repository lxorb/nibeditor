# Icons

Anything in the file list can wear an icon: a note, a canvas, a folder somebody
else's vault arrived with, and the space that holds them. One picker chooses it,
one component draws it, and one string says what it is.

## Where each one is kept

A chosen icon belongs to the thing that wears it, so it is kept in the only place
that thing has.

| Wearer | Where | Why there |
| --- | --- | --- |
| a note | `icon:` in its own front matter | The one place a markdown file has for metadata. It travels with the file into another vault, and Obsidian's Iconize plugin reads the same key. |
| a canvas | `nib.icon` in the `.canvas` JSON | A canvas has no front matter. `nib` is the one top-level key the JSON Canvas spec leaves for what is ours, and the ink already lives there; under it the file is the spec exactly. |
| a folder with no note of its own | one map per space, `icons: { <path>: <name> }` | A folder is not a file. Kept beside the space rather than inside the folder: nothing is added to anybody's folders, the map is the size of what was chosen, and it goes where the space's other settings go. |
| a space | this device's own store, keyed by folder, and the account's `icon` column | It was a device's choice before it was the account's, and it still is on a machine that is not signed in. Keyed by folder here rather than by id, so it survives the ids being handed out again. |

Three ways of giving a folder an icon were weighed. A dotfile inside the folder
would sync for free and survive a move without being told, but it puts a file in
every folder somebody marked and every other tool that walks the vault sees it. A
`folder.md` index note is Obsidian's folder-note convention, and a folder that has
one of those is a note in nib and keeps its icon in that note's front matter like
any other. The map is what is left for the folders that have no such note - the
ones a vault arrived with - and it costs one obligation: a rename, a move or a
delete has to rewrite the key, which is `moved` and `gone` in
`workspace/folder-icons.svelte.ts`.

The two never disagree. A row that is a folder and the note inside it reads the
map under the folder's path as well as the note's own front matter, so an icon
chosen before anybody wrote in that folder still dresses the row afterwards; the
front matter wins wherever it says anything, and the first icon written into the
note takes the map's key away. See `chosen-icon.ts` and `docs/tree.md`.

A folder's map rides the space rather than the account's settings blob, for the
reason its bookmarks do: it points inside one space, so it goes with the space when
it is deleted and comes back when it is restored. `PUT /v1/spaces/:id/icons` writes
it and `GET /v1/spaces` carries it, so a machine reads it in the listing it already
fetches rather than one request per space.

## The colour, and where it goes

Each of those two icons - a space's and a folder's - has a second value beside it
for the colour it is drawn in, and each is kept beside the icon it colours:
`spaces.tint` beside `spaces.icon`, `spaces.tints` beside `spaces.icons`, both
added by migration 0036. One request writes both halves, because one gesture in the
picker chooses both: `PATCH /v1/spaces/:id` takes `tint` beside `icon`, and
`PUT /v1/spaces/:id/icons` takes a `tints` map under the same keys as the `icons`
one.

Two values rather than one, and two columns rather than a pair per entry. The first
is what other apps and older builds read: a note says `icon: rocket` and
`icon-color: violet` on two lines so Obsidian's Iconize still finds the icon and
ignores the colour, and a map of strings is a map an older build reads and writes
back whole - a value that is not a string is a value it drops, which would be every
colour anybody chose.

The service reads the shape of an accent's id rather than a list of them - a short
lowercase name - for the reason it reads a set it has never heard of in an icon: the
accents are the app's, they are named in one file there, and a palette that gains a
colour must not wait on a deploy. A hex, a path or a shouted name is not that shape
and leaves the colour as it was.

Two things a sync must not do, and neither does:

- **Undress what an older machine cannot see.** A request with no word about the
  colours leaves the columns as they are; only an empty map takes them away. So an
  app older than 0036, syncing the same account, carries the icons and touches
  nothing else.
- **Lose what was chosen offline.** A push that did not land is written down as not
  said, and the pass after that folds this machine's maps in and sends them again
  instead of handing back the account's copy of a choice the account never heard.
  A space's own colour has the same rule in one line: a listing with nothing at all
  where the colour goes is a service older than the column, so this machine's colour
  stays and is sent up.

After that the account holds the one copy of both, the way it does for the icons:
a colour taken off on another machine is taken off here.

`apps/desktop/test/e2e/tints.py` drives the pair against a real Worker: the
migrations applied the way a deploy runs them, one account on two devices, a mark
dressed on one and read on the other, an older app that undresses nothing, a colour
taken off, a folder renamed with its colour, and the values that are not accents.

## What a value says

One string, three things it can be:

- an emoji, written as the character: `🚀`
- a name on its own, which is Lucide's: `file-text`
- `set:name` for any other set: `flat-color-icons:calendar`

Lucide has no prefix because a bare name has always meant Lucide and files already
say it that way. A set this build has never heard of reads as a set rather than as a
name, so the row falls back to its kind's mark instead of drawing the wrong picture.

Read more widely than written. Obsidian's Iconize puts a two-letter pack prefix in
front of every name it writes - `LiFileText`, `FaRocket` - and nib looks any of them
up in Lucide without the prefix, which is the right answer far more often than
nothing at all. Letters and digits alone decide, so `FileText`, `file-text` and
`file_text` are one icon.

The colour a stroked icon is drawn in is a second value, never folded into the
first: a note keeps it under `icon-color:`, a canvas under `nib.iconColor`, a space
and a folder in the columns above. Two keys so that an app reading the note still
finds the icon and simply ignores the colour. The value is one of the app's own
accents by its id, so it has a shade for black and one for white and still means
something in next year's palette. An emoji and a coloured drawing take no colour:
they are already pictures in their own colours.

## The sets

| Set | What it is for | Size | Licence |
| --- | --- | --- | --- |
| Emoji | The whole Unicode set, drawn by the platform's own colour font. The breadth is the point, and the drawings cost nothing to ship. | 422 KB of index (`unicode-emoji-json`, MIT) | the font is the platform's; the index is MIT |
| Lucide | The stroked set the interface itself is drawn in, so a chosen icon sits beside the app's own marks without looking borrowed. The one set a colour applies to. | already in the app | ISC |
| Flat Color Icons | Everyday objects drawn flat and in colour: a calendar, a graph, a suitcase. Where Lucide is a line and an emoji is a face, this is the drawing you would put on a filing cabinet. | 166 KB, 329 icons | MIT, by Icons8 |

Two coloured sets with real breadth were weighed and refused on size: Twemoji
(10.5 MB, CC-BY-4.0) and Fluent Emoji Flat (9.2 MB, MIT) both redraw in colour the
emoji the platform font already draws in colour, and Iconify's brand set (7.6 MB,
CC0-1.0) is seven megabytes of other people's trademarks.

Every set is fetched the first time somebody opens its tab, once however often it is
asked for, and out of the app's own build - never from a CDN, which would have a
private notes app phone a stranger to draw a folder. The two that are data rather
than drawing are left out of the Even Realities plugin build: half a megabyte of
JSON for a picker whose one job on a phone is to put a mark on a folder, while the
glasses draw a row as words with no mark in it. A set that is not in a build says so
once rather than loading for ever.

## What draws them

`Icon.svelte` draws all three kinds and nothing else does, because there are three
honest ways to put a picture on screen and they are not one thing: a character the
font draws, a stroke this app dresses itself, and somebody else's finished drawing
that has to be left exactly as it was. The box is the caller's - `--icon-md` for a
mark in a row, and `--icon-md` again inside a space's badge, because a mark in a
badge is a mark in front of a name - and so is the colour, since
`stroke` inherits and a list that says the row it is on wears the accent says it once
on the box.

`FileMark.svelte` is that plus a fallback: the mark the kind wears, for a row that
chose nothing, a caller that knows a name but no path, a name no set holds, and the
moment before a set has arrived. It reads the icon off the path rather than being
handed one, which is why a folder and a canvas got icons for nothing the day the
stores learned to keep them: the tree, the tab strip, a search hit, a bookmark and
the Move sheet all draw this component.

The marks a kind wears are one set and are held to it: Lucide's own drawings, off
the same 24 unit grid, at the same weight, filling the same 20 of it. The last of
those had one exception - Lucide builds `workflow`, which is the canvas, out of its
own eight unit cards, so it filled 18 where the rest fill 20. In a row that is a
tenth of a pixel; at the size the buttons in an empty pane draw a mark, and on a
pinned tab, which is its mark and nothing else, it read as the canvas being smaller
than what it sits beside. So the canvas is that drawing on the family's grid, in
`file-mark.ts`: the same three shapes, the same corners, the same two units of air
between the cards. Lucide's `image` is drawn to 18 as well and is left alone - one
full card that fills a box as far as a circle does reads bigger than the circle, and
two small cards on a diagonal have no such weight to hold back.

A tab hands it the path as well. What a window wears and what a row wears are the
same question about the same file, so there is one answer to it - Emil, 2026-09-17:
*"for all note types, the tab icon and the explorer icon should always be the
same."* `TabMark.svelte` adds only the three marks a tab has and a row has not: the
space's own picture for the graph, the picture a website's page found while it was
loading, and the turn while it is still loading. It used to answer the whole question
itself, on the grounds that a strip should say which kind each window is, and the
cost was that the one thing somebody chose about a note was the one thing the tab
would not show - and a pinned tab, which is its mark and no name at all, was a row of
identical pages.
