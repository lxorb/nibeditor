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

  /** The same two as plain fields, which is what every method here reads.
   *
   *  `want` is called from a card's `$effect`, and a reactive read inside an effect is
   *  a dependency: a `want` that read `current` made the card's effect depend on the
   *  hint on screen, so putting one up ran the effect again, whose teardown took the
   *  card straight back down with the session's one hint spent. Read from these, the
   *  store decides without being something the caller can depend on; see
   *  said.svelte.ts and docs/conventions.md. */
  private put: Hint[] = []
  private showing: Hint | null = null

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
    this.show(null)
    this.wanted.clear()
    const list = stringList(stored(KEY)) ?? []
    this.put = HINTS.filter((one) => list.includes(one))
    this.seen = this.put
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

    if (!yes && this.showing === hint) this.show(null)
    else this.pick()
  }

  /** Put away for good: its cross, or the control it points at was used. */
  dismiss(hint: Hint) {
    if (this.showing === hint) this.show(null)
    if (this.put.includes(hint)) return

    this.put = [...this.put, hint]
    this.seen = this.put
    keep(KEY, JSON.stringify(this.put))
  }

  private pick() {
    if (!this.settled || this.spent || this.showing !== null || modes.silent) return

    const next = HINTS.find((one) => this.wanted.has(one) && !this.put.includes(one))
    if (!next) return

    this.show(next)
    this.spent = true
  }

  private show(hint: Hint | null) {
    this.showing = hint
    this.current = hint
  }
}

export const hints = new Hints()
