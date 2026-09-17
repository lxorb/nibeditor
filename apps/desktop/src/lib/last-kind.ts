/** Which kind of tab was made last, and the step between them.
 *
 *  Emil, 2026-09-17: *"The last chosen one should be selected already."* So the
 *  keyboard lands on the kind that was chosen last, and every way in agrees about
 *  which that is - the plus, Ctrl+T, the File menu, the buttons a pane with nothing
 *  open draws - because the maker writes it down rather than each door. See
 *  new-kinds.ts.
 *
 *  Per device, and so localStorage rather than the account's settings: what somebody
 *  reaches for is a habit of the keyboard in front of them, and a laptop that started
 *  opening canvases because a desktop had been drawing on one is a chooser that
 *  changed under a hand which never asked it to.
 *
 *  Its own module, and light, because the two sides that want it do not want each
 *  other: new-kinds.ts is the list and everything a row of it can do, and the chord
 *  is read by the window before anything is drawn. See test/weight.test.ts. */

import { keep, storedText } from './stored'
import type { NewKind } from './workspace.svelte'

const KEY = 'nib:new-kind'

export function rememberKind(kind: NewKind): void {
  keep(KEY, kind)
}

/** Where the chooser opens, as a place in the kinds it is showing. The first of them
 *  until something has been chosen, and where what was chosen is not on offer here: a
 *  phone leaves the website out, so a machine that made one on a desktop is not a
 *  phone that can. Compared as a word rather than read as a `NewKind`, because storage
 *  was written by some version of this app and may name a kind this one has never
 *  heard of. */
export function standingAt(kinds: readonly NewKind[]): number {
  const last = storedText(KEY)
  const at = kinds.findIndex((one) => one === last)

  return at < 0 ? 0 : at
}

/** One along, wrapping. `by` is signed because Shift steps back, and is more than one
 *  where presses arrived before the chooser was drawn to take them. Twice round the
 *  count, so a step back from the first lands on the last rather than on nothing. */
export function stepAt(at: number, count: number, by = 1): number {
  if (count <= 0) return 0

  return (((at + by) % count) + count) % count
}
