/** The turns of a thread as the panel draws them.
 *
 *  The engine writes into the thread it is handed, in place, and says so through its
 *  events (chat/engine.ts). A reactive proxy cannot follow writes made to the plain
 *  objects behind it, so the panel draws a copy instead: a new array of turns, where a
 *  turn the event named is a new object with a new list of parts and every other turn
 *  is the very object it drew last time. The engine already hands each part that grew
 *  as a new value, so a keyed list redraws the one part that changed and nothing else.
 *  Pure. */

import type { Turn } from '../chat/types'

/** The turns, copied where they changed. `changed` names the turns an event touched,
 *  or is `all` for a thread opened or rewritten whole. */
export function snapshot(
  turns: readonly Turn[],
  before: readonly Turn[],
  changed: ReadonlySet<string> | 'all',
): Turn[] {
  const held = new Map(before.map((one) => [one.id, one]))
  return turns.map((turn) => {
    const kept = held.get(turn.id)
    if (kept && changed !== 'all' && !changed.has(turn.id)) return kept
    return { ...turn, parts: turn.parts.slice() }
  })
}
