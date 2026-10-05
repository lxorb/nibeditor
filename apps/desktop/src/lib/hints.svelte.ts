/** The few hints that point somebody at a feature they have not found yet.
 *
 *  Google Docs' and Notion's callouts: a small card beside the control it is about,
 *  once, gone for good with its cross or the moment the control is used. At most one
 *  a session, and not in the first seconds of one, so a launch is still a launch and
 *  the app never stacks three cards on top of the note somebody opened it for.
 *
 *  Silent mode in Settings > General turns every one of them off, for somebody who
 *  knows the app and wants it clean; see `modes.silent`. Off out of the box, because
 *  the people who need a hint are the ones who would never go looking for the switch.
 *
 *  Which hints have been seen is this device's, kept under `nib:hints`: a hint dismissed
 *  on a desktop is about where the control sits on that desktop.
 *
 *  Nothing a launch draws needs any of this, so every caller fetches it through a door
 *  (an `import()`), the cards included, and the launch's module budget stays where it
 *  was; see test/weight.test.ts. */

import { modes } from './modes.svelte'
import { keep, stored, stringList } from './stored'

/** Every hint there is, by the control it is about, first the one that matters most:
 *  a session's one hint is the first of these whose control wants it. */
export const HINTS = ['sign-in', 'graph', 'palette'] as const
export type Hint = (typeof HINTS)[number]

const KEY = 'nib:hints'

class Hints {
  /** The hints this device has put away. */
  seen = $state<Hint[]>([])

  /** The one on screen, or null. */
  current = $state<Hint | null>(null)

  /** The hints whose control is on screen and would make sense of one now. */
  private wanted = new Set<Hint>()

  /** Whether the session has run long enough; see start.ts. */
  private settled = false

  /** Whether this session has shown one already, which is its whole allowance. */
  private spent = false

  constructor() {
    this.restore()
  }

  restore() {
    this.settled = false
    this.spent = false
    this.current = null
    this.wanted.clear()
    const list = stringList(stored(KEY)) ?? []
    this.seen = HINTS.filter((one) => list.includes(one))
  }

  /** The session has settled: the first hint wanted, if any, goes up. */
  settle() {
    this.settled = true
    this.pick()
  }

  /** Said by a hint's control each time whether it would make sense of the hint. */
  want(hint: Hint, yes: boolean) {
    if (yes) this.wanted.add(hint)
    else this.wanted.delete(hint)

    if (!yes && this.current === hint) this.current = null
    else this.pick()
  }

  /** Put away for good: its cross, or the control it points at was used. */
  dismiss(hint: Hint) {
    if (this.current === hint) this.current = null
    if (this.seen.includes(hint)) return

    this.seen = [...this.seen, hint]
    keep(KEY, JSON.stringify(this.seen))
  }

  private pick() {
    if (!this.settled || this.spent || this.current !== null || modes.silent) return

    const next = HINTS.find((one) => this.wanted.has(one) && !this.seen.includes(one))
    if (!next) return

    this.current = next
    this.spent = true
  }
}

export const hints = new Hints()
