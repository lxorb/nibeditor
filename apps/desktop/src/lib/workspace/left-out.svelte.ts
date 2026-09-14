/** What a space leaves out of what it says about itself: one answer, two sources.
 *
 *  Two things put a note out of the lists. A reader may leave a folder out of the
 *  search by hand, which is Obsidian's "excluded files" and is kept as a list beside
 *  the space; see excluded.svelte.ts. Or a note may be archived, which is a mark inside
 *  the file itself; see ../archived.ts. They are different facts, written in different
 *  places, for different reasons - but every list that shows the space asks the same
 *  question of them: is this one of the notes I am not meant to be showing?
 *
 *  So the question is asked here, once. The alternative was every list learning about
 *  archiving the way it had already learnt about exclusion, which is a second set of
 *  call sites drifting away from the first: the tag counts and the graph would honour
 *  one and not the other, and nobody would notice until the numbers disagreed. A list
 *  that honours this honours both, and whatever the third source turns out to be.
 *
 *  What is left out is not hidden. Every one of these notes still opens from a link, a
 *  bookmark, the archive, or the trail behind a tab, and every one of them still syncs.
 *  They have simply stopped answering questions asked of the space as a whole.
 *
 *  Paths in and out are relative to the space and `/`-separated, and a folder stands
 *  for everything under it - the only pattern a file tree needs, and the same reading
 *  `left_out` in search.rs and `leftOut` in web/search.ts do on their own sides. */

import { relativeTo } from '../space-paths'

/** Whether a path is the one left out, or inside a folder that is. */
function under(path: string, left: string): boolean {
  return path === left || path.startsWith(`${left}/`)
}

/** Where the two sources come from. Functions rather than values, because the
 *  workspace decides which space is open and that changes as spaces are picked - and
 *  because the archived files come out of the link index, which is rebuilt per space.
 *
 *  Handed in rather than imported so this holds no opinion about where either list
 *  lives, and so a test can say what a space leaves out without a workspace, a scan or
 *  a store behind it. */
export interface Sources {
  /** The space whose rows are on screen, or null while there is none. */
  root: () => string | null
  /** The folders and notes a reader left out by hand, as the space speaks of them. */
  chosen: (root: string) => readonly string[]
  /** The files whose own mark says they are archived, as the space speaks of them. */
  archivedFiles: () => readonly string[]
  /** And the folders that have been archived, which have no file to say so. */
  archivedFolders: () => readonly string[]
}

export class LeftOut {
  constructor(private readonly sources: Sources) {}

  /** Everything the space leaves out, for a space that may not be the open one.
   *
   *  The archived halves answer for the open space only, because that is the space the
   *  index has been built for and the only one any list is drawn from. Asking about
   *  another space gets what that space leaves out by hand, which is what it held
   *  before archiving existed. */
  of(root: string): string[] {
    const chosen = this.sources.chosen(root)
    const archived = root === this.sources.root() ? this.archived : []
    if (!archived.length) return [...chosen]

    // Deduped, because a reader may well have left out the folder a note they then
    // archived sits in, and a path said twice is a comparison done twice on every note
    // the search walks. A plain array rather than a set: there are a handful of these,
    // the answer is built and thrown away inside the call, and a reactive set here would
    // be a proxy built per read of a list nothing holds on to.
    return [...chosen, ...archived.filter((one) => !chosen.includes(one))]
  }

  /** What the space being looked at leaves out, as the space speaks of it. */
  get here(): string[] {
    const root = this.sources.root()
    return root === null ? [] : this.of(root)
  }

  /** Everything archived in the open space: the files that say so themselves, and the
   *  folders the space says so for. What the archive is drawn from, and the half of
   *  `here` that is not a reader's own choice. */
  get archived(): string[] {
    return [...this.sources.archivedFiles(), ...this.sources.archivedFolders()]
  }

  /** Whether a path is left out: the path itself, or a folder above it.
   *
   *  Takes a path as the app holds one or as the space speaks it, because the surfaces
   *  that ask disagree: a row in the file list knows where the file is on this disk,
   *  and a search hit or a graph node knows it relative to the space. The same two
   *  readings `links.iconOf` takes. */
  has(path: string): boolean {
    const root = this.sources.root()
    if (root === null) return false

    const held = this.of(root)
    if (!held.length) return false

    const at = relativeTo(root, path)
    return held.some((one) => under(at, one))
  }

  /** Whether a path is archived: the path itself, or an archived folder above it.
   *
   *  Apart from `has` because the two mean different things to the reader. A note left
   *  out by hand may be deleted and offers to be searched again; an archived note may
   *  never be deleted and offers to be taken back. */
  isArchived(path: string): boolean {
    const root = this.sources.root()
    if (root === null) return false

    const archived = this.archived
    if (!archived.length) return false

    const at = relativeTo(root, path)
    return archived.some((one) => under(at, one))
  }

  /** Whether this exact path is the archived one, rather than something inside an
   *  archived folder. What a menu row reads, so it offers to take back only the row
   *  that can be taken back - and what the archive lists, so a folder that was put away
   *  is one row and not one row per note inside it. */
  namesArchived(path: string): boolean {
    const root = this.sources.root()
    if (root === null) return false

    return this.archived.includes(relativeTo(root, path))
  }

  /** Everything archived inside a folder, as the space speaks of it, the folder itself
   *  included.
   *
   *  What the refusal to delete a folder counts, and what the archive is narrowed to
   *  when the reader presses Show them. */
  archivedInside(path: string): string[] {
    const root = this.sources.root()
    if (root === null) return []

    const at = relativeTo(root, path)
    return this.archived.filter((one) => under(one, at))
  }

  /** Whether this row may be deleted at all, and what stands in the way.
   *
   *  An archived note is never deleted: that is the whole of what archiving promises, and
   *  a promise that held everywhere except one forgotten caller is not one. So the answer
   *  is here, beside the question every list already asks, and the deletion itself reads
   *  it - the menus read it too, to say Unarchive where Delete would be, but a caller that
   *  never asked still cannot get past it. See `remove` in workspace.svelte.ts.
   *
   *  A folder above an archived note is refused as well, because deleting it would take
   *  the note with it. `inside` is what the sheet counts. Null means nothing is in the
   *  way, which is the ordinary case.
   *
   *  A note left out by hand is not refused. Leaving a folder out of the search says
   *  nothing about whether its notes are wanted; archiving says they are kept. */
  refusesDeleting(path: string): { itself: boolean; inside: string[] } | null {
    if (this.isArchived(path)) return { itself: true, inside: this.archivedInside(path) }

    const inside = this.archivedInside(path)
    return inside.length ? { itself: false, inside } : null
  }
}
