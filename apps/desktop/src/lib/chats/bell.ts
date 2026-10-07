/** What the bell in a chat's head says and offers (docs/chats.md 4.11): the chat's level,
 *  all, mentions or nothing, and a mute, for a while or until it is turned back.
 *  Slack's three levels and Discord's mute lengths, in one menu. Pure, so the menu's
 *  rows are tested without drawing it. */

import type { Notify } from '@nib/chats'
import { isMuted, levelOf, MUTED_FOR_GOOD } from '@nib/chats/notify'

const HOUR = 60 * 60 * 1000

/** How long a mute from the bell's menu lasts, as Discord offers them: an hour, the
 *  evening, a day, a week. The bell's own Mute is until turned back. */
export const MUTE_HOURS = [1, 8, 24, 7 * 24] as const

/** What the bell draws: the level in force, or off for a chat that says nothing now. */
export type Ring = 'all' | 'mentions' | 'off'

export function ringOf(
  notify: Notify | null,
  mutedUntil: number | null,
  members: number,
  now: number,
): Ring {
  if (isMuted(mutedUntil, now)) return 'off'
  const level = levelOf(notify, members)
  return level === 'nothing' ? 'off' : level
}

/** The moment a mute of `hours` from now ends, or for good. */
export function mutedUntil(hours: number | null, now: number): number {
  return hours === null ? MUTED_FOR_GOOD : now + hours * HOUR
}
