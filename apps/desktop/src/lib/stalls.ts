/** The page's half of the stall recorder; the window's thread is src-tauri/src/stall.rs.
 *
 *  A frame the page could not draw for a second or more is a freeze somebody saw, so it
 *  goes in nib.log with what ran in it: the Long Animation Frames API names each script
 *  that took the frame - how it was called, its function and its file - which is the one
 *  attribution the page can have of itself without a profiler attached. And the calls to
 *  the crate still waiting, because a page that is not stuck in its own code is often
 *  stuck waiting on the crate.
 *
 *      WARN  stall: the page was blocked 1840 ms; ran TimerHandler:setTimeout fold
 *            link-index-3bd2.js:4120 1610 ms; waiting on read_tree 2.1 s
 *
 *  No path, address or words of a note: file names are the app's own bundles, and a
 *  call is said by its command. Observed from the launch's own frames on (`buffered`),
 *  set going once the launch is drawn, so the first paint carries none of it. */

import { log } from './log'
import { asking, isNative } from './tauri'

/** A frame this long is a stall. */
const STALL = 1000

/** How many of a frame's scripts, and of the calls waiting, the line names. */
const MOST = 3

/** One script of a long frame, as the engine reports it, with how long it ran in
 *  milliseconds as `took`: a word of this file's own, since `duration` is the motion
 *  tokens' word (test/motion.test.ts). */
interface Script {
  invoker: string
  sourceFunctionName: string
  sourceURL: string
  sourceCharPosition: number
  took: number
}

/** A long frame, as the engine reports it, `took` milliseconds long. */
interface Frame {
  startTime: number
  took: number
  scripts: Script[]
}

/** Starts listening. Nothing where the engine has no long frames to report, and nothing
 *  outside the app, where there is no log to write. */
export function watchStalls(): void {
  if (!isNative || typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) return

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const frame = frameOf(entry)
      if (frame && frame.took >= STALL) log('warn', described(frame, waiting()))
    }
  }).observe({ type: 'long-animation-frame', buffered: true })
}

/** The line for one long frame. */
export function described(frame: Frame, waitingOn: string[]): string {
  const ran = [...frame.scripts]
    .sort((a, b) => b.took - a.took)
    .slice(0, MOST)
    .map(
      (one) =>
        `${fileOf(one.invoker)} ${one.sourceFunctionName || '-'} ${fileOf(one.sourceURL) || '-'}:${one.sourceCharPosition} ${Math.round(one.took)} ms`,
    )
  return [
    `stall: the page was blocked ${Math.round(frame.took)} ms`,
    ran.length ? `ran ${ran.join(', ')}` : 'ran nothing it could name',
    ...(waitingOn.length ? [`waiting on ${waitingOn.join(', ')}`] : []),
  ].join('; ')
}

/** An address said as its last part: the app's bundles are its own, and anything else is
 *  nobody's business in a log. */
export function fileOf(said: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(said)
    ? (said.split(/[?#]/)[0]?.split('/').pop() ?? '')
    : said
}

/** The calls to the crate not answered yet, oldest first, with how long each has waited. */
function waiting(): string[] {
  const now = performance.now()
  return [...asking.values()]
    .sort((a, b) => a.at - b.at)
    .slice(0, MOST)
    .map((one) => `${one.command} ${((now - one.at) / 1000).toFixed(1)} s`)
}

/** A performance entry read as a long frame, or nothing where it is not one. */
function frameOf(entry: PerformanceEntry): Frame | null {
  const scripts: unknown = (entry as { scripts?: unknown }).scripts
  if (!Array.isArray(scripts)) return null
  return {
    startTime: entry.startTime,
    took: entry.duration,
    scripts: scripts.filter(isScript).map((one) => ({
      invoker: one.invoker,
      sourceFunctionName: one.sourceFunctionName,
      sourceURL: one.sourceURL,
      sourceCharPosition: one.sourceCharPosition,
      took: one.duration,
    })),
  }
}

/** A script as the engine reports it. */
type Reported = Omit<Script, 'took'> & Record<'duration', number>

function isScript(one: unknown): one is Reported {
  if (typeof one !== 'object' || one === null) return false
  const held = one as Record<string, unknown>
  return (
    typeof held.invoker === 'string' &&
    typeof held.sourceFunctionName === 'string' &&
    typeof held.sourceURL === 'string' &&
    typeof held.sourceCharPosition === 'number' &&
    typeof held.duration === 'number'
  )
}
