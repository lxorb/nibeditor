/** Reminders the page rings itself, while it runs: where nothing on the device would ring
 *  them with nib closed (Linux, the browser build, an iPhone for now), or where the
 *  system refused the plan (docs/tasks.md 5.10).
 *
 *  A timer each, for the ones inside the next three weeks (a timer cannot wait longer;
 *  the scheduler plans again long before then). A reminder rings once in a run: a plan
 *  handed again a moment after it rang does not ring it a second time, and one whose
 *  moment has passed is never handed over at all. */

import type { Reminder } from './plan'

/** The longest a timer is asked to wait. */
const HORIZON = 21 * 86_400_000

export interface Bell {
  now(): number
  /** Shows one reminder. */
  show(one: Reminder): void
  later(run: () => void, ms: number): () => void
}

export class Ringer {
  private readonly waiting = new Map<string, () => void>()
  private readonly rung = new Set<string>()

  constructor(private readonly bell: Bell) {}

  /** Rings exactly this plan from now on. */
  ring(plan: readonly Reminder[]) {
    for (const stop of this.waiting.values()) stop()
    this.waiting.clear()

    const now = this.bell.now()
    for (const one of plan) {
      const wait = one.at - now
      if (this.rung.has(one.id) || wait > HORIZON) continue
      this.waiting.set(
        one.id,
        this.bell.later(
          () => {
            this.waiting.delete(one.id)
            this.rung.add(one.id)
            this.bell.show(one)
          },
          Math.max(wait, 0),
        ),
      )
    }
  }
}
