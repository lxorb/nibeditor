/** Where a row of the file list can be moved to.
 *
 *  On a touch screen a drag is not available: a press that stays still opens the
 *  row's menu, a press that moves scrolls the list, and the browser's drag events
 *  do not fire from a finger at all. So the menu offers the move instead, and
 *  this works out what it offers.
 *
 *  The list is exactly where a mouse could drop the thing, no more: every note of
 *  the space it is in, since a note dropped on a note nests; the space itself,
 *  which is what dropping onto the empty room under the last row means; and any
 *  other space there is, which is what carrying a note onto another space used to
 *  mean. No folders, because nib has none to offer - a folder out of somebody's
 *  vault is a note that has not been written yet and is offered as that row; see
 *  folder-notes.ts and docs/tree.md. Its own place is left out, because a move to
 *  where it already is is not a move, and so is anything inside a row being
 *  moved, because nothing can be put into itself.
 *
 *  Pure, so the rule can be read as a list of paths rather than driven through a
 *  sheet; see move-targets.test.ts. */

import { folderFor, folderNote } from './folder-notes'
import { folderOf, isMarkdownPath, relativeTo } from './space-paths'
import type { Entry } from './workspace.svelte'

export interface MoveTarget {
  /** The folder to move into. For a note that is the folder it is about to
   *  become; the move itself makes it, so nothing here has to know that. */
  id: string
  /** What it is called in the list: where it sits, said as shortly as it can be. */
  label: string
  /** What the row wears. Every row in the space is a note, and where the note at
   *  that path chose an icon it is that instead - the sheet reads it off the `id`;
   *  see FileMark.svelte. */
  mark?: 'note'
  /** The space this row is, for the two rows that are one: the space being looked
   *  at, and any other. It wears the switcher's own mark rather than a note's. */
  space?: { id: string | null; name: string }
}

export interface Space {
  id: string
  name: string
  root: string
}

/** Whether `path` is `folder` or sits anywhere inside it. */
function under(folder: string, path: string): boolean {
  const one = folder.replace(/\\/g, '/').replace(/\/+$/, '')
  const other = path.replace(/\\/g, '/')
  return other === one || other.startsWith(`${one}/`)
}

/** Whether moving these rows into `folder` would move anything at all.
 *
 *  The same rule the list below is filtered by, asked the other way round: the
 *  menu names a row and asks which places will take it, while a drag names a
 *  place and asks whether it takes what is coming. So nothing can be dropped
 *  into itself or into anything inside it, and a row already there is not
 *  moving.
 *
 *  A drag over the file list cannot read the transfer - a browser hides what is
 *  being dragged until the drop - so what is coming is this window's own note of
 *  it; see `carried` in drag-paths.ts. */
export function movesInto(paths: readonly string[], folder: string): boolean {
  return paths.some((path) => folderOf(path) !== folder && !under(path, folder))
}

/** One place a row can land: the folder it moves into, and what that folder is
 *  called. */
interface Place {
  path: string
  name: string
  /** The note this place is made out of, for a note that has no folder yet, so a
   *  note is not offered its own folder to move into. Null for a folder that is
   *  already there. */
  note: string | null
}

/** Every place in the tree, the space first and then depth first, which is the
 *  order the file list itself draws them in.
 *
 *  One place per row of the list and no others: a folder that holds its own note
 *  is the row of that note, so the note inside it is not offered again - moving
 *  into it would mean `A/A/` and there is no such thing - and a folder with no
 *  note is the row it is, which is offered as itself. */
function placesIn(entry: Entry): Place[] {
  const own = folderNote(entry)
  const out: Place[] = [{ path: entry.path, name: entry.name, note: null }]

  // A folder wins over the note that shares its name: it already exists, so a
  // drop into it is an ordinary move rather than a nesting, and offering both
  // would be one folder twice.
  const folders = new Set(entry.children.filter((child) => child.is_dir).map((one) => one.path))

  for (const child of entry.children) {
    if (child.path === own?.path) continue

    if (child.is_dir) out.push(...placesIn(child))
    else if (isMarkdownPath(child.name) && !folders.has(folderFor(child.path))) {
      out.push({ path: folderFor(child.path), name: child.name, note: child.path })
    }
  }

  return out
}

export function moveTargets(input: {
  /** The note or folder being moved, or null where nothing is: a save asks where a file
   *  it is about to make could go, and a file that does not exist yet is in nobody's
   *  way. Null offers every place there is; a path leaves out its own and anything
   *  inside it. */
  moving: string | null
  /** The space on screen, as the file list holds it. */
  tree: Entry | null
  /** Every space there is, in the order the switcher shows them. */
  spaces: readonly Space[]
  /** Which of them is on screen. */
  here: string | null
}): MoveTarget[] {
  const { moving, tree, spaces, here } = input
  const space = spaces.find((one) => one.root === here) ?? null

  const inside: MoveTarget[] = !tree
    ? []
    : placesIn(tree)
        // Where it already is, itself, and anything inside it - and, for a note,
        // the folder it would itself become, since a note cannot hold itself. Nothing
        // is left out where nothing is moving.
        .filter(
          (place) => moving === null || (place.note !== moving && movesInto([moving], place.path)),
        )
        .map((place) =>
          place.path === tree.path
            ? // The space itself, which is where the row sits when it sits in no
              // note at all. Its own name and its own mark.
              {
                id: place.path,
                label: space?.name ?? place.name,
                space: { id: space?.id ?? null, name: space?.name ?? place.name },
              }
            : {
                id: place.path,
                mark: 'note' as const,
                // The path inside the space: a note three deep is only itself if
                // the way to it is shown. A note's place is the folder it would
                // become, so the ending is already off it; see `folderFor`.
                label: relativeTo(tree.path, place.path),
              },
        )

  // The other spaces, which is the only way a note moves between two of them.
  const elsewhere: MoveTarget[] = spaces
    .filter((one) => one.root !== here)
    .map((one) => ({ id: one.root, label: one.name, space: { id: one.id, name: one.name } }))

  return [...inside, ...elsewhere]
}
