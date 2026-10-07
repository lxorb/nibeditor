/** Whether a person is here: worked out by their account's hub from the sockets their
 *  devices hold, and written down only when the answer changes.
 *
 *  Three answers, Slack's: **active** while any device of theirs is in use, **away**
 *  while one is connected and none is, **offline** with none connected. The hub knows
 *  each socket's `active` already, because a device says `active` and `idle` for its
 *  web logins (hub.ts), so presence costs no frame of its own. Nobody is told when it
 *  changes: whoever has a person on screen asks, at most once a minute (see
 *  apps/desktop/src/lib/people), and that is one query against the row written here,
 *  never a fan-out per person per change. See docs/chats.md 4.10. */

import type { Env } from '../types'
import type { Presence } from './profile'

/** As much of a hub socket as presence reads. */
export interface Held {
  active: boolean
  guest: boolean
}

/** What a person is, by the sockets their devices hold. A socket that has not said
 *  `hello` yet is a device arriving, and counts as connected: the hub has let it in. */
export function presenceOf(sockets: readonly Held[]): Presence {
  const theirs = sockets.filter((one) => !one.guest)
  if (!theirs.length) return 'offline'
  return theirs.some((one) => one.active) ? 'active' : 'away'
}

/** Writes what a person is now, where that is not what is written already: a device
 *  going idle and back is two writes, and a second device arriving while the first is
 *  in use is none. One statement either way, so the hub keeps nothing of its own for
 *  it, and asks only when a socket arrives, goes, or changes its mind. */
export async function keepPresence(env: Env, user: string, state: Presence): Promise<void> {
  await env.DB.prepare(
    `insert into presence (user_id, state, at) values (?1, ?2, ?3)
     on conflict(user_id) do update set state = excluded.state, at = excluded.at
      where presence.state <> excluded.state`,
  )
    .bind(user, state, Date.now())
    .run()
}
