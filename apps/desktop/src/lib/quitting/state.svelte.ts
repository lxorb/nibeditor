/** The question while it is up: why, which rows, and "Don't ask again". The sheet draws
 *  it (QuitSheet.svelte) and ask.ts puts it up; see there. */

import { shells } from '../terminal/shells.svelte'
import type { Row, Why } from './rows'

/** What the question was answered with: go on, stay, or stay and show this one. */
type Answer = 'go' | 'stay' | Row

class QuitAsk {
  open = $state(false)
  why = $state<Why>('quit')
  rows = $state.raw<Row[]>([])
  /** "Don't ask again", ticked: Settings' Never, once the answer is to go. */
  never = $state(false)

  private pending: ((answer: Answer) => void) | null = null

  /** Puts the question up. A second replaces the first, which stays. */
  ask(why: Why, rows: Row[]): Promise<Answer> {
    this.pending?.('stay')
    this.why = why
    this.rows = rows
    this.never = false
    this.open = true
    return new Promise((resolve) => {
      this.pending = resolve
    })
  }

  answer(answer: Answer) {
    this.open = false
    if (answer === 'go' && this.never) shells.setWarning('never')
    this.pending?.(answer)
    this.pending = null
  }
}

export const quitAsk = new QuitAsk()
