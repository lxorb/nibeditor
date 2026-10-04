/** The reminders store: the plan kept in step with the rows, and handed on.
 *
 *  It listens to the rows (`rows.watch`) and to nothing else, and whenever they settle it
 *  plans again and hands the platform the whole plan, which the platform makes so: it
 *  adds what is new and takes away what is gone, by id (docs/tasks.md 5.10). A task moved
 *  is a new id at the new minute and the old one gone; one ticked or deleted is gone; a
 *  recurring one ticked is its next line, with its own reminder. Nothing is handed until
 *  every space has been read, because a plan made from half the spaces would take the
 *  other half's reminders off the system.
 *
 *  The platform says whether it rings with nib closed. Where it does not (Linux, the
 *  browser, a phone without the activity) the page rings them itself while it runs.
 *  Plain rather than reactive, with its links to the app as a `Host`, so it is tested
 *  without one; see start.svelte.ts for the app's. */

import type { Row } from '@nib/bases'
import { plan, type Reminder, samePlan } from './plan'

/** How long the rows have to be still before planning again: a save is several
 *  changes in a row, and a space read is hundreds. */
export const QUIET = 400

/** The longest the plan waits before it is made again whatever happens: the day turns,
 *  a laptop wakes, and the window of the next 64 moves along. */
const AT_MOST = 6 * 3_600_000

export interface Host {
  rows(): readonly Row[]
  /** Whether every space has been read. */
  ready(): boolean
  /** Hears each change of the rows; answers how to stop. */
  watch(listener: () => void): () => void
  /** The automatic reminder's minutes before a task's time, or null when it is off. */
  auto(): number | null
  now(): number
  /** Hands the whole plan to whatever rings with nib closed. Answers whether anything
   *  does: false is the page's to ring. */
  hand(plan: readonly Reminder[]): Promise<boolean>
  /** Rings a plan in the page, while it runs: what the system will not. */
  ring(plan: readonly Reminder[]): void
  /** Says whether any reminder is waiting, for the tray. */
  waiting(any: boolean): void
  /** Runs once after a wait; answers how to call it off. */
  later(run: () => void, ms: number): () => void
}

export class Scheduler {
  /** What was last handed, so the same plan is not handed twice. */
  private handed: Reminder[] | null = null
  private pending: (() => void) | null = null
  private next: (() => void) | null = null
  private passing: Promise<void> | null = null
  private again = false

  constructor(private readonly host: Host) {}

  /** Listens from now on, and plans as soon as the rows are whole. Answers the stop. */
  start(): () => void {
    const stop = this.host.watch(() => this.changed())
    this.changed()
    return () => {
      stop()
      this.pending?.()
      this.next?.()
    }
  }

  /** Something the plan is made from changed: the rows, or the automatic reminder. */
  changed() {
    this.pending?.()
    this.pending = this.host.later(() => {
      this.pending = null
      void this.pass()
    }, QUIET)
  }

  /** The plan made now and handed on if it differs from the last; one at a time, the
   *  last change asked for winning. */
  async pass(): Promise<void> {
    if (this.passing) {
      this.again = true
      return this.passing
    }
    this.passing = this.run().finally(() => {
      this.passing = null
    })
    await this.passing
    if (this.again) {
      this.again = false
      await this.pass()
    }
  }

  private async run() {
    if (!this.host.ready()) return

    const now = this.host.now()
    const wanted = plan(this.host.rows(), now, this.host.auto())
    this.host.waiting(wanted.length > 0)
    this.wake(wanted, now)
    if (this.handed && samePlan(this.handed, wanted)) return

    this.handed = wanted
    const system = await this.host.hand(wanted).catch(() => false)
    this.host.ring(system ? [] : wanted)
  }

  /** Plans again just after the first reminder passes, so the next one moves into the
   *  window, and at least every few hours. */
  private wake(wanted: readonly Reminder[], now: number) {
    this.next?.()
    const first = wanted[0]
    const wait = first ? Math.min(Math.max(first.at - now + 1000, 1000), AT_MOST) : AT_MOST
    this.next = this.host.later(() => {
      this.next = null
      void this.pass()
    }, wait)
  }
}
