/** Chats as an agent reads them (docs/chats.md 4.14): the words `list_chats`,
 *  `read_chat` and `search_chats` answer with, on both servers.
 *
 *  `nib mcp` answers in the window and the account connector in the Worker, and a skill
 *  written against one should read the other's answers the same way, so the text is
 *  made here, once. Every message the reader did not write comes inside an untrusted
 *  mark naming the chat and the person, as a page's words do (docs/agent-native.md
 *  9.6): somebody else's words in a chat are data, never instructions, and an agent
 *  that obeyed them would be acting for whoever wrote them. The mark is the crate's
 *  (src-tauri/src/mcp/marks.rs), letter for letter, so the server's instructions about
 *  it hold for these too: nothing inside can close it early or open one of its own. */

import type { Message, Who } from './types'

const TAG = 'untrusted'

/** Words from somebody else, inside a mark naming where they came from. */
export function untrusted(source: string, words: string): string {
  return `<${TAG} source="${attribute(source)}">\n${inert(words)}\n</${TAG}>`
}

/** The words with every mark they spell made into text: the `<` of `<untrusted` and of
 *  `</untrusted`, in any case, written `&lt;`. */
function inert(words: string): string {
  return words.replace(/<(?=\/?untrusted)/gi, '&lt;')
}

/** A source as an attribute's value: one line, its quotes and brackets as entities,
 *  and short. */
function attribute(source: string): string {
  return Array.from(source)
    .slice(0, 300)
    .map((one) => {
      if (one === '&') return '&amp;'
      if (one === '"') return '&quot;'
      if (one === '<') return '&lt;'
      if (one === '>') return '&gt;'
      return /\p{Cc}/u.test(one) ? ' ' : one
    })
    .join('')
}

/** A moment as a model reads it best: the instant, to the minute, in UTC. */
export function momentOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}Z`
}

/** What a reader of the answer needs about the people in it. */
export interface Reading {
  /** The reader, whose own words are theirs and need no mark. */
  me: Who | null
  /** A person's name as the chat shows it. */
  nameOf: (who: Who) => string
}

/** One chat as `list_chats` names it. */
export interface Listed {
  id: string
  name: string
  space: string
  members: number
  /** How many messages are unread, or 'some' where only that there are is known. */
  unread: number | 'some'
  mentions: number
  lastAt: number | null
}

/** The chats, a line each, or a sentence where there are none. */
export function chatsText(chats: readonly Listed[]): string {
  if (!chats.length) return 'No chats.'
  return chats
    .map((one) =>
      [
        `#${one.name}`,
        one.id,
        one.space,
        `${String(one.members)} people`,
        ...(one.unread === 'some'
          ? ['unread']
          : one.unread
            ? [`${String(one.unread)} unread`]
            : []),
        ...(one.mentions ? [`${String(one.mentions)} mentions`] : []),
        ...(one.lastAt ? [`last ${momentOf(one.lastAt)}`] : []),
      ].join(' · '),
    )
    .join('\n')
}

/** One message: a head line of what it is, and its words, marked where they are not the
 *  reader's. */
export function messageText(chat: string, message: Message, reading: Reading): string {
  const mine = message.author === reading.me
  const name = reading.nameOf(message.author)
  const reactions = Object.entries(message.reactions)
    .filter(([, who]) => who.length)
    .map(([emoji, who]) => `${emoji} ${String(who.length)}`)
  const head = [
    message.id,
    momentOf(message.at),
    mine ? `${name} (you)` : name,
    ...(message.via ? [`via ${message.via.agent}`] : []),
    ...(message.parent ? [`reply to ${message.parent}`] : []),
    ...(message.quote ? [`quoting ${message.quote}`] : []),
    ...(message.replies ? [`${String(message.replies)} replies`] : []),
    ...(message.pinned ? ['pinned'] : []),
    ...(message.editedAt ? ['edited'] : []),
    ...reactions,
    ...(message.deleted ? ['deleted'] : []),
  ].join(' · ')
  if (message.deleted) return `- ${head}`

  const words = [
    message.body,
    ...(message.files.length
      ? [`[files: ${message.files.map((one) => one.name).join(', ')}]`]
      : []),
    ...(message.poll
      ? [`[poll: ${message.poll.question} | ${message.poll.answers.join(' | ')}]`]
      : []),
    ...(message.preview ? [`[link: ${message.preview.title} ${message.preview.url}]`] : []),
  ]
    .filter(Boolean)
    .join('\n')
  if (mine) return `- ${head}\n${words}`
  return `- ${head}\n${untrusted(`chat:${chat} from:${name}`, words)}`
}

/** A run of one chat's messages, oldest first. */
export function messagesText(chat: string, messages: readonly Message[], reading: Reading): string {
  if (!messages.length) return `#${chat} has no messages here.`
  return [`#${chat}`, ...messages.map((one) => messageText(chat, one, reading))].join('\n')
}

/** Search hits across chats, newest first, each under its chat's name. */
export function hitsText(
  hits: readonly { chat: string; message: Message }[],
  reading: Reading,
): string {
  if (!hits.length) return 'Nothing found.'
  return hits
    .map((one) => `- #${one.chat} · ${messageText(one.chat, one.message, reading).slice(2)}`)
    .join('\n')
}
