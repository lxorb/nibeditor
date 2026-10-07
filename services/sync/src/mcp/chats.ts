/** The connector's chats: `list_chats`, `read_chat`, `search_chats`, `post_message`
 *  and `react`, under the names and arguments `nib mcp` gives them, answered in the same
 *  words (`@nib/chats/agent`), so a prompt written against one reads the other the same
 *  way (docs/chats.md 4.14). `draft_message` is the app's alone: there is no composer
 *  here to put words in.
 *
 *  A chat is reached as the account reaches it, through its space (chats/reach.ts), and
 *  everything it holds is its `ChatLog`'s, asked the way the chats' own routes ask it.
 *  Every message the account did not write comes inside an untrusted mark naming the
 *  chat and the person. Posting and reacting need a token that may write and a role
 *  that may post; the account said yes to an agent writing as it when it gave the token
 *  that may, so nothing waits for a question here, and every message says it came by
 *  way of the connector. */

import { type Message, may, mentionsIn, type Post, ulid, type Who } from '@nib/chats'
import { chatsText, hitsText, type Listed, messagesText, type Reading } from '@nib/chats/agent'
import { accountById } from '../auth'
import { askChat } from '../chats/ask'
import { reachChat, type Reached } from '../chats/reach'
import { asking, listed, membersOf, searched } from '../chats/routes'
import type { Env, Whoever } from '../types'
import type { TokenRow } from './tokens'

const string = { type: 'string' }

/** What a message sent from here says it came by. */
const VIA = { agent: 'nib connector' }

/** The most messages one read answers, and one search. */
const MOST_READ = 200
const MOST_FOUND = 50

export const CHAT_TOOLS = [
  {
    name: 'list_chats',
    description: 'The chats you reach, a line each: name, id, space, people, unread.',
    inputSchema: { type: 'object', properties: { space: string, unread: { type: 'boolean' } } },
  },
  {
    name: 'read_chat',
    description:
      "A chat's messages (by name or id), oldest first: the newest, those before a message id, or replies_of one. Other people's words come marked untrusted.",
    inputSchema: {
      type: 'object',
      properties: { chat: string, before: string, replies_of: string, limit: { type: 'integer' } },
      required: ['chat'],
    },
  },
  {
    name: 'search_chats',
    description:
      'Messages matching words, "a phrase", from:@name, in:#chat, has:link|file|image|pin, is:reply, mentions:me, before:/after:/on: a date.',
    inputSchema: {
      type: 'object',
      properties: { query: string, limit: { type: 'integer' } },
      required: ['query'],
    },
  },
  {
    name: 'post_message',
    description:
      'Send text in a chat as the account, marked as sent by way of the connector; reply_to or quote a message id.',
    inputSchema: {
      type: 'object',
      properties: { chat: string, text: string, reply_to: string, quote: string },
      required: ['chat', 'text'],
    },
  },
  {
    name: 'react',
    description: 'Put an emoji on a message, or take it off with on false.',
    inputSchema: {
      type: 'object',
      properties: { chat: string, message: string, emoji: string, on: { type: 'boolean' } },
      required: ['chat', 'message', 'emoji'],
    },
  },
]

/** An argument as words, or undefined where it is missing or is not words. */
function words(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name]
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** A whole number argument, clamped, or the fallback. */
function whole(args: Record<string, unknown>, name: string, fallback: number, most: number) {
  const value = Number(args[name])
  return Number.isFinite(value) ? Math.min(Math.max(1, Math.floor(value)), most) : fallback
}

/** One chat the account reaches, as the answers name it. */
interface Known extends Listed {
  role: 'read' | 'write' | 'owner'
  posting: 'writers' | 'owner'
}

/** Every chat the account reaches, named by its pointer and its space: one query for
 *  the list, one for the names. A chat whose pointer the account has not seen yet has
 *  no name to be found by and is left out. */
async function chatsOf(env: Env, who: Whoever): Promise<Known[]> {
  const rows = (await listed(env, who, null)).slice(0, 500)
  if (!rows.length) return []
  const marks = rows.map(() => '?').join(', ')
  const { results } = await env.DB.prepare(
    `select ch.id as id, f.path as path, sp.name as space from chats ch
       join spaces sp on sp.id = ch.space_id
       left join notes f on f.id = ch.file_id and f.deleted = 0
      where ch.id in (${marks})`,
  )
    .bind(...rows.map((one) => one.id))
    .all<{ id: string; path: string | null; space: string }>()
  const named = new Map(results.map((one) => [one.id, one]))
  const me = whoOf(who)
  return rows.flatMap((row): Known[] => {
    const found = named.get(row.id)
    const name = (found?.path?.split('/').pop() ?? '').replace(/\.chat$/i, '')
    if (!found || !name) return []
    const behind = row.lastSeq > row.readSeq && row.lastBy !== me
    return [
      {
        id: row.id,
        name,
        space: found.space,
        members: row.members,
        unread: behind ? 'some' : 0,
        mentions: row.mentions,
        lastAt: row.lastAt,
        role: row.role,
        posting: row.meta.posting,
      },
    ]
  })
}

function whoOf(who: Whoever): Who {
  return who.kind === 'user' ? `user:${who.user.id}` : `guest:${who.guest.id}`
}

/** The chat an argument names, by id or by name (with or without `#`), or the sentence
 *  to answer with instead. */
async function chatNamed(
  env: Env,
  who: Whoever,
  args: Record<string, unknown>,
): Promise<{ known: Known; reached: Reached } | string> {
  const wanted = words(args, 'chat')
  if (!wanted) return 'Which chat? list_chats names them.'
  const folded = wanted.replace(/^#/, '').trim().toLowerCase()
  const all = await chatsOf(env, who)
  const known =
    all.find((one) => one.id === wanted) ?? all.find((one) => one.name.toLowerCase() === folded)
  const reached = known ? await reachChat(env, who, known.id) : null
  if (!known || !reached) return `No chat called ${wanted}. list_chats names them.`
  return { known, reached }
}

/** How the answers name people: by the chats' own names for them. */
async function readingOf(env: Env, who: Whoever, chats: readonly string[]): Promise<Reading> {
  const names = new Map<Who, string>()
  for (const chat of chats) {
    for (const member of await membersOf(env, chat)) {
      names.set(member.who, member.name ?? 'Deleted account')
    }
  }
  return { me: whoOf(who), nameOf: (person) => names.get(person) ?? person }
}

/** A page of a chat's messages as they stand, newest first, from its object. */
async function stateOf(
  env: Env,
  reached: Reached,
  query: Record<string, string>,
): Promise<Message[]> {
  const url = `https://chats.invalid/${reached.chat}/state?${new URLSearchParams(query).toString()}`
  const answer = await askChat(env, reached.chat, 'state', asking(reached), { url })
  if (!answer?.ok) return []
  return (await answer.json<{ messages: Message[] }>()).messages
}

/** One message by its id, or null. */
async function messageOf(env: Env, reached: Reached, id: string): Promise<Message | null> {
  const url = `https://chats.invalid/${reached.chat}/message?id=${encodeURIComponent(id)}`
  const answer = await askChat(env, reached.chat, 'message', asking(reached), { url })
  if (!answer?.ok) return null
  return (await answer.json<{ message: Message | null }>()).message
}

async function listChats(env: Env, who: Whoever, args: Record<string, unknown>) {
  const space = words(args, 'space')?.toLowerCase()
  const unread = args.unread === true
  return chatsText(
    (await chatsOf(env, who))
      .filter((one) => space === undefined || one.space.toLowerCase() === space)
      .filter((one) => !unread || one.unread !== 0 || one.mentions > 0),
  )
}

async function readChat(env: Env, who: Whoever, args: Record<string, unknown>) {
  const named = await chatNamed(env, who, args)
  if (typeof named === 'string') return named
  const { known, reached } = named
  const limit = whole(args, 'limit', 50, MOST_READ)
  const parent = words(args, 'replies_of')
  const before = words(args, 'before')

  let from: number | undefined
  if (before) {
    const found = await messageOf(env, reached, before)
    if (!found) return `#${known.name} has no message ${before}.`
    from = found.seq
  }
  // Replies come in their own page; the chat itself is read past the replies in it.
  const page = await stateOf(env, reached, {
    limit: String(parent ? limit : Math.min(1000, limit * 4)),
    ...(from !== undefined ? { before: String(from) } : {}),
    ...(parent ? { parent } : {}),
  })
  const shown = page
    .filter((one) => parent !== undefined || one.parent === undefined || one.alsoToChat)
    .slice(0, limit)
    .reverse()
  return messagesText(known.name, shown, await readingOf(env, who, [known.id]))
}

async function searchChats(env: Env, who: Whoever, args: Record<string, unknown>) {
  const query = words(args, 'query')
  if (!query) return 'Search for what?'
  const all = await chatsOf(env, who)
  const picked = (
    await Promise.all(
      all
        .slice(0, 50)
        .map(async (one) => ({ id: one.id, reached: await reachChat(env, who, one.id) })),
    )
  ).flatMap((one) => (one.reached ? [{ id: one.id, reached: one.reached }] : []))
  const names = new Map(all.map((one) => [one.id, one.name]))
  const hits = (await searched(env, who, (key) => (key === 'q' ? query : undefined), picked))
    .slice(0, whole(args, 'limit', 20, MOST_FOUND))
    .map((one) => ({ chat: names.get(one.chat) ?? one.chat, message: one.message }))
  const reading = await readingOf(env, who, [...new Set(picked.map((one) => one.id))])
  return hitsText(hits, reading)
}

/** One event sent to a chat as the account, answered with what the object said. */
async function sent(env: Env, reached: Reached, event: Post | Record<string, unknown>) {
  const answer = await askChat(env, reached.chat, 'send', asking(reached), {
    body: JSON.stringify({ events: [event] }),
  })
  if (!answer?.ok) return 'The chat did not answer. Try again.'
  const { results } = await answer.json<{ results: { refused?: string }[] }>()
  const refused = results[0]?.refused
  return refused ? `The chat refused it: ${refused}.` : null
}

/** Whether the account may say anything in the chat: a token that may write, and a role
 *  that may post there. The sentence to answer with where not. */
function mayWrite(token: TokenRow, known: Known): string | null {
  if (token.read_only) return 'This connection may only read. Reconnect it with writing allowed.'
  if (!may(known.role, 'post', known.posting)) return `You may only read #${known.name}.`
  return null
}

async function postMessage(env: Env, token: TokenRow, who: Whoever, args: Record<string, unknown>) {
  const named = await chatNamed(env, who, args)
  if (typeof named === 'string') return named
  const { known, reached } = named
  const refused = mayWrite(token, known)
  if (refused) return refused
  const body = words(args, 'text')
  if (!body) return 'Say what: text.'
  const members = (await membersOf(env, known.id)).map((one) => ({
    who: one.who,
    name: one.name ?? '',
  }))
  const mentions = mentionsIn(body, members)
  const parent = words(args, 'reply_to')
  const quote = words(args, 'quote')
  const post: Post = {
    kind: 'post',
    id: ulid(Date.now(), Math.random),
    message: ulid(Date.now(), Math.random),
    body,
    via: VIA,
    ...(parent ? { parent } : {}),
    ...(quote ? { quote } : {}),
    ...(mentions.length ? { mentions } : {}),
  }
  return (await sent(env, reached, post)) ?? `Posted in #${known.name} as ${post.message}.`
}

async function react(env: Env, token: TokenRow, who: Whoever, args: Record<string, unknown>) {
  const named = await chatNamed(env, who, args)
  if (typeof named === 'string') return named
  const { known, reached } = named
  const refused = mayWrite(token, known)
  if (refused) return refused
  const message = words(args, 'message')
  const emoji = words(args, 'emoji')
  if (!message || !emoji) return 'Say which message and which emoji.'
  const on = args.on !== false
  const event = { kind: 'react', id: ulid(Date.now(), Math.random), target: message, emoji, on }
  return (
    (await sent(env, reached, event)) ??
    `${on ? 'Reacted' : 'Took back'} ${emoji} on ${message} in #${known.name}.`
  )
}

/** One of the chats' tools, answered in words. */
export async function callChatTool(
  env: Env,
  token: TokenRow,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const user = await accountById(env, token.user_id)
  if (!user) return 'This account is gone.'
  const who: Whoever = { kind: 'user', user }
  switch (name) {
    case 'list_chats':
      return await listChats(env, who, args)
    case 'read_chat':
      return await readChat(env, who, args)
    case 'search_chats':
      return await searchChats(env, who, args)
    case 'post_message':
      return await postMessage(env, token, who, args)
    case 'react':
      return await react(env, token, who, args)
    default:
      return `There is no tool called ${name}.`
  }
}
