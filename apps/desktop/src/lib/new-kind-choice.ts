/** Which kind the new-tab dialog stands on, and the steps between them.
 *
 *  Emil, 2026-09-27: *"Ctrl + T should always open a webpage by default. And that
 *  should always be the selected option in the modal when holding the Ctrl."* So the
 *  dialog opens on the website every time, which is what Ctrl+T makes in every
 *  browser there is, and a tap of the chord makes one with nothing drawn at all.
 *
 *  It used to open on whatever was chosen last, and that memory is gone rather than
 *  kept for the plus: a menu hung at the pointer is chosen with the pointer, and a ring
 *  on a row the hand is not near was one more thing that moved on its own. Every door
 *  now opens on a place that never changes - the website here, the first row
 *  everywhere else.
 *
 *  Pure and light, because the chord that reads it is fetched at the launch's last
 *  turn and the dialog that draws it after that; see new-kind-chord.ts. */

import type { NewKind } from './workspace.svelte'

/** Where the dialog opens, as a place in the kinds it is showing: the website, and a
 *  note where there is no website to make. A phone leaves the website out - it is a
 *  bookmark there, opened in the phone's own browser - and a note is what a new tab
 *  was before there was any choice at all. */
export function firstChoice(kinds: readonly NewKind[]): number {
  const web = kinds.indexOf('web')
  if (web >= 0) return web

  return Math.max(kinds.indexOf('note'), 0)
}

/** One along, wrapping. `by` is signed because Shift and the arrows back step back.
 *  Twice round the count, so a step back from the first lands on the last rather than
 *  on nothing. */
export function stepAt(at: number, count: number, by = 1): number {
  if (count <= 0) return 0

  return (((at + by) % count) + count) % count
}

/** The kind a letter picks, as a place in the kinds, or -1 for a letter that picks
 *  none. Compared without case, because Shift is not part of the name. */
export function letterAt(letters: readonly string[], key: string): number {
  if (key.length !== 1) return -1

  return letters.indexOf(key.toLowerCase())
}
