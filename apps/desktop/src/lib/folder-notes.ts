/** A note that holds notes, which is the only way nib organises anything.
 *
 *  Dropping one note onto another nests it, the way a page nests under a page in
 *  Notion. On disk that is the folder-note convention: `A.md` becomes the folder
 *  `A/` and moves inside it as `A/A.md`, and what was dropped on it lands in `A/`
 *  beside it. The tree then draws the folder as the note again, so the reader
 *  sees one row where they made one gesture.
 *
 *  Same name, inside the folder - not `A.md` left beside `A/`. Both layouts are
 *  the same idea, and both of the folder-note plugins an Obsidian vault is likely
 *  to have offer both: LostPaladin's `folder-notes` and xpgo's `folder-note-core`
 *  each default to looking for `A/A.md` and each has to be told to look outside
 *  the folder instead. So a space nib nested a note in reads as nested in Obsidian
 *  with nothing switched on, which is the point.
 *
 *  Read more widely than written, as everything about somebody else's vault is:
 *  `A/index.md` is the other convention in the wild - the same plugins offer it,
 *  and every site generator there is calls a folder's own page that - so a folder
 *  holding one is drawn as that page too. nib writes the namesake and never the
 *  index, so nothing is converted by being looked at.
 *
 *  A folder with no note of either kind is a folder nib did not make: it comes
 *  from a vault, a clone or Finder. Its row is still the row of a note - the
 *  folder's name, quiet, and the note it would be is written the moment somebody
 *  writes in it. Nothing here writes anything; see docs/tree.md.
 *
 *  Pure, and the whole rule: the tree, the drop zones, the Move sheet, the icon a
 *  row wears and the way back out all ask here. See folder-notes.test.ts. */

import { folderOf, isMarkdownPath, nameOf, withinSpace, withoutExtension } from './space-paths'
import { joinPath } from './tauri'
import { entryAt } from './tree-edits'
import type { Entry } from './workspace.svelte'

/** The other convention's name for a folder's own note, read and never written.
 *  `_index` is the same word with a generator's prefix on it. */
const INDEX = /^_?index$/i

/** The folder a note would become: the note without its extension, so `A.md`
 *  makes `A/`.
 *
 *  Answers a path that is not a note unchanged, which is what makes it safe to
 *  ask about any row: a PDF becomes no folder, and no folder is ever called
 *  `paper.pdf`. */
export function folderFor(note: string): string {
  return withoutExtension(note)
}

/** The note a folder is drawn as, written or not: the folder's own name inside
 *  it.
 *
 *  Asked of a folder that has none, which is where it earns its keep: a row out
 *  of somebody's vault opens the note it would be, and that note is written when
 *  there are words in it and not before. Always `.md`, because that is what nib
 *  writes; a vault of `.markdown` files keeps its own extension on the notes it
 *  already has. */
export function folderNotePath(folder: string): string {
  return joinPath(folder, `${nameOf(folder)}.md`)
}

/** Whether a note is the one its folder is drawn as.
 *
 *  String work, so it can be asked wherever a path is known and no listing is:
 *  `A/A.md` sits in the folder it names, and nothing else does. An `index.md`
 *  answers no, which is what keeps a rename from renaming it and an icon from
 *  being written in two places at once. */
export function isFolderNote(note: string): boolean {
  return isMarkdownPath(note) && nameOf(folderOf(note)) === nameOf(withoutExtension(note))
}

/** The note a folder is drawn as, or null for a folder that holds notes and has
 *  none of its own.
 *
 *  The namesake first, the index after it, so a folder holding both is the note
 *  nib would have written. The name has to match exactly. A vault where `Notes/`
 *  happens to hold `notes.md` is a folder holding a note, and reading it as one
 *  thing because two filesystems disagree about capitals would fold a row
 *  somebody meant to keep. */
export function folderNote(entry: Entry): Entry | null {
  if (!entry.is_dir) return null

  const notes = entry.children.filter((child) => !child.is_dir && isMarkdownPath(child.name))

  return (
    notes.find((child) => withoutExtension(child.name) === entry.name) ??
    notes.find((child) => INDEX.test(withoutExtension(child.name))) ??
    null
  )
}

/** What the tree draws under the row: everything the folder holds except its own
 *  note, which is the row itself. Listing it again would be the same note twice,
 *  once as the row and once inside it. */
export function nestedIn(entry: Entry): Entry[] {
  const own = folderNote(entry)
  return own ? entry.children.filter((child) => child.path !== own.path) : entry.children
}

/** The note a drop is about to make a folder out of, or null when the folder is
 *  already a folder - which is every other drop.
 *
 *  Reads the tree rather than the path, because the answer is about what exists:
 *  a vault may already have `A/` with `A.md` beside it, and then a drop on the
 *  note is an ordinary move into the folder that is there. The note becomes its
 *  folder note by arriving, and nothing has to be made. */
export function noteToNest(tree: Entry | null, folder: string): string | null {
  const here = entryAt(tree, folderOf(folder))
  if (!here || here.children.some((child) => child.is_dir && child.path === folder)) return null

  const note = here.children.find(
    (child) => !child.is_dir && isMarkdownPath(child.name) && folderFor(child.path) === folder,
  )

  return note?.path ?? null
}

/** A folder left holding nothing but its own note, which is a folder that has
 *  stopped being one: the note to bring back up, where it goes, and the folder to
 *  take away.
 *
 *  Automatic, because the way in was: nesting a note was one drag, and a reader
 *  who drags the last row back out has undone it. An empty `A/` left standing
 *  beside `A.md` would be tidying up after a gesture nobody knew they had made.
 *
 *  Only the namesake, which is the only layout nib itself makes. A folder whose
 *  note is an `index.md` came from somewhere else, and taking that layout apart
 *  because a reader moved one note out of it would be nib rearranging a vault it
 *  was only asked to show. */
export function unnesting(entry: Entry): { note: string; into: string; folder: string } | null {
  const own = folderNote(entry)
  if (!own || !isFolderNote(own.path) || entry.children.length > 1) return null

  return { note: own.path, into: folderOf(entry.path), folder: entry.path }
}

/** Renaming the row: the note inside the folder, and then the folder.
 *
 *  In that order, because the note is what the links point at. `workspace.rename`
 *  rewrites them by resolving each against the space as it stands, and they still
 *  resolve to the note while it is where it was; renaming the folder first would
 *  move it out from under them.
 *
 *  The folder alone where the note is not the folder's namesake: an `index.md` is
 *  named after its place rather than after itself, so the name that was typed is
 *  the folder's and the note inside keeps the name its convention gave it.
 *
 *  Nothing at all for a name with nothing in it, which is a field somebody
 *  cleared rather than a rename. */
export function renameSteps(note: string, typed: string): { path: string; name: string }[] {
  const name = withoutExtension(typed.trim())
  if (!name) return []

  const folder = folderOf(note)
  if (!isFolderNote(note)) return [{ path: folder, name }]

  // The note keeps the extension it was written with, so a vault of `.markdown`
  // files stays a vault of `.markdown` files.
  const extension = /\.[^.]+$/.exec(note)?.[0] ?? '.md'

  return [
    { path: note, name: name + extension },
    { path: folder, name },
  ]
}

/** The files links to these rows name, relative to the space: a row that is a folder
 *  is the note it is drawn as, written or not, since that is what opening it opens. A
 *  row outside the space has no link. What a row dropped on a note's words and a
 *  row's Copy link both write; see wikilink/drop.ts in @nib/editor and row-menu.ts. */
export function linkedFiles(tree: Entry | null, root: string, rows: readonly string[]): string[] {
  return rows.flatMap((row) => {
    const entry = entryAt(tree, row)
    const file = entry?.is_dir ? (folderNote(entry)?.path ?? folderNotePath(row)) : row
    const inside = withinSpace(root, file)
    return inside === null ? [] : [inside]
  })
}
