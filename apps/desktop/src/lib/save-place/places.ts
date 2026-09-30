/** Where Save offers to put a tab, and which of those it starts on.
 *
 *  The places are the Move sheet's, every one of them: the space on screen, each note
 *  in it as the folder it would become, and every other space - so a tab is saved
 *  anywhere a note could be moved to, and the list reads the same in both. It starts on
 *  the root of the space the tab was opened in, which is where a new note has always
 *  gone; see `draftHome` in workspace.svelte.ts. Pure. */

import { type MoveTarget, moveTargets, type Space } from '../move-targets'
import { nameFromTitle } from '../note-name'
import { samePath } from '../space-paths'
import type { Entry } from '../workspace.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'
import { fileNamed, offeredName } from '../workspace/drafts'

/** The file a name typed into Save comes to: what a filesystem takes of it, under the
 *  kind's ending, or the name offered where nothing of it is left. */
export function fileFor(typed: string, note: NoteDoc, title?: string): string {
  return fileNamed(nameFromTitle(typed) ?? offeredName(note, title), note.kind)
}

export function placesFor(
  tree: Entry | null,
  spaces: readonly Space[],
  here: string | null,
): MoveTarget[] {
  return moveTargets({ moving: null, tree, spaces, here })
}

/** The place Save starts on: `home`, the root of the tab's own space, where it is one
 *  of them, else the first - the space on screen. */
export function startingPlace(
  places: readonly MoveTarget[],
  home: string | null,
): MoveTarget | null {
  return places.find((one) => home !== null && samePath(one.id, home)) ?? places[0] ?? null
}
