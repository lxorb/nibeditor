/** The worker side of classify.ts: one meeting classified per message, off the
 *  writing thread. */

import type { Judging } from './classify'
import { judge } from './kinds'

self.onmessage = (event: MessageEvent<{ id: number; judging: Judging }>) => {
  const { id, judging: one } = event.data
  let judged = null
  try {
    judged = judge(one.shape, one.base, one.local, one.remote, one.times, one.merged)
  } catch {
    // Answered as nothing: the page classifies it on its own thread instead.
  }
  self.postMessage({ id, judged })
}
