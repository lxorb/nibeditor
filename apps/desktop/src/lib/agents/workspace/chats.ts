/** The chats' verbs: `list_chats`, `read_chat`, `search_chats`, `draft_message`,
 *  `post_message` and `react` (docs/chats.md 4.14).
 *
 *  Everything goes through the chats' store, the one every surface reads and the one
 *  write path every message takes (lib/chats/api.ts), so an agent's message is placed,
 *  drawn and synced exactly as one typed. What is decided here is what a row cannot say:
 *
 *  - **Which chats exist.** Those whose pointer is in a space the grant reaches; a chat
 *    whose space it does not reach is absent from every list and every lookup, as such
 *    a space is (9.6).
 *  - **Whose words.** The answers are `@nib/chats/agent`'s text, the connector's too:
 *    every message the reader did not write comes inside an untrusted mark naming the
 *    chat and the person, so another person's words are never an agent's instructions.
 *  - **What asks.** A post or a reaction in a chat anybody else reads is Publishing
 *    (docs/agent-native.md 9.3): asked in Approve mode, never in Agent mode, with
 *    "Always in this chat" as the third answer. The chat with yourself asks nothing. A
 *    draft never asks: it waits in the composer for the reader to press Send. */

import { may, type Message, type Who } from '@nib/chats'
import { chatsText, hitsText, type Listed, messagesText, type Reading } from '@nib/chats/agent'
import type { AgentAnswer } from '../../automation/caller'
import type { ChatEntry, Chats } from '../../chats/api'
import { workspace } from '../../workspace.svelte'
import { asked } from './asks'
import { type Call, count, done, flag, maybe, need, text } from './call'
import { Refused } from './problem'
import { placeFor, reachable } from './spaces'

/** The most messages one `read_chat` answers, and one `search_chats`. */
const MOST_READ = 200
const MOST_FOUND = 50

/** The chats' store, once it has the account's list: fetched with the first of these
 *  verbs, waited for a few seconds at the most on a launch an agent called into early. */
async function chatsStore(): Promise<Chats> {
  const { chats } = await import('../../chats/store.svelte')
  for (let waited = 0; !chats.ready && waited < 8000; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!chats.me) throw new Refused('not_found', 'chats need nib’s account, and nobody is signed in')
  return chats
}

/** A chat an agent may see, with its space's name. */
interface Seen {
  entry: ChatEntry
  name: string
  space: string
}

/** The chats whose space the grant reaches, newest first. */
function seenBy(call: Call, store: Chats): Seen[] {
  const spaces = reachable(call)
  return store.list.flatMap((entry) => {
    const space = spaces.find((one) => one.root === entry.root)
    return space && entry.name ? [{ entry, name: entry.name, space: space.name }] : []
  })
}

/** The chat a call names, by its id or its name (with or without `#`): the space in
 *  front's first where two spaces have one by the name. */
function chatFor(call: Call, store: Chats): Seen {
  const named = need(call, 'chat')
  const folded = named.replace(/^#/, '').trim().toLowerCase()
  const seen = seenBy(call, store)
  const front = workspace.activeSpace?.root
  const found =
    seen.find((one) => one.entry.id === named) ??
    seen.find((one) => one.name.toLowerCase() === folded && one.entry.root === front) ??
    seen.find((one) => one.name.toLowerCase() === folded)
  if (!found)
    throw new Refused('not_found', `there is no chat called ${named}: list_chats names them`)
  return found
}

/** How the answers name people: by the chat's own names for them. */
async function readingOf(store: Chats, chats: readonly string[]): Promise<Reading> {
  const names = new Map<Who, string>()
  for (const chat of chats) {
    for (const member of await store.members(chat).catch(() => [])) {
      names.set(member.who, member.name ?? 'Deleted account')
    }
  }
  return { me: store.me, nameOf: (who) => names.get(who) ?? who }
}

/** `list_chats`: the chats, a line each, the unread ones alone with `unread`. */
export async function listChats(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const space = maybe(call, 'space')
  const only = space === null ? null : placeFor(call, space).space.name
  const listed: Listed[] = seenBy(call, store)
    .filter((one) => only === null || one.space === only)
    .filter((one) => !flag(call, 'unread') || one.entry.unread > 0 || one.entry.mentions > 0)
    .map(({ entry, name, space: where }) => ({
      id: entry.id,
      name,
      space: where,
      members: entry.members,
      unread: entry.unread,
      mentions: entry.mentions,
      lastAt: entry.lastAt,
    }))
  return done(chatsText(listed))
}

/** The place in the log of a message a call names, or a refusal saying it is not there. */
async function seqOf(store: Chats, chat: Seen, message: string): Promise<number> {
  const [found] = await store.history(chat.entry.id, { around: message, limit: 1 })
  if (!found) throw new Refused('not_found', `#${chat.name} has no message ${message}`)
  return found.seq
}

/** `read_chat`: the newest messages, or those around, before or after one, or one
 *  message's replies; oldest first. */
export async function readChat(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const limit = count(call, 'limit', 50, MOST_READ)
  const parent = maybe(call, 'replies_of')
  const around = maybe(call, 'around')
  const before = maybe(call, 'before')
  const after = maybe(call, 'after')
  const id = chat.entry.id

  let messages: Message[]
  if (around !== null) {
    messages = await store.history(id, { around, limit })
    if (!messages.length) throw new Refused('not_found', `#${chat.name} has no message ${around}`)
  } else {
    messages = await store.history(id, {
      limit,
      ...(parent !== null ? { parent } : {}),
      ...(before !== null ? { before: await seqOf(store, chat, before) } : {}),
      ...(after !== null ? { after: await seqOf(store, chat, after) } : {}),
    })
  }
  return done(messagesText(chat.name, messages, await readingOf(store, [id])))
}

/** `search_chats`: the language of the search panel (4.12), over the chats the grant
 *  reaches, newest first. */
export async function searchChats(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const query = need(call, 'query')
  const seen = new Map(seenBy(call, store).map((one) => [one.entry.id, one.name]))
  const hits = (await store.search(query))
    .flatMap((hit) => {
      const name = seen.get(hit.chat)
      return name === undefined ? [] : [{ chat: name, id: hit.chat, message: hit.message }]
    })
    .slice(0, count(call, 'limit', 20, MOST_FOUND))
  const reading = await readingOf(store, [...new Set(hits.map((one) => one.id))])
  return done(hitsText(hits, reading))
}

/** A chat the reader may say things in, or a refusal saying they may only read it. */
function mayPost(chat: Seen): void {
  if (!may(chat.entry.role, 'post', chat.entry.meta.posting)) {
    throw new Refused('read_only', `the reader may only read #${chat.name}`)
  }
}

/** Publishing's question, where anybody else reads the chat: null to go ahead. */
function askFirst(call: Call, chat: Seen, summary: string): Promise<AgentAnswer | null> {
  if (chat.entry.members <= 1) return Promise.resolve(null)
  return asked(call, 'publishing', summary, `chat:${chat.entry.id}`)
}

/** Who wrote it for the reader, which the message carries: the agent's name. */
function viaOf(call: Call): { via: { agent: string } } | Record<string, never> {
  const agent = call.caller.agent
  return agent ? { via: { agent: agent.name } } : {}
}

/** `draft_message`: words into the reader's composer for the chat, never sent. The chat
 *  opens behind the tab in front where it is not open, so the draft is one press away. */
export async function draftMessage(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const words = text(call, 'text') ?? ''
  if (!words.trim()) throw new Refused('bad_arguments', 'say text')
  mayPost(chat)
  const parent = maybe(call, 'reply_to') ?? undefined
  if (chat.entry.path) {
    const { openChat } = await import('../../chats/view/open')
    openChat(chat.entry.path, { activate: false })
  }
  store.offer(chat.entry.id, words, parent ? { parent } : {})
  return done(`Drafted in #${chat.name}. The reader sends it.`)
}

/** `post_message`: a message, or a reply, sent as the reader by way of the agent. */
export async function postMessage(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const words = text(call, 'text') ?? ''
  if (!words.trim()) throw new Refused('bad_arguments', 'say text')
  mayPost(chat)
  const parent = maybe(call, 'reply_to')
  const quote = maybe(call, 'quote')

  const question = await askFirst(call, chat, `#${chat.name}: ${words}`)
  if (question) return question

  const id = await store.post(chat.entry.id, {
    body: words,
    ...(parent !== null ? { parent } : {}),
    ...(quote !== null ? { quote } : {}),
    ...viaOf(call),
  })
  return done(`Posted in #${chat.name} as ${id}.`)
}

/** `react`: one emoji on a message, or taken off with `on` false. */
export async function react(call: Call): Promise<AgentAnswer> {
  const store = await chatsStore()
  const chat = chatFor(call, store)
  const message = need(call, 'message')
  const emoji = need(call, 'emoji')
  const on = call.args.on === undefined ? true : flag(call, 'on')
  mayPost(chat)
  await seqOf(store, chat, message)

  const question = await askFirst(call, chat, `#${chat.name}: ${emoji} ${on ? '+' : '-'}`)
  if (question) return question

  await store.react(chat.entry.id, message, emoji, on)
  return done(`${on ? 'Reacted' : 'Took back'} ${emoji} on ${message} in #${chat.name}.`)
}
