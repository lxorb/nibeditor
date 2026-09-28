/** The commands run from the palette lately, so the ones somebody reaches for
 *  are at the top of the list the next time: VS Code's "recently used". This
 *  machine's, like the notes opened lately, because it is a habit of whoever is
 *  at the keyboard rather than a fact about a space. */

import { keep, stored, stringList } from '../stored'

const KEY = 'nib:palette-used'

/** Enough to be the first screen of the list, not so many that it becomes the list. */
const MOST = 8

/** The list with `id` put at the front, once. */
export function withUse(used: readonly string[], id: string, most = MOST): string[] {
  return [id, ...used.filter((one) => one !== id)].slice(0, most)
}

/** Most recent first. */
export function usedCommands(): string[] {
  return stringList(stored(KEY)) ?? []
}

export function useCommand(id: string): void {
  keep(KEY, JSON.stringify(withUse(usedCommands(), id)))
}
