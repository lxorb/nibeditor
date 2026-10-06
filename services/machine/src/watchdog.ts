/** `nibd`'s own watchdog: a process whose event loop is stuck answers nothing - no ping,
 *  no key, no screen - while it still looks alive to everything outside it. So the
 *  loop writes the time into a slot it shares with a worker thread once a second, and
 *  the worker, whose own loop the stuck one cannot hold up, ends the process once that
 *  time is `STALL` old. systemd's WatchdogSec, in one file.
 *
 *  Ended with SIGKILL, because a stuck loop never runs a SIGTERM handler. The
 *  entrypoint starts `nibd` again in the same machine (the disk and the home stay), and
 *  the screens come back from the last periodic save; see entrypoint.sh and nibd.ts. */

import { Worker } from 'node:worker_threads'

/** How long the loop may go without a turn before `nibd` is ended. A minute: nothing
 *  `nibd` does holds its loop for more than a moment, and a full-screen serialise of a
 *  large scrollback is well under a second. */
export const STALL = 60_000
const BEAT = 1000

/** Whether a loop last seen at `last` has stalled by `now`. */
export function stalled(last: number, now: number, limit = STALL): boolean {
  return now - last > limit
}

/** The worker, as source: it has to run while the main thread's loop does not, so it
 *  is its own thread, and it is a string so the bundle stays one file. `fs.writeSync`
 *  because a worker's `process.stderr` goes through the main thread, which is stuck. */
const WORKER = `
const { workerData } = require('node:worker_threads')
const { writeSync } = require('node:fs')
const slot = new BigInt64Array(workerData.slot)
setInterval(() => {
  const late = Date.now() - Number(Atomics.load(slot, 0))
  if (late <= workerData.limit) return
  try { writeSync(2, 'nibd: the event loop has not turned for ' + late + ' ms; ending\\n') } catch {}
  process.kill(process.pid, 'SIGKILL')
}, workerData.beat)
`

/** Starts watching this process's loop. Answers what stops it. */
export function watch(limit = STALL, beat = BEAT): () => void {
  const shared = new SharedArrayBuffer(8)
  const slot = new BigInt64Array(shared)
  const now = () => {
    Atomics.store(slot, 0, BigInt(Date.now()))
  }
  now()
  // Its own flags, not the process's: an ES module entry's would make this source a module.
  const worker = new Worker(WORKER, {
    eval: true,
    execArgv: [],
    workerData: { slot: shared, limit, beat },
  })
  worker.unref()
  const timer = setInterval(now, beat)
  timer.unref()
  return () => {
    clearInterval(timer)
    void worker.terminate()
  }
}
