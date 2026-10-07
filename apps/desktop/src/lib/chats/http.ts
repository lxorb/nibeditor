/** What the app asks the account about chats over HTTP (docs/chats.md 4.4; the routes are
 *  services/sync/src/chats/routes.ts). Every answer is read with its check from
 *  `@nib/chats/wire` before anything trusts it.
 *
 *  A call answers null when the account could not be reached or asked for a moment
 *  (`429`, `5xx`, no network): the caller tries again later. A refusal it can act on is
 *  an `ApiError` with the account's own word in it. */

import type { Event, Notify, Pointer } from '@nib/chats'
import { chatOf } from '@nib/chats'
import {
  chatListOf,
  type ChatList,
  eventOf,
  eventsPageOf,
  type EventsPage,
  isWho,
  messageOf,
  type Results,
  resultsOf,
  statePageOf,
  type StatePage,
} from '@nib/chats/wire'
import { account } from '../account.svelte'
import { ApiError, BASE, request } from '../api'
import { isRecord } from '../stored'
import type { ChatMember, Hit, Scheduled } from './api'

const chatPath = (chat: string) => `/v2/chats/${encodeURIComponent(chat)}`

/** One call, or null for a moment's trouble. */
async function ask(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const token = account.token
  if (!token) return null
  try {
    return await request<unknown>(path, { ...options, token, device: true })
  } catch (error) {
    if (error instanceof ApiError && error.status !== 429 && error.status < 500) throw error
    return null
  }
}

/** Every chat the account reaches. */
export async function listChats(): Promise<ChatList | null> {
  return chatListOf(await ask('/v2/chats'))
}

/** A new chat in a space, answered with what its pointer holds. */
export async function makeChat(space: string): Promise<Pointer | null> {
  const said = await ask('/v2/chats', { body: { space } })
  return chatOf(JSON.stringify(said))
}

/** A chat moved to another space (Move to space). */
export async function moveChat(chat: string, space: string): Promise<boolean> {
  return (await ask(chatPath(chat), { method: 'PATCH', body: { space } })) !== null
}

/** Events by `seq`: after one, before one, or around one. */
export async function eventsOf(
  chat: string,
  where: { after?: number; before?: number; around?: number },
  limit = 500,
): Promise<EventsPage | null> {
  const query = new URLSearchParams({ limit: String(limit) })
  for (const [key, value] of Object.entries(where)) query.set(key, String(value))
  return eventsPageOf(await ask(`${chatPath(chat)}/events?${query.toString()}`))
}

/** Messages as they stand, newest first, before a place. */
export async function stateOf(chat: string, before?: number): Promise<StatePage | null> {
  const query = before === undefined ? '' : `?before=${String(before)}`
  return statePageOf(await ask(`${chatPath(chat)}/state${query}`))
}

/** Events from the outbox, in order; each answered with its place or why not. */
export async function postEvents(chat: string, events: readonly Event[]): Promise<Results | null> {
  return resultsOf(await ask(`${chatPath(chat)}/events`, { body: { events } }))
}

/** The reader's read place, from a device with no socket open; `back` is Mark unread. */
export async function postRead(chat: string, seq: number, back = false): Promise<boolean> {
  return (await ask(`${chatPath(chat)}/read`, { body: { seq, back } })) !== null
}

/** What pings the reader for this chat. */
export async function putMe(
  chat: string,
  notify: Notify | null,
  mutedUntil: number | null,
): Promise<boolean> {
  return (
    (await ask(`${chatPath(chat)}/me`, { method: 'PUT', body: { notify, mutedUntil } })) !== null
  )
}

const ROLES = ['read', 'write', 'owner'] as const

/** The chat's people, by name. */
export async function membersOf(chat: string): Promise<ChatMember[] | null> {
  const said = await ask(`${chatPath(chat)}/members`)
  if (!isRecord(said) || !Array.isArray(said.members)) return null
  return said.members.flatMap((one): ChatMember[] => {
    if (!isRecord(one) || !isWho(one.who)) return []
    const role = ROLES.find((each) => each === one.role) ?? 'read'
    return [{ who: one.who, name: typeof one.name === 'string' ? one.name : null, role }]
  })
}

/** Who in a chat cannot open a note of a space, and whether the reader may share it
 *  with them (docs/chats.md 4.13). */
export async function noteReachOf(
  chat: string,
  space: string,
  note: string,
): Promise<{ missing: ChatMember[]; share: boolean } | null> {
  const query = new URLSearchParams({ space, note }).toString()
  const said = await ask(`${chatPath(chat)}/note?${query}`).catch(() => null)
  if (!isRecord(said) || !Array.isArray(said.missing)) return null
  const missing = said.missing.flatMap((one): ChatMember[] =>
    isRecord(one) && isWho(one.who)
      ? [{ who: one.who, name: typeof one.name === 'string' ? one.name : null, role: 'read' }]
      : [],
  )
  return { missing, share: said.share === true }
}

/** That note shared, to read, with everybody in the chat who could not open it. */
export async function shareNote(chat: string, space: string, note: string): Promise<boolean> {
  return (await ask(`${chatPath(chat)}/note`, { body: { space, note } }).catch(() => null)) !== null
}

/** The reader's posts waiting for their time. */
export async function scheduledOf(chat: string): Promise<Scheduled[] | null> {
  const said = await ask(`${chatPath(chat)}/scheduled`)
  if (!isRecord(said) || !Array.isArray(said.scheduled)) return null
  return said.scheduled.flatMap((one): Scheduled[] => {
    if (!isRecord(one) || typeof one.id !== 'string' || typeof one.sendAt !== 'number') return []
    const post = eventOf(one.post)
    return post?.kind === 'post' ? [{ id: one.id, sendAt: one.sendAt, post }] : []
  })
}

/** The account's own search, for a build with no store to search: across the reader's
 *  chats, or in one. */
export async function searchOnAccount(query: string, chat?: string): Promise<Hit[] | null> {
  const params = new URLSearchParams({
    q: query,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const path = chat ? `${chatPath(chat)}/search` : '/v2/chats/search'
  const said = await ask(`${path}?${params.toString()}`)
  if (!isRecord(said) || !Array.isArray(said.hits)) return null
  return said.hits.flatMap((one): Hit[] => {
    if (chat) {
      const message = messageOf(one)
      return message ? [{ chat, message }] : []
    }
    const message = isRecord(one) ? messageOf(one.message) : null
    return isRecord(one) && typeof one.chat === 'string' && message
      ? [{ chat: one.chat, message }]
      : []
  })
}

/** A file's bytes up to the account under their hash. */
export async function putBlob(hash: string, bytes: Uint8Array): Promise<boolean> {
  const token = account.token
  if (!token) return false
  try {
    const response = await fetch(`${BASE}/v2/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })
    return response.ok
  } catch {
    return false
  }
}

/** A file a message of this chat names, as bytes. */
export async function fileOf(chat: string, hash: string): Promise<Blob | null> {
  const token = account.token
  if (!token) return null
  try {
    const response = await fetch(`${BASE}${chatPath(chat)}/files/${hash}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return response.ok ? await response.blob() : null
  } catch {
    return null
  }
}
