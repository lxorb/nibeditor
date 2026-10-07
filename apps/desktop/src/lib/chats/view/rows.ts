/** A chat's messages as the rows the tab draws (docs/chats.md 4.15).
 *
 *  Four things a channel view adds between the messages, all decided here and none in
 *  the markup: a line for each new day, the "New" line where the reader had read to when
 *  they opened the chat, which rows start a group (Discord's: one person within five
 *  minutes is one avatar and one name), and whose read receipts sit under which message
 *  in a chat small enough to have them (Messenger's shape, 4.10).
 *
 *  A message deleted with no replies is no row at all; one with replies stays as a quiet
 *  line, so its replies keep their place. Posts still in the outbox come last, in the
 *  order they were written, grouped like any other.
 *
 *  Pure: what the rows are is arithmetic over the messages, the reader and their
 *  calendar, which a test reads as a list. */

import type { Message, Who } from '@nib/chats'
import { GROUP_WITHIN } from '@nib/chats/limits'

export type Item<M extends Message = Message> =
  | { kind: 'day'; key: string; day: string; at: number }
  | { kind: 'new'; key: 'new' }
  | {
      kind: 'message'
      key: string
      message: M
      /** The first row of a group: drawn with the avatar and the name. */
      head: boolean
      /** Still in the outbox. */
      pending: boolean
      /** Other people whose read place is this message, newest reader last. */
      seen: Who[]
    }

export interface Rowing<M extends Message = Message> {
  /** The chat's messages in `seq` order: the chat's own, and replies sent to it too. */
  messages: readonly M[]
  /** Posts in the outbox, oldest first. */
  outbox: readonly M[]
  me: Who | null
  /** Where the reader had read to when the chat was opened: the New line goes above the
   *  first message after it that somebody else wrote. Null for no line. */
  readAtOpen: number | null
  /** The reader's own calendar day of a time, `YYYY-MM-DD`. */
  dayOf: (at: number) => string
  /** Where each other person has read to; empty where the chat has no receipts. */
  reads: ReadonlyMap<Who, number>
}

/** Whether a message is drawn at all. */
function shown(message: Message): boolean {
  return !message.deleted || message.replies > 0
}

export function rowsOf<M extends Message>(rowing: Rowing<M>): Item<M>[] {
  const { me, readAtOpen, dayOf } = rowing
  const items: Item<M>[] = []
  const placed = rowing.messages.filter(shown)
  const seen = seenAt(placed, rowing.reads, me)

  let lastDay: string | null = null
  let previous: M | null = null
  let lined = readAtOpen === null

  const add = (message: M, pending: boolean) => {
    const day = dayOf(message.at)
    let head = previous === null || startsGroup(previous, message)
    if (day !== lastDay) {
      items.push({ kind: 'day', key: `day:${day}`, day, at: message.at })
      lastDay = day
      head = true
    }
    if (!lined && !pending && message.author !== me && message.seq > (readAtOpen ?? 0)) {
      items.push({ kind: 'new', key: 'new' })
      lined = true
      head = true
    }
    items.push({
      kind: 'message',
      key: message.id,
      message,
      head,
      pending,
      seen: pending ? [] : (seen.get(message.id) ?? []),
    })
    previous = message
  }

  for (const message of placed) add(message, false)
  for (const message of rowing.outbox) add(message, true)
  return items
}

/** Whether `next` starts a new group after `previous`: another person, more than five
 *  minutes later, an agent writing where the person did not (or the other way), or a
 *  quiet deleted line on either side. */
function startsGroup(previous: Message, next: Message): boolean {
  return (
    previous.author !== next.author ||
    next.at - previous.at > GROUP_WITHIN ||
    (previous.via?.agent ?? null) !== (next.via?.agent ?? null) ||
    previous.deleted ||
    next.deleted
  )
}

/** For each message, the other people whose read place it is: the newest message at or
 *  before where they read to. A person who read to before the first message drawn is
 *  under nothing on screen. */
function seenAt(
  messages: readonly Message[],
  reads: ReadonlyMap<Who, number>,
  me: Who | null,
): Map<string, Who[]> {
  const out = new Map<string, Who[]>()
  if (reads.size === 0 || messages.length === 0) return out
  const order = [...reads].filter(([who]) => who !== me).sort(([, a], [, b]) => a - b)
  for (const [who, seq] of order) {
    const at = lastAtOrBefore(messages, seq)
    if (at === -1) continue
    const id = messages[at]?.id
    if (id === undefined) continue
    const list = out.get(id) ?? []
    list.push(who)
    out.set(id, list)
  }
  return out
}

/** The index of the last message with `seq` at or before `seq`, by halving; -1 for none. */
function lastAtOrBefore(messages: readonly Message[], seq: number): number {
  let low = 0
  let high = messages.length - 1
  let found = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((messages[middle]?.seq ?? Infinity) <= seq) {
      found = middle
      low = middle + 1
    } else high = middle - 1
  }
  return found
}
