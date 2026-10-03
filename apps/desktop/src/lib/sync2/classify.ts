/** Where the engine classifies two sets of edits (`judge` in kinds.ts): on this thread,
 *  or for a large note in a worker (docs/sync-v2.md 5.4 and 9.3), so a week's worth of
 *  another device's edits meeting a long note never holds a keystroke up.
 *
 *  What a worker answers is a verdict about the texts it was handed. The note may have
 *  been typed in meanwhile, so `rejoin` reads the texts again once the answer is back
 *  and classifies again here if they moved; see rejoin.ts. */

import type { Times } from '@nib/sync-core/diverge'
import { judge, type Judged, type Shape } from './kinds'

export interface Judging {
  shape: Shape
  base: string
  local: string
  remote: string
  times: Times
  merged?: string
}

/** Classifies one meeting. */
export type Classify = (judging: Judging) => Promise<Judged>

/** On this thread: the simulator's, the tests', and a small note's. */
export const inline: Classify = (one) =>
  Promise.resolve(judge(one.shape, one.base, one.local, one.remote, one.times, one.merged))

/** From this many characters on both sides together a meeting is classified in the
 *  worker: below it, the round trip costs more than the work. */
export const LARGE = 64 * 1024

/** The window's: a worker for a large note, this thread for the rest, and this thread
 *  again whenever the worker cannot be had. */
export function classifier(): Classify {
  let worker: Worker | null = null
  let asked = 0
  const waiting = new Map<number, (judged: Judged | null) => void>()

  const open = (): Worker | null => {
    if (worker) return worker
    try {
      const made = new Worker(new URL('./classify-worker.ts', import.meta.url), {
        type: 'module',
      })
      made.onmessage = (event: MessageEvent<{ id: number; judged: Judged | null }>) => {
        waiting.get(event.data.id)?.(event.data.judged)
        waiting.delete(event.data.id)
      }
      made.onerror = () => {
        for (const one of waiting.values()) one(null)
        waiting.clear()
        worker?.terminate()
        worker = null
      }
      worker = made
      return made
    } catch {
      return null
    }
  }

  return async (one) => {
    const size = one.base.length + one.local.length + one.remote.length
    const away = size >= LARGE ? open() : null
    if (!away) return inline(one)
    const id = ++asked
    const judged = await new Promise<Judged | null>((resolve) => {
      waiting.set(id, resolve)
      away.postMessage({ id, judging: one })
    })
    return judged ?? inline(one)
  }
}
