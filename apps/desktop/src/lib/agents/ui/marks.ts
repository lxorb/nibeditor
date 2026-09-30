/** Which tabs wear an agent's mark, and how: the frame's and the mark's state machine.
 *
 *  A tab is in one of three states, and the whole of the frame and the tab mark is
 *  these three said with a colour (docs/agent-native.md 7.1, 7.3):
 *
 *  | state | when | worn |
 *  | --- | --- | --- |
 *  | acting | the agent called on the tab within `ACTIVE_FOR` | its colour; the mark turns |
 *  | paused | the reader took the tab, handed it over for a step, or stopped the agent while it was acting there | muted; the mark is still, and a press on it gives the tab back |
 *  | none | anything else | nothing |
 *
 *  **Acting is a stretch of time, not a call.** The crate says when a call starts and
 *  never when an agent is done, because an agent at work is a model thinking between
 *  calls: seconds, not minutes. A mark that went out the moment a call answered would
 *  blink on every one, which is the loud thing this design is against, so a tab is
 *  acted in until `ACTIVE_FOR` has passed without a call.
 *
 *  **A pause is kept until it is given back.** Nothing gives a tab back by itself (open
 *  question 5): a tab that started moving again while somebody read it is the
 *  interruption the whole design avoids, and a mark that went away would leave nobody
 *  anything to press. */

import type { Worn } from '../../agent-marks.svelte'
import { pausedKey, type Seen } from './seen'

/** How long a tab counts as acted in after the agent's last call there. Longer than a
 *  model takes over one step, and short enough that a job that has finished lets go of
 *  the tab while the reader is still wondering whether it has. */
export const ACTIVE_FOR = 15_000

/** The colour an agent wears, from its id. */
export type ColourOf = (agent: string) => string

/** Every tab that wears a mark at `now`, by the tab's id. The agents' own tabs are
 *  nobody's tabs in the strip, so they are left out; the panel draws those. */
export function wornAt(seen: Seen, now: number, colourOf: ColourOf): Record<string, Worn> {
  const worn: Record<string, Worn> = {}

  for (const [tab, touch] of Object.entries(seen.acting)) {
    if (tab in seen.tabs) continue

    const state = stateOf(seen, tab, touch.agent, touch.at, now)
    if (state !== 'none') {
      worn[tab] = { agent: touch.agent, colour: colourOf(touch.agent), paused: state === 'paused' }
    }
  }

  // A pause on a tab nothing is known to have acted in - the overview's, after a
  // window came up - still wants its mark, or there is nothing to give it back with.
  for (const key of Object.keys(seen.paused)) {
    const [agent = '', tab = ''] = key.split('\n')
    if (tab in worn || tab in seen.tabs) continue
    worn[tab] = { agent, colour: colourOf(agent), paused: true }
  }

  return worn
}

/** One tab's state, for the agent that last called on it. */
export function stateOf(
  seen: Seen,
  tab: string,
  agent: string,
  at: number,
  now: number,
): 'acting' | 'paused' | 'none' {
  if (pausedKey(agent, tab) in seen.paused) return 'paused'

  // Stopped while it was acting here: the tab is kept as it was so what happened can be
  // looked at, muted, until the stop is given back.
  const stoppedAt = seen.halted[agent] ?? seen.stopped
  if (stoppedAt !== null) {
    return at + ACTIVE_FOR > stoppedAt ? 'paused' : 'none'
  }

  return now - at < ACTIVE_FOR ? 'acting' : 'none'
}

/** When the next acting tab stops being one, so a timer can look again then rather
 *  than every second. Null while nothing is acting. */
export function nextLapse(seen: Seen, now: number): number | null {
  let soonest: number | null = null

  for (const touch of Object.values(seen.acting)) {
    const ends = touch.at + ACTIVE_FOR
    if (ends > now && (soonest === null || ends < soonest)) soonest = ends
  }

  return soonest
}

/** Whether two sets of marks say the same thing, so the shell's state is written only
 *  when a mark changed and not on every call. */
export function sameMarks(one: Record<string, Worn>, other: Record<string, Worn>): boolean {
  const keys = Object.keys(one)
  if (keys.length !== Object.keys(other).length) return false

  return keys.every((key) => {
    const a = one[key]
    const b = other[key]
    if (!a || !b) return false
    return a.agent === b.agent && a.colour === b.colour && a.paused === b.paused
  })
}
