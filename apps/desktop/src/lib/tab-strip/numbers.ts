/** Which number each tab wears while Alt is held, and when Alt counts as held.
 *
 *  Emil, 2026-09-30: *"while holding alt it should (in a 'dezent' way) also show the
 *  numbers for the different tabs, but not too much overlaying with what the tabs
 *  are."* The numbers are the Alt and a digit keys (see `ALT_NUMBERED` in
 *  shortcuts/registry.ts), read off the registry as they are bound now, so a number is
 *  never one the key does not keep. Pure; numbers.svelte.ts is what shows them. */

import { parseCombination, type Platform } from '../keys'

/** How long Alt has to be held on its own before the numbers come.
 *
 *  Emil, 2026-10-01: *"it currently takes an eternity till I see the numbers when I press
 *  alt."* It was the app's line between a tap and a hold, 350 ms, and a fade after it:
 *  half a second from the key to the numbers. Office's KeyTips come on the press itself,
 *  and a wait a hand notices is one past a tenth of a second or two. A seventh of a second
 *  is under that, and still longer than the gap between Alt and the digit of a practiced
 *  Alt+3, so the numbers never flash at it. */
export const HOLD_MS = 150

/** The keys, and the place along the strip each goes to. Eight places, the ninth, and
 *  the last, which Alt+0 goes to. */
const PLACES: readonly (readonly [string, number | 'last'])[] = [
  ...Array.from({ length: 8 }, (_, at) => [`app.note-${at + 1}.alt`, at] as const),
  ['app.note-ninth', 8],
  ['app.note-9.alt', 'last'],
]

/** What a key bound under Alt alone is called on a tab: its one character. Nothing for a
 *  key held with anything else, or a key that is not a character. */
function underAlt(key: string | null, platform: Platform): string | null {
  const combination = key === null ? null : parseCombination(key, platform)
  if (!combination?.alt || combination.ctrl || combination.meta || combination.shift) return null
  return combination.key.length === 1 ? combination.key.toUpperCase() : null
}

/** The number each of a strip's `count` tabs wears, in its order, or null for a tab no
 *  key reaches. The first eight wear their places and the ninth its own, since Alt+9
 *  goes to the ninth; the last tab wears the key that always means the last - 0 - even
 *  where its place has a number too, because that is the one worth learning. Pinned
 *  tabs count, as the keys count them. */
export function numerals(
  count: number,
  keyFor: (id: string) => string | null,
  platform: Platform,
): (string | null)[] {
  const worn: (string | null)[] = Array.from({ length: count }, () => null)

  for (const [id, place] of PLACES) {
    const said = underAlt(keyFor(id), platform)
    const at = place === 'last' ? count - 1 : place
    if (said !== null && at >= 0 && at < count) worn[at] = said
  }

  return worn
}

/** A key as the hold reads it. */
export interface Stroke {
  key: string
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
  /** AltGr, which some keyboards name apart from Ctrl and Alt. */
  altGraph: boolean
}

/** Whether Alt is being held on its own.
 *
 *  Alt alone starts it. AltGr never does - a German or Swiss keyboard types `@`, `[` and
 *  `{` with it, and Windows says it as Ctrl and Alt - and nor does Alt with Shift, which
 *  is the system's switch between keyboards. Any other key ends it, which is what makes
 *  a quick Alt+3 never show a number and Alt+Tab never leave any behind; so does a press
 *  of the pointer, the wheel, a key let go of and the window losing the keyboard, which
 *  the caller says with `broken`. A held Alt repeats, and a repeat is the same hold -
 *  flagged as one or not, since an engine that did not flag it would otherwise start the
 *  clock again on every repeat, and the numbers would wait for a hand that is not going
 *  to stop repeating. */
export class AltHold {
  holding = false

  /** A key went down. Answers whether it began a hold, which is when the clock starts. */
  down(stroke: Stroke): boolean {
    if (stroke.key === 'Alt' && (stroke.repeat || this.holding)) return false

    this.holding =
      stroke.key === 'Alt' &&
      !stroke.ctrlKey &&
      !stroke.shiftKey &&
      !stroke.metaKey &&
      !stroke.altGraph
    return this.holding
  }

  broken(): void {
    this.holding = false
  }
}
