/** Move to space, decided: what moving a tab to another space moves, and which spaces a
 *  tab may be moved to.
 *
 *  Emil, 2026-10-03: *"It should be possible to move a tab to another space (e.g. relevant
 *  for terminal tabs that you can't just close and reopen without losing progress)."*
 *
 *  A tab belongs to the space holding its file, else to the space it was opened in (its
 *  document's `home`); see `ownerOf` in sets.ts. So moving one moves what makes it that
 *  space's:
 *
 *  - **a file in a space** - a note, a `.url`, a plane, a deck of pages, a PDF - moves into
 *    the other space, links and Undo as any move between spaces has them, and its tab
 *    follows. Arc's Move to space carries a pinned tab - the space's saved thing - out of
 *    one sidebar into the other, and Edge's takes the tab out of the workspace it was in;
 *    the saved thing here is the file. Only the tab moving would put a Work note in Home's
 *    tabs while Home's list does not have it, and send it back the next time Work's tabs
 *    are given back to the shared set: a move that does not stick.
 *  - **a tab with no file** - a new note, a terminal, a web tab nobody kept, the graph - is
 *    given the other space as its home: saved there, searched there, a page's web data
 *    that space's, a terminal's last lines kept under it.
 *  - **a file in no space** - the app's own custom.css - and a note somebody shared on its
 *    own have no space to leave, and only the tab moves.
 *
 *  Pure, so the rule is read off lists in space-move.test.ts; moving-space.ts carries it
 *  out. */

import { ownerOf } from './sets'

/** What moving a tab to another space moves along with the tab. */
export type Carried = 'file' | 'home' | 'tab'

export interface Placed {
  id: string
  root: string
}

/** The two things about a tab the rule reads. */
export interface Moving {
  path: string | null
  /** Its document's `home`, for a tab with no file. */
  home: string | null
  /** The note's id on the account, for a note somebody shared on its own. */
  shared: string | null
}

export function carried(tab: Moving, spaces: readonly Placed[]): Carried {
  if (tab.path !== null) return ownerOf(tab.path, null, spaces) === null ? 'tab' : 'file'
  return tab.shared === null ? 'home' : 'tab'
}

/** The space a tab is in as far as a move is concerned: its own, or for a tab that has
 *  none, the space on screen, whose tabs it is among. */
export function spaceOfTab(
  tab: Moving,
  spaces: readonly Placed[],
  active: string | null,
): string | null {
  return ownerOf(tab.path, tab.shared === null ? tab.home : null, spaces) ?? active
}

/** A tab as the rule reads it. */
export function movingOf(tab: {
  path: string | null
  note: { home: string | null; shared: string | null }
}): Moving {
  return { path: tab.path, home: tab.note.home, shared: tab.note.shared }
}

/** The spaces these tabs can be moved to, in the switcher's order: every space but the
 *  one they are all in already, and none that may not be written in. Nothing where a
 *  file of theirs sits in a space it may not be taken out of, or with nowhere else to
 *  go. `writable` answers for a path, a space's root among them; see sharing.svelte.ts. */
export function spacesFor<Space extends Placed>(
  tabs: readonly Moving[],
  where: { spaces: readonly Space[]; activeSpaceId: string | null },
  writable: (path: string) => boolean,
): Space[] {
  const { spaces } = where
  if (!tabs.length || spaces.length < 2) return []
  const files = tabs.filter((tab) => carried(tab, spaces) === 'file')
  if (files.some((tab) => tab.path !== null && !writable(tab.path))) return []

  const from = new Set(tabs.map((tab) => spaceOfTab(tab, spaces, where.activeSpaceId)))
  const already = from.size === 1 ? [...from][0] : undefined
  return spaces.filter((one) => one.id !== already && writable(one.root))
}
