/** The app's chat notifications: `ChatNotices` (./notify.ts) in the window that holds
 *  the hub's socket, hearing its `chat` pokes, with the account, the reader's choices and
 *  the window as its world (docs/chats.md 4.11).
 *
 *  Started after the first paint for a signed-in desktop or browser (start.ts), never
 *  the glasses' plugin, and never a phone: a phone's notifications are the activity's,
 *  and phone push is off (decision 7.4). Importing this is starting it.
 *
 *  What the chats' surfaces tell it: which chat is on screen (`onScreen`), what a press
 *  opens (`whenPressed`), and, through `chatNotices`, the messages an open chat's socket
 *  placed and where the reader has read to. Until the chats' store answers for a chat,
 *  the account does: its list, its log after a place, its people, and the reply as an
 *  event of its own, idempotent by id like every other. */

import { apply, chatState, type Member, mentionsIn, type Message, ulid, type Who } from '@nib/chats'
import { MUTED_FOR_GOOD } from '@nib/chats/notify'
import { type ChatRow, chatListOf, eventsPageOf } from '@nib/chats/wire'
import { account } from '../account.svelte'
import { request } from '../api'
import { t } from '../i18n.svelte'
import { show, unshow } from '../notify'
import { deviceActivity } from '../people/here'
import { people } from '../people/people.svelte'
import { stands } from '../people/status'
import { residency } from '../reminders/residency.svelte'
import { hub } from '../sync2/hub.svelte'
import { hush } from './hush.svelte'
import { ChatNotices, type NoticeWorld, type Told } from './notify'

/** How long the account's list of chats is believed before it is asked again. */
const LISTED_FOR = 30_000

/** How long a chat's people are believed. */
const MEMBERS_FOR = 5 * 60_000

/** How many of a chat's newest messages one notification reads at most. */
const PAGE = 50

let listed: { at: number; rows: Map<string, ChatRow> } | null = null
const members = new Map<string, { at: number; list: Member[] }>()
/** The messages last read for each chat, so a reply's parent is found without asking. */
const recent = new Map<string, Message[]>()

/** The chats on screen in this window, each as often as a surface says so. */
const looking = new Map<string, number>()
let opener: ((chat: string, message: string) => void) | null = null

function token(): string {
  const held = account.accountToken
  if (!held) throw new Error('signed out')
  return held
}

const path = (chat: string) => `/v2/chats/${encodeURIComponent(chat)}`

async function rows(fresh = false): Promise<Map<string, ChatRow>> {
  if (listed && !fresh && Date.now() - listed.at < LISTED_FOR) return listed.rows
  const answer = chatListOf(await request<unknown>('/v2/chats', { token: token() }))
  const found = new Map((answer?.chats ?? []).map((row) => [row.id, row]))
  listed = { at: Date.now(), rows: found }
  residency.chats = found.size > 0
  return found
}

async function peopleOf(chat: string): Promise<Member[]> {
  const held = members.get(chat)
  if (held && Date.now() - held.at < MEMBERS_FOR) return held.list
  const answer = await request<{ members?: { who: Who; name: string | null }[] }>(
    `${path(chat)}/members`,
    { token: token() },
  )
  const list = (answer.members ?? []).map((one) => ({ who: one.who, name: one.name ?? '' }))
  members.set(chat, { at: Date.now(), list })
  return list
}

/** Do not disturb, as the reader's status says it now: a moment, for good, or none. */
function dndUntil(): number | null {
  const status = account.user?.status
  if (!status?.quiet || !stands(status, Date.now())) return null
  return status.until ?? MUTED_FOR_GOOD
}

const world: NoticeWorld = {
  me: () => {
    const id = account.user?.id
    return id ? `user:${id}` : null
  },

  async chat(chat) {
    const row = (await rows()).get(chat) ?? (await rows(true)).get(chat)
    if (!row) return null
    const space = account.spaces.find((one) => one.id === row.space)
    const told: Told = {
      place: space?.name ?? null,
      members: row.members,
      notify: row.notify,
      mutedUntil: row.mutedUntil,
      readSeq: row.readSeq,
    }
    return told
  },

  async after(chat, seq) {
    const page = eventsPageOf(
      await request<unknown>(`${path(chat)}/events?after=${seq}&limit=${PAGE}`, {
        token: token(),
      }),
    )
    const state = chatState()
    const placed = new Map<string, Message>()
    for (const event of page?.events ?? []) {
      for (const message of apply(state, event)) placed.set(message.id, message)
    }
    const messages = [...placed.values()].sort((a, b) => a.seq - b.seq)
    recent.set(chat, messages)
    return messages
  },

  authorOf: (chat, message) =>
    Promise.resolve(recent.get(chat)?.find((one) => one.id === message)?.author ?? null),

  async nameOf(chat, who) {
    const row = listed?.rows.get(chat)
    const [kind, id] = who.split(':')
    const known = kind === 'user' && id ? people.called(id, row?.space) : undefined
    if (known) return known
    return (await peopleOf(chat)).find((one) => one.who === who)?.name ?? ''
  },

  chosen: () => ({
    keywords: hush.keywords,
    hours: hush.hours,
    dndUntil: dndUntil(),
    previews: hush.previews,
    sound: hush.sound,
  }),

  active: () => deviceActivity().active,

  seen: (chat) =>
    (looking.get(chat) ?? 0) > 0 && document.visibilityState === 'visible' && document.hasFocus(),

  now: () => Date.now(),
  show,
  unshow,
  open: (chat, message) => opener?.(chat, message),

  async reply(chat, body, parent) {
    const now = Date.now()
    const random = () => Math.random()
    const event = {
      kind: 'post' as const,
      id: ulid(now, random),
      message: ulid(now, random),
      body,
      ...(parent ? { parent } : {}),
      mentions: mentionsIn(body, await peopleOf(chat)),
    }
    await request(`${path(chat)}/events`, {
      method: 'POST',
      token: token(),
      body: { events: [event] },
    })
  },

  read(chat, seq) {
    void request(`${path(chat)}/read`, { method: 'POST', token: token(), body: { seq } }).catch(
      () => undefined,
    )
  },
}

/** The notifications of every chat this account reaches. */
export const chatNotices = new ChatNotices(world, () => ({
  hidden: t('New message'),
  reply: t('Reply'),
  send: t('Send'),
}))

/** A chat on screen in this window: nothing pings for it while the window is in front,
 *  and what was showing for it goes. Answers how to say it is not any more. */
export function onScreen(chat: string): () => void {
  looking.set(chat, (looking.get(chat) ?? 0) + 1)
  unshow(chat)
  return () => {
    const left = (looking.get(chat) ?? 1) - 1
    if (left > 0) looking.set(chat, left)
    else looking.delete(chat)
  }
}

/** What a press on a chat's notification opens: the chat, at the message. */
export function whenPressed(open: (chat: string, message: string) => void): void {
  opener = open
}

// Pokes, in the one window that holds the hub's socket, so a message pings once a
// device; and the account's list once, which says whether any chat keeps nib in the tray.
hub.on('chat', (poke) => {
  if (hub.leads) chatNotices.heard(poke)
})
void rows().catch(() => undefined)
