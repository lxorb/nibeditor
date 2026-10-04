/** Today on the glasses: the open tasks for today and overdue, a box in front of each
 *  (docs/tasks.md 5.18), and a task said aloud.
 *
 *  The list is what Today was when it was put up. A tap ticks a task and fills its box
 *  where it stands, so the row the reader just tapped is still under the cursor and a
 *  mis-tap is a second tap away; what was ticked leaves the list the next time it is
 *  put up. The rows are read and written through the app's own task actions
 *  (task-actions.ts), handed in, so the whole of this is a test. */

import type { Row } from './shell'

/** One task as the list holds it. */
interface Held {
  id: string
  at: string
  space: string
  text: string
  done: boolean
}

/** What the list needs of the app. */
export interface TodayHost {
  /** Today's tasks, as `list_tasks` answers them. */
  load: () => Promise<readonly { at: string; space: string; text: string }[]>
  /** Ticks one, or opens it again; answers whether it was found. */
  tick: (at: string, space: string, done: boolean) => Promise<boolean>
  /** The panel, drawn again. */
  redraw: () => void
}

/** A box, as the firmware's font draws one: `□` open, `■` done. */
const OPEN = '□ '
const DONE = '■ '

export class Today {
  private held: Held[] = []

  constructor(private readonly host: TodayHost) {}

  rows(): Row[] {
    return this.held.map((one) => ({
      label: `${one.done ? DONE : OPEN}${one.text}`,
      depth: 0,
      folder: false,
      open: false,
      pick: true,
      id: one.id,
    }))
  }

  /** Reads Today again, and draws it once it is here. */
  fresh(): void {
    void this.host
      .load()
      .then((tasks) => {
        this.held = tasks.map((one) => ({
          id: `${one.space}\n${one.at}`,
          at: one.at,
          space: one.space,
          text: one.text,
          done: false,
        }))
        this.host.redraw()
      })
      .catch(() => undefined)
  }

  /** Ticks a row at once, and puts it back where the note no longer has the task. */
  tick(id: string): void {
    const one = this.held.find((row) => row.id === id)
    if (!one) return
    one.done = !one.done
    const done = one.done
    void this.host
      .tick(one.at, one.space, done)
      .then((found) => {
        if (found) return
        one.done = !done
        this.host.redraw()
      })
      .catch(() => undefined)
  }
}

/** What follows the word that made an utterance a task, as it was said: "Task, call
 *  Mum tomorrow." is "call Mum tomorrow". The recogniser's capitals are kept, because
 *  a name is a name; its full stop is not, because a task is not a sentence. */
export function spokenTask(said: string): string {
  return said
    .trim()
    .replace(/^\S+[\s,.:;!?-]*/u, '')
    .replace(/[.!?。]+$/u, '')
    .trim()
}
