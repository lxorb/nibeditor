# The archive

Emil: *"Archive notes. And archived note should never be deleted. But it
shouldn't be displayed where it was before. Still, it should be able to
unarchive a note and then it will be exactly where it was before."*

Three promises, and the third one decides the design. A note that has been put
away has to come back **exactly** where it was, so nothing moves. The mark goes
in the file and the file stays at its path.

The obvious alternative was an `Archive/` folder. It fails all three: the app
would have to remember every path a note came from to put it back, every link
into the note would break on the way there, and the sync would see a file move
rather than a note whose content changed. Writing one line into a file costs
none of that, and Obsidian reads the line as an ordinary property.

## What the mark is, per kind of file

Each kind says it in the one place it already keeps its icon.

| | where the mark is | what it looks like |
| --- | --- | --- |
| a note, `.md` | front matter | `archived: 2026-09-14T10:00:00.000Z` |
| a canvas, `.canvas` | the `nib` key, beside `nib.icon` | `"nib": { "archived": "2026-09-14T…" }` |
| a page note, `.pages` | the same key, because it is the same JSON | `"nib": { "archived": "2026-09-14T…" }` |
| a website, `.url` | a line beside `Nib-Icon` | `Nib-Archived=2026-09-14T10:00:00.000Z` |
| a folder with no note of its own | the space's own map | `nib:archived-folders`, and the account where the space syncs |

A folder that holds a note of its own name **is** that note - `A/A.md` and `A/`
are one row in the file list - so it is archived through the note, in the note's
own front matter. The map is only for a folder that has no such note, which is
one out of somebody else's vault: there is no file anywhere to write into. That
is the same split the folder icons make, for the same reason; see
`docs/icons.md` and `workspace/archived-folders.svelte.ts`.

A `.webloc` cannot be archived. That is macOS's shortcut format, this app reads
one and has never written one, and there is no key in it to write the mark into.
The row is not offered Archive rather than being offered one that does nothing.

### The value, and what counts

The value is a date and time, because the archive is read newest first. The
**reading** is not held to that: anything the file says counts as archived
except the two words that mean it does not.

```
archived: 2026-09-14T10:00:00.000Z   archived
archived: true                       archived
archived: soon                       archived
archived: false                      not archived
archived: no                         not archived
archived:                            not archived
```

So a reader who ticks a checkbox called `archived` in Obsidian's property editor
has archived the note here, and unticking it has taken it back. A note ticked
that way has no time in it and sorts last inside its folder in the archive,
which is the honest answer: the file does not say when. See `archived.ts`.

## Where an archived note disappears from

There was already a concept for this. Obsidian's "excluded files" - a folder a
reader leaves out of the search by hand - is `workspace/excluded.svelte.ts`, and
it means the same thing to every list: hidden from what the space says about
itself, still there to open. So archiving is a **second source feeding the same
predicate** rather than a second thing for each list to learn about.

That predicate is `workspace/left-out.svelte.ts`. One question, asked in one
place: *is this one of the notes I am not meant to be showing?* A list that
honours it honours both sources, and whatever the third turns out to be. Before
this, the tag counts honoured neither: a row said `#work 12` and the search
behind that row came back with 9, because the count walked every note and the
search left the excluded ones out. Now they are the same number.

Gone from:

- the file list, and the arrow keys that walk it - one filter on `shownTree`, so
  the mounted rows and the walked rows cannot disagree
- the quick switcher
- the search, unless the reader presses the one chip (below)
- the graph, both the tab and the Links panel's neighbourhood
- the tag tree and the counts on it
- the recents in the palette
- the glasses' list of notes, and its voice `switchNote`
- the mentions that are not links yet, and the blocks `[[^^` searches
- what `file:` completes in the search field
- `[[` autocomplete, with one exception: typing a note's **whole** name still
  offers it, marked `Archived`. Somebody who types the whole name knows it is
  there and means that one. A link to an archived note is a link anybody may
  want to write, and a link that already exists still resolves, still draws as a
  link and still opens - putting a note away is not deleting it.

Still reachable through:

- any link, from anywhere
- a bookmark, whose row wears the word `Archived`
- the archive itself
- the trail behind a tab, so Back still works

### The search chip

The search field carries one chip, `Archived`, and only in a space that has
something archived in it. Off, the archive is left out. On, the archive answers
too - the one place in the app that looks inside it by words rather than by
name, which is what somebody half-remembering an old note needs.

The chip does not touch a reader's own exclusions: those are folders they said
to leave out of the search, and this chip is about the archive.

The list goes to the walk rather than being filtered afterwards, which is what
the Rust crate and the browser's worker already took for the excluded list. So a
result limit is never spent on a row nobody was going to see, and nothing is
lost to a cap.

## How a reader archives

| where | what it says |
| --- | --- |
| a row's menu in the file list, right-click or long-press | Archive |
| a tab's menu | Archive |
| a website's own ⋮ menu | Archive |
| the command palette | Archive note, or Unarchive note. No default key |
| the Properties block in the note | `archived` is a row like any other, and editing it works, because it is the same source of truth |

Archiving the open note closes its tab and says `Archived` in the corner, with
Undo. A website's live page is let go of the way a closed tab's is. The tab is
closed without asking, because the mark has just been written through the editor
- there is nothing unsaved to ask about, and a question would be the app arguing
with a gesture it had already carried out.

Opening an archived note - from a link, a bookmark, the archive, the trail - puts
a thin strip at the top of it: `Archived`, and Unarchive. Writing stays allowed
underneath. An archived note is put away, not sealed, and a reader who opened one
to add a line should not have to take it out of the archive first.

## The archive list

A section at the foot of the file list, the way the bookmarks are a section at
its head - the two bracket the files, and the rows are the bookmarks' rows to the
character. It is shut until somebody opens it, and not drawn at all until the
first thing goes into it: an empty archive is a row explaining a feature at the
foot of the panel that is read most.

Rows are grouped by the folder each thing was in, so the reader sees **where** it
was rather than only that it is gone, and newest first inside a group. Each row
carries its own mark or favicon, its name, and `archived 2 days ago`. A click
opens it. Its menu offers Open, Rename and Unarchive. Unarchiving says
`Unarchived` in the corner, with Undo.

Which of the lists is unfolded is this machine's business, like the file list's
sort, and is not written down: see `archive-list.svelte.ts`.

## Never deleted

This is the promise that has to hold everywhere, so it is answered next to the
deletion rather than by each menu that offers one. `workspace.refusesDeleting`
is read by `Workspace.remove` itself, which means:

- the row's menu says Unarchive where Delete would be
- the Delete and Backspace keys do nothing on an archived row
- a selection of several deletes the rest and leaves the archived one, and the
  menu's count says so rather than promising a row it is going to leave
- `deleteFile` in the automation surface is refused too, and so is any caller
  written later that never thought to ask

Deleting a **folder** with something archived inside it is refused as well,
because that would take the archived note with it. The sheet says how many are
in the way - `3 archived notes inside` - and its one button, Show them, opens the
archive narrowed to that folder. Nothing is deleted.

Renaming or moving an archived note keeps the mark, which needs no code for a
file - the mark is inside it - and for an archived folder is the map's key being
rewritten, exactly as the folder icons' keys are; see `moved` in
`workspace/archived-folders.svelte.ts`.

A manual order the file list keeps per folder is never touched by archiving. An
unarchived note comes back to its own place in that order because its name never
left the list.

## Sync

For a note, a canvas, a page note and a website the mark is content, so the sync
carries it with the file and needed no change: the Worker sees a note whose bytes
changed, which is the thing it does all day.

The folder map is not content - there is no file - so it goes where the folder
icons and the excluded list already go: the account for a space the account knows
about, this machine for one it does not. `PUT /v1/spaces/:id/archived-folders`,
at most 400 folders, and the map comes back in the space listing under
`archivedFolders`. Migration `0037_space_archived_folders.sql`.

## What Obsidian sees

A property called `archived` with a date in it. It shows up in the properties
panel, `[archived]` finds those notes in its search, and Dataview can filter on
it. Nothing is hidden there, because nothing about the note changed except one
line of its own metadata - which is the point of putting the mark in the file.

A canvas and a page note carry it under `nib`, the one key JSON Canvas leaves for
things no other app has to look at, so Obsidian's canvas reads the file and
ignores it. A `.url` gets one more `Key=value` line, which every INI reader steps
over.

## Where the code is

| | |
| --- | --- |
| `archived.ts` | what the mark is called, and what counts as archived |
| `archive.ts` | writing it, per kind of file, and what happens around the writing |
| `archive-list.svelte.ts`, `Archive.svelte` | the list at the foot of the file list |
| `ArchiveBanner.svelte` | the strip on an open archived note |
| `workspace/archived-folders.svelte.ts` | the map, for a folder with no note |
| `workspace/left-out.svelte.ts` | the one predicate, and its two sources |
| `toasting.svelte.ts`, `Toast.svelte` | the word in the corner, and Undo |
| `scan-note.ts`, `scan-canvas.ts`, `links.rs` | reading the mark on the pass that reads the space |
