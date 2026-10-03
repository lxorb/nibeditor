/** The page's side of the search worker.
 *
 *  One worker, kept: starting one costs a module graph being compiled, and a
 *  reader typing a word would otherwise pay for it per keystroke. A search
 *  already running is not stopped when the next one is asked - it is answering
 *  about a word nobody is looking for any more, and its answers are dropped by
 *  their id - because there is nothing to gain by tearing the walk down that
 *  finishing it does not give sooner.
 *
 *  The worker also holds the space between two searches, which is what `warm`
 *  below sets going: see space-cache.ts for what is held and warm.svelte.ts for
 *  who asks. */

import type { Found } from './search'
import { type Answer, type Ask, isAnswer, type Warm } from './search-protocol'
import type { Warmth } from '../search/warmth'
import type { Query } from '../search/query'

let worker: Worker | null = null

/** Which search each waiting caller is, so an answer reaches the one that asked
 *  for it and nothing else. */
const waiting = new Map<number, { onFound: (found: Found) => void; done: () => void }>()

let asked = 0

/** Who to tell what the worker is holding. One listener: it is the diagnostics
 *  the panel carries, and there is one panel. */
let told: ((warmth: Warmth) => void) | null = null

/** Hears what the worker is holding, whenever it changes. */
export function whenWarmer(heard: (warmth: Warmth) => void): void {
  told = heard
}

/** Asks the worker to read the space and keep it. Opening the worker here is
 *  half the point: the module graph is compiled while nobody is typing. */
export function warmSpace(root: string): void {
  open()?.postMessage({ kind: 'warm', root } satisfies Warm)
}

/** The worker, started if it is not running - or nothing, where the page will not
 *  start one: no `Worker` at all, or one refused. That is a worker that fell over
 *  before it began, and is taken the same way: nothing held, no answer to this
 *  word, and the next question tries again. Nobody awaits the warming, so a throw
 *  here would be a rejection nobody hears. */
function open(): Worker | null {
  if (worker) return worker

  let made: Worker
  try {
    made = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  made.onmessage = (event: MessageEvent<unknown>) => {
    if (isAnswer(event.data)) answer(event.data)
  }
  // A worker that has fallen over is not a search failure worth reporting: the
  // next question opens a new one, and the field simply had no answer to this.
  made.onerror = () => {
    for (const one of waiting.values()) one.done()
    waiting.clear()
    worker?.terminate()
    worker = null
  }

  worker = made
  return made
}

function answer(message: Answer) {
  if (message.kind === 'warmth') {
    told?.(message.warmth)
    return
  }

  const one = waiting.get(message.id)
  if (!one) return

  if (message.kind === 'done') {
    waiting.delete(message.id)
    one.done()
    return
  }

  one.onFound({ hits: message.hits, loose: message.loose })
}

/** Runs one search in the worker, resolving when the space has been read. */
export function searchInWorker(
  root: string,
  query: Query,
  terms: string[],
  limit: number,
  onFound: (found: Found) => void,
  excluded: readonly string[] = [],
): Promise<void> {
  const id = ++asked

  return new Promise<void>((resolve) => {
    const running = open()
    if (!running) {
      resolve()
      return
    }
    waiting.set(id, { onFound, done: resolve })
    running.postMessage({
      kind: 'ask',
      id,
      root,
      query,
      terms,
      limit,
      excluded: [...excluded],
    } satisfies Ask)
  })
}
