/** The last lines of each terminal, kept between runs.
 *
 *  A restart brings a terminal back with a fresh shell, and VS Code, Warp and Windows
 *  Terminal all put back what was on its screen above the new prompt, so the build that
 *  failed yesterday is still there to read. VS Code keeps a hundred lines, which is what
 *  is kept here: enough to see where things were, and not a log of everything anybody
 *  ever typed into a shell sitting in the app's storage.
 *
 *  One entry for all of them, under the key each terminal was given when it was made
 *  (see spec.ts), and only the dozen written most recently: a terminal closed for good
 *  leaves its lines behind, and those make way for the next. */

import { isNumber, isRecord, isString, keep, stored } from '../stored'

const KEY = 'nib:terminal-lines'

/** How many terminals' lines are kept, newest first. */
const MOST = 12

/** How many lines each keeps. */
export const LINES = 100

interface Kept {
  at: number
  text: string
}

function all(): Record<string, Kept> {
  const value = stored(KEY)
  if (!isRecord(value)) return {}

  const out: Record<string, Kept> = {}
  for (const [key, one] of Object.entries(value)) {
    if (isRecord(one) && isNumber(one.at) && isString(one.text)) {
      out[key] = { at: one.at, text: one.text }
    }
  }
  return out
}

/** What a terminal had on its screen last time, or nothing. */
export function linesOf(key: string): string | null {
  return key ? (all()[key]?.text ?? null) : null
}

/** A terminal's screen, as it stands; `now` is when, for the newest-first rule. */
export function keepLines(key: string, text: string, now = Date.now()): void {
  if (!key) return

  const kept = { ...all(), [key]: { at: now, text } }
  const newest = Object.entries(kept)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, MOST)

  keep(KEY, JSON.stringify(Object.fromEntries(newest)))
}
