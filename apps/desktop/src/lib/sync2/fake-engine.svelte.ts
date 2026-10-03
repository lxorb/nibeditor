/** A v2 engine that holds whatever notes it is handed and does as it is told, for the
 *  tests of the question and for the drives that photograph it.
 *
 *  The real one (the engine's lib/sync2/held.ts) meets the same interface -
 *  `Engine` in asking.svelte.ts, which is section 13.1 of docs/sync-v2.md - so what is
 *  proved against this is what the app does once that one is connected instead. A
 *  drive reaches it as `window.nibApp.sync2`; see App.svelte. */

import {
  asking,
  type Engine,
  type EngineEvents,
  type Held,
  type HeldAnswer,
  type HeldNotes,
} from './asking.svelte'
import type { Answers, LogRow, Query, SpaceRow } from './store'

class FakeHeld implements HeldNotes {
  notes = $state<Held[]>([])
  /** Every answer given, in order. */
  answered: [string, HeldAnswer][] = []
  /** What the next answer throws, once. */
  failing: Error | null = null

  /** Keep both makes `Name (Device).md` beside the note, as the engine does. */
  answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    this.answered.push([id, answer])
    const failing = this.failing
    this.failing = null
    if (failing) return Promise.reject(failing)

    const note = this.notes.find((one) => one.id === id)
    this.notes = this.notes.filter((one) => one.id !== id)
    if (answer !== 'both' || !note) return Promise.resolve(undefined)

    return Promise.resolve(note.path.replace(/(\.[^.\\/]+)?$/, ` (${note.mine.device})$1`))
  }
}

type Listeners = { [T in keyof EngineEvents]: ((event: EngineEvents[T]) => void)[] }

class FakeEngine implements Engine {
  readonly held = new FakeHeld()
  log: LogRow[] = []
  spaces: SpaceRow[] = []

  private readonly listeners: Listeners = { resurrected: [], pass: [] }

  readonly store = {
    // Only the two tables the Sync pane reads; any other question finds nothing.
    read: <const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>> =>
      Promise.resolve(
        // Each answer is the one its question asks for, which is what `Answers<Q>` says.
        queries.map((query) => {
          if (query.t === 'get') return null
          if (query.table === 'log') return this.log
          return query.table === 'spaces' ? this.spaces : []
        }) as Answers<Q>,
      ),
  }

  on<T extends keyof EngineEvents>(
    type: T,
    listener: (event: EngineEvents[T]) => void,
  ): () => void {
    const listening: ((event: EngineEvents[T]) => void)[] = this.listeners[type]
    listening.push(listener)
    return () => {
      const at = listening.indexOf(listener)
      if (at >= 0) listening.splice(at, 1)
    }
  }

  /** Says something the real engine would. A pass is written to the log first. */
  emit<T extends keyof EngineEvents>(type: T, event: EngineEvents[T]) {
    if (type === 'pass') this.log = [...this.log, event as LogRow]
    const listening: ((event: EngineEvents[T]) => void)[] = this.listeners[type]
    for (const listener of [...listening]) listener(event)
  }
}

/** A fake engine with these notes held, connected; `stop` lets go of it. */
export function connectFake(notes: Held[] = []): { engine: FakeEngine; stop: () => void } {
  const engine = new FakeEngine()
  engine.held.notes = notes
  return { engine, stop: asking.connect(engine) }
}
