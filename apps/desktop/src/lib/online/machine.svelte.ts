/** The account's online machine, as this window knows it: its state, the month's use and
 *  when that starts again (docs/online-terminal.md 4.4, 4.9).
 *
 *  Asked of the account when Settings opens and when a terminal of it goes live, and told
 *  by every terminal's socket as the machine changes - so the dot on a tab and the line in
 *  Settings agree without either polling. Fetched with the first online terminal or the
 *  Settings pane, never at launch. */

import { type MachineState, near } from '@nib/online'
import { type Online, online, refusedOf, type Refused, startStop } from './calls'

class OnlineMachine {
  /** What the account last said, or null before it has. */
  known = $state<Online | null>(null)
  /** Why the last question was refused, or null. */
  refused = $state<Refused | null>(null)
  busy = $state(false)

  /** Whether the month's hours are nearly used: the amber a tab's mark wears. */
  get near(): boolean {
    return this.known !== null && near(this.known.used, this.known.limit)
  }

  /** Asks the account again. */
  async refresh(): Promise<void> {
    try {
      this.known = await online()
      this.refused = null
    } catch (error) {
      this.refused = refusedOf(error)
    }
  }

  /** What a terminal's socket said about the machine. */
  heard(state: MachineState) {
    const machine = this.known?.machine
    if (machine && machine.state !== state) machine.state = state
  }

  async startStop(start: boolean): Promise<void> {
    this.busy = true
    try {
      await startStop(start)
      this.refused = null
    } catch (error) {
      this.refused = refusedOf(error)
    } finally {
      this.busy = false
    }
    await this.refresh()
  }
}

export const machine = new OnlineMachine()
