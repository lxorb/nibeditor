/** A chat as the AI sidebar is handed it (docs/chats.md 4.14): `/catchup`, `/reply` and
 *  `@nib` in a chat attach a part of one, the way a note is attached.
 *
 *  The part is the unread one where there is one, else the newest messages, as the
 *  agent's `read_chat` words them (`@nib/chats/agent`): every message the reader did not
 *  write inside an untrusted mark naming the chat and the person, because a chat is
 *  other people's words and a model must never take them for the reader's. It is
 *  headed by a link to where it starts, which an answer can carry, and kept to what a
 *  model is handed of a note: the oldest messages go first when it is longer. */

import { type Message, type Who } from '@nib/chats'
import { messagesText } from '@nib/chats/agent'
import { chatLink } from '@nib/chats/links'
import { chats } from './store.svelte'

/** The most messages a part holds, and the most characters: about what a note is
 *  given (ai/sidebar/gather.ts). */
const MOST_MESSAGES = 200
const MOST_CHARS = 40_000

/** A part of a chat, as an attachment. */
export interface ChatPart {
  label: string
  text: string
}

/** Which part: the unread one alone, or that else the newest. */
export type Part = 'unread' | 'unread-or-newest'

/** The part of a chat a command attaches, or null where there is nothing to attach. */
export async function chatPart(chat: string, part: Part): Promise<ChatPart | null> {
  const entry = chats.entry(chat)
  if (!entry) return null
  const name = entry.name ?? 'chat'
  const newest = await chats.history(chat, { limit: MOST_MESSAGES })
  let messages: Message[] = newest.filter((one) => one.seq > entry.readSeq)
  const unread = messages.some((one) => one.author !== chats.me)
  if (!unread) {
    if (part === 'unread') return null
    messages = newest
  }
  if (!messages.length) return null

  const names = new Map<Who, string>()
  for (const member of await chats.members(chat).catch(() => [])) {
    names.set(member.who, member.name ?? 'Deleted account')
  }
  const reading = { me: chats.me, nameOf: (who: Who) => names.get(who) ?? who }

  // The newest that fit, so a long unread part loses its oldest words, never its newest.
  let text = messagesText(name, messages, reading)
  while (text.length > MOST_CHARS && messages.length > 1) {
    messages = messages.slice(Math.ceil(messages.length / 4))
    text = messagesText(name, messages, reading)
  }
  const first = messages[0]
  const start = first ? chatLink(chat, first.id) : chatLink(chat)
  const head = unread ? `Unread in #${name} from [#${name}](${start})` : `#${name}, from ${start}`
  return { label: `#${name}`, text: `${head}\n${text}` }
}
