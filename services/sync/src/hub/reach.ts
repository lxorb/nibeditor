/** Reaching an account's hub from a route: one object per account (or guest),
 *  named by its id, asked one thing at a time by a header.
 *
 *  Never a throw. Every caller has already done the thing the hub is being told
 *  about - a row written, a session ended, a note saved - and a hub that is a
 *  moment from answering is not a reason for that to fail. A socket the hub did
 *  not hear about is set right by the socket's next connect; a poke nobody heard
 *  is covered by polling. */

import { chunks } from '../bound'
import type { Env } from '../types'

/** What a route may ask a hub. */
export type HubAsk = 'join' | 'poke' | 'upload' | 'revoke' | 'renamed' | 'erase' | 'machine'

/** What a route answers when the hub it needs did not answer: a moment to wait
 *  through, as a deploy is, rather than a failure. The socket's own handshake cannot
 *  be read by a browser and an upload is retried in the background, so nobody reads
 *  this and it has no catalogue row. */
export const HUB_AWAY = 'sync is not answering - try again'

/** How many hubs one request tells at once. */
const AT_ONCE = 50

/** Asks the hub named `id`, answering its response or null when it could not be
 *  reached. Asked twice, like a room: the commonest reason for an object not to
 *  answer is a deploy, and the second ask lands on the object that replaced it. */
export async function askHub(
  env: Env,
  id: string,
  ask: HubAsk,
  headers: Record<string, string> = {},
  body?: ArrayBuffer,
): Promise<Response | null> {
  const namespace = env.HUB
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const hub = namespace.get(namespace.idFromName(id))
      return await hub.fetch(
        new Request(`https://hub.invalid/${ask}`, {
          method: body ? 'PUT' : 'GET',
          headers: { ...headers, 'x-nib-hub': ask },
          ...(body ? { body } : {}),
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }

  return null
}

/** The hubs of accounts and guests that have gone for good, emptied: every socket
 *  closed and every lease forgotten. Answers the ids that are empty now, so the
 *  list they came from keeps the rest; without the namespace there are no hubs,
 *  and every one of them is as empty as it will ever be. See leftovers.ts. */
export async function eraseHubs(env: Env, ids: readonly string[]): Promise<string[]> {
  if (!env.HUB) return [...ids]

  const emptied: string[] = []
  for (const round of chunks(ids, AT_ONCE)) {
    const heard = await Promise.all(round.map((id) => askHub(env, id, 'erase')))
    emptied.push(...round.filter((_, at) => heard[at]?.ok === true))
  }

  return emptied
}

/** Tells every one of these hubs the same thing, a round at a time. */
export async function tellHubs(
  env: Env,
  ids: readonly string[],
  ask: HubAsk,
  headers: Record<string, string>,
): Promise<void> {
  for (const round of chunks(ids, AT_ONCE)) {
    await Promise.all(round.map((id) => askHub(env, id, ask, headers)))
  }
}
