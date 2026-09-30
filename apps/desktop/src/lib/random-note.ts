/** A note of the space nobody chose: Obsidian's Random note, for coming across what
 *  a space already holds rather than only what was written this week.
 *
 *  Any of the space's notes except three kinds. The note already open, because the
 *  command is pressed to go somewhere, and landing where one stands reads as the
 *  press doing nothing. And what the space leaves out of everything it says about
 *  itself - the notes a reader excluded and the ones it archived - which the search,
 *  the graph and the file list already leave out; see `leftOutOf` in the workspace.
 *  Notes only: a PDF, a plane and a web shortcut are files beside the notes. */

import { isMarkdownPath } from './space-paths'
import { workspace } from './workspace.svelte'

/** One of `choices`, evenly, or null when there is none to choose. `roll` is a
 *  number in [0, 1), which is `Math.random` everywhere but a test. */
export function pickOne<T>(choices: readonly T[], roll: number): T | null {
  if (!choices.length) return null
  return choices[Math.min(Math.floor(roll * choices.length), choices.length - 1)] ?? null
}

/** The notes a random one may be, as the paths the workspace opens. */
export function randomChoices(): string[] {
  const open = workspace.active?.path
  return workspace.notes
    .map((one) => one.path)
    .filter(
      (path) =>
        path !== open &&
        isMarkdownPath(path) &&
        !workspace.excluded.has(path) &&
        !workspace.archive.has(path),
    )
}

/** Opens one of them, the way a note chosen in the palette opens. */
export function openRandomNote(roll: number = Math.random()): void {
  const path = pickOne(randomChoices(), roll)
  if (path !== null) void workspace.open(path)
}
