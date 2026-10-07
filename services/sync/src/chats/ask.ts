/** Reaching a chat's `ChatLog` from a route: one object per chat, named by its id,
 *  asked one thing at a time by a header (log.ts `ChatAsk`).
 *
 *  Asked twice, as a room and a hub are: the commonest reason for an object not to
 *  answer is a deploy, and the second ask lands on the object that replaced it. The
 *  helpers below that tell many objects one thing never throw: whoever calls them has
 *  already changed the rows the message is about. */

import { chunks } from '../bound'
import type { Env } from '../types'
import type { ChatAsk } from './log'

/** What a route answers when the chat's object did not: a moment to wait through. The
 *  app's outbox retries on its own, so nobody reads it and it has no catalogue row. */
export const CHAT_AWAY = 'this chat is not answering - try again'

/** How many objects one request tells at once. */
const AT_ONCE = 50

export async function askChat(
  env: Env,
  chat: string,
  ask: ChatAsk,
  headers: Record<string, string> = {},
  init: { url?: string; body?: string } = {},
): Promise<Response | null> {
  const namespace = env.CHATS
  if (!namespace) return null

  for (let asked = 0; asked < 2; asked++) {
    try {
      const log = namespace.get(namespace.idFromName(chat))
      return await log.fetch(
        new Request(init.url ?? `https://chats.invalid/${chat}`, {
          method: init.body === undefined ? 'GET' : 'POST',
          headers: { ...headers, 'x-nib-chat-ask': ask, 'x-nib-chat': chat },
          ...(init.body === undefined ? {} : { body: init.body }),
        }),
      )
    } catch {
      // A reset object: the loop asks the one that replaced it.
    }
  }
  return null
}

/** One chat told one thing, answering whether it heard. */
async function tell(env: Env, chat: string, ask: ChatAsk, headers: Record<string, string>) {
  const answer = await askChat(env, chat, ask, headers)
  return answer?.ok === true
}

/** How many chats one revocation tells, at most. */
const MOST_OPEN = 200

/** Somebody's access to a space ended, or narrowed to reading, and they may have its
 *  chats open: each chat they have open there is told, in the same request, as each
 *  room is (rooms/index.ts `roomsRevoked`, which calls this). `item` narrows it to the
 *  chats whose file that is. */
export async function chatsRevoked(
  env: Env,
  spaceId: string,
  who: string,
  role: 'none' | 'read',
  item = '',
): Promise<void> {
  if (!env.CHATS) return
  const { results } = await env.DB.prepare(
    `select s.chat_id as chat from chat_sockets s join chats c on c.id = s.chat_id
      where s.space_id = ?1 and s.who = ?2 and (?3 = '' or c.file_id = ?3) limit ?4`,
  )
    .bind(spaceId, who, item, MOST_OPEN)
    .all<{ chat: string }>()

  for (const round of chunks(results, AT_ONCE)) {
    await Promise.all(
      round.map((one) =>
        tell(env, one.chat, 'revoke', { 'x-nib-revoked': who, 'x-nib-role': role }),
      ),
    )
  }
}

/** A chat moved to another space (Move to space, docs/chats.md 4.2): its history goes
 *  with it and its audience changes, so everybody who has it open is closed out to come
 *  back through the door, which lets in whoever the new space reaches. Its pointer is
 *  linked again when it arrives in the new space. */
export async function chatsMoved(env: Env, chat: string, space: string): Promise<void> {
  await env.DB.prepare('update chats set space_id = ?, file_id = null where id = ?')
    .bind(space, chat)
    .run()
  const { results } = await env.DB.prepare('select who from chat_sockets where chat_id = ?')
    .bind(chat)
    .all<{ who: string }>()
  await closeChats(
    env,
    results.map((one) => ({ chat_id: chat, who: one.who })),
  )
}

/** Sockets whose way in went with an account: read before its rows go; see erase.ts. */
export async function closeChats(
  env: Env,
  open: readonly { chat_id: string; who: string }[],
): Promise<void> {
  if (!env.CHATS) return
  for (const round of chunks(open, AT_ONCE)) {
    await Promise.all(
      round.map((one) =>
        tell(env, one.chat_id, 'revoke', { 'x-nib-revoked': one.who, 'x-nib-role': 'none' }),
      ),
    )
  }
}

/** The objects of chats that have gone for good, emptied. Answers the ids that are empty
 *  now, so the list they came from keeps the rest; see leftovers.ts. */
export async function eraseChats(env: Env, chats: readonly string[]): Promise<string[]> {
  if (!env.CHATS) return [...chats]
  const emptied: string[] = []
  for (const round of chunks(chats, AT_ONCE)) {
    const heard = await Promise.all(round.map((chat) => tell(env, chat, 'erase', {})))
    emptied.push(...round.filter((_, at) => heard[at]))
  }
  return emptied
}
