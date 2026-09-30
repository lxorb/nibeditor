# The archive

Emil: *"Archive notes. An archived note should never be deleted. But it shouldn't be
displayed where it was before. Still, it should be able to unarchive a note and then it
will be exactly where it was before."*

Anything in a space can be archived: a note, a folder with everything in it, a canvas,
a page note, a web note, a PDF. It leaves every list that speaks for the space, it is
never deleted, and taking it back puts it exactly where it was.

## Beside the file, not in it

Gmail, Keep and Bear keep an archive as a fact about an item rather than a place it is
moved to, and so does nib. Nothing moves and nothing is written into the file: an
archived note keeps its path, its bytes and its modified time, so a list sorted by name,
by date or by hand has it back in the same row. Obsidian's archive plugins move files
into an `Archive/` folder instead, and then have to remember every path they came from,
break every relative link on the way, and write the old path into front matter so a
synced copy can still find its way back. An earlier branch here wrote the mark into each
file; that changed the modified time, needed a second store for folders anyway, and
could not mark a PDF or a note shared to be read.

So each space keeps one map beside it, `nib:archived`, the way it keeps its folder icons
and its exclusions: a path as the space speaks it, to a moment. Positive while the path
is archived; negative once it was taken back. A folder stands for everything under it.
See `apps/desktop/src/lib/workspace/archive.svelte.ts`.

## Where it is gone from

The file list and the keys that walk it, the quick switcher (unless the whole name is
typed), the notes read lately, the search (unless its archive switch is on), the graph
and the Links panel's picture, the tag counts, the unlinked mentions, `[[##` and `[[^^`,
query fences, the glasses' lists and voice, and the phone's widgets. `[[` offers an
archived note only for its whole name, marked Archived.

Still reachable through a link, which resolves, opens and is drawn faded and dashed; a
bookmark; the way back through a tab; the archive list; and the search's switch.

## The gestures

| where | what |
| --- | --- |
| a row's menu, a selection's menu, a tab's menu, the palette | Archive, or Unarchive |
| a row dragged onto the archive's head | Archive |
| the archive list: a row's end, its menu | Unarchive |
| the strip over an archived note that was opened anyway | Unarchive |

Archiving closes the tabs showing what went, the way Gmail goes back to the inbox. Every
gesture is one entry on the file undo, so the corner says `Archived` or `Unarchived`
with Undo, Ctrl+Z in the list takes it back, and undoing an archive opens the tabs it
closed. Writing stays allowed in an archived note: Bear locks its archive, and that lock
is what its readers complain about.

Taking back one note from inside an archived folder brings back that note alone: the
folder comes back around it and everything else it held stays archived, each on its own
entry. See `toRestore` in `apps/desktop/src/lib/archive-plan.ts`.

## Never deleted

`keepsArchived` in the workspace answers for every deletion, whoever asks: the row menu
says Unarchive where Delete would be, Delete on a selection skips archived rows and says
so in its count, a folder holding something archived refuses with a sheet that offers to
show what is inside, the local endpoint's `files.delete` refuses, and a deletion another
device sends through sync is not carried out for an archived file, which then goes back
up. Renaming or moving an archived row, or a folder above one, carries the entry along.

## Sync

The map rides the space listing as the `archived` column (migration 0041) and is written
whole with `PUT /v1/spaces/:id/archived`, at most 1000 entries. Unlike the other columns
it is met entry by entry on every listing, the later moment winning, so two devices
archiving different notes at once both keep theirs, and a device that raced another's
write sends the difference back up at the next listing. That is the per-entry shape
`docs/sync-v2.md` plans for every map a space keeps. Restores are forgotten after thirty
days. See `apps/desktop/src/lib/workspace/archive-map.ts` and
`services/sync/src/spaces/archived.ts`.

Version history is untouched: archiving writes nothing into the note, so its history
opens from its tab as always, and a version restored into an archived note leaves it
archived.

## Proof

`apps/desktop/test/e2e/archive.py` archives a note and a folder from their rows, undoes
one, opens the archive, brings one note out of an archived folder, is refused deleting a
folder holding archived notes, and searches with and without the switch.
