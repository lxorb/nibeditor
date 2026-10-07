/** A chat's events folded into the messages a device keeps, one at a time and in the
 *  log's order (docs/chats.md 4.5, 4.17).
 *
 *  `apply` in `@nib/chats` is the reducer, and it holds every event about every message
 *  in memory, which is what lets it take events in any order. A device cannot: it keeps
 *  a chat of 100,000 messages in its store and at most a window of them in memory. But a
 *  device never needs any order but the log's: it asks for the events after the place it
 *  holds, and the socket says them in order after `hello`. So this folds each event into
 *  the messages as they stand, by the same rules, and keeps beside each message only what
 *  the next event in order needs that a `Message` does not say: when each reaction and
 *  each vote was last set, which decides the order they are drawn in (`Marks`).
 *
 *  Every kept message says which place of the log it is current to (`upto`), so an event
 *  it already holds - a state page read after the event was placed, a socket and a page
 *  saying the same event - is folded once. The property test holds this to `apply`: the
 *  same events in order give the same messages. */

import type { Logged, Message, Who } from '@nib/chats'

/** When each standing reaction and vote of a message was set, in that order. */
export interface Marks {
  /** `[emoji, who, seq]`. */
  r: [string, Who, number][]
  /** `[who, seq]`. */
  v: [Who, number][]
}

/** A message as a device keeps it. */
export interface Kept {
  message: Message
  /** The log's place this copy is current to. */
  upto: number
  marks: Marks
}

/** What folding needs to read: messages by id, and a message's newest standing reply
 *  but some, which is when its replies last moved once those are deleted. */
export interface Lookup {
  get(id: string): Promise<Kept | undefined>
  newestReply(parent: string, except: ReadonlySet<string>): Promise<Message | undefined>
}

/** What folded events changed: messages as they now stand, those the device no longer
 *  keeps (deleted, with no replies to keep a place for), and the log's place now held. */
export interface Folded {
  kept: Map<string, Kept>
  gone: Set<string>
  seq: number
}

/** The marks of a message that came as it stands (a state page), at the place it was
 *  read at: the order it was drawn in stands, and anything later goes after it. */
export function marksOf(message: Message, upto: number): Marks {
  const r: [string, Who, number][] = []
  for (const [emoji, people] of Object.entries(message.reactions)) {
    for (const who of people) r.push([emoji, who, upto])
  }
  const v = Object.keys(message.poll?.votes ?? {}).map((who): [Who, number] => [who as Who, upto])
  return { r, v }
}

/** Whether a message keeps a row on the device: the server's state keeps a deleted one
 *  only while replies stand under it. */
export function keepsRow(message: Message): boolean {
  return !message.deleted || message.replies > 0
}

/** Folds events, in the log's order, over what `lookup` holds, from the place `since` the
 *  device holds: an event at or before it is in every message already. Each sees what
 *  the ones before it changed. */
export async function foldAll(
  events: readonly Logged[],
  lookup: Lookup,
  since: number,
): Promise<Folded> {
  const kept = new Map<string, Kept>()
  const gone = new Set<string>()
  let seq = since
  const read: Lookup = {
    get: async (id) => (gone.has(id) ? undefined : (kept.get(id) ?? (await lookup.get(id)))),
    newestReply: async (parent, except) => {
      // The replies folded here stand as they are here, whatever the lookup holds.
      const here = [...kept.values()].map((one) => one.message).filter((one) => one.parent === parent)
      const passed = new Set([...except, ...gone, ...here.map((one) => one.id)])
      const there = await lookup.newestReply(parent, passed)
      return [...here.filter((one) => !one.deleted && !except.has(one.id)), ...(there ? [there] : [])]
        .sort((a, b) => b.seq - a.seq)[0]
    },
  }
  for (const event of events) {
    if (event.seq <= seq) continue
    seq = event.seq
    for (const one of await fold(event, read)) {
      if (keepsRow(one.message)) {
        kept.set(one.message.id, one)
        gone.delete(one.message.id)
      } else {
        kept.delete(one.message.id)
        gone.add(one.message.id)
      }
    }
  }
  return { kept, gone, seq }
}

/** One event folded: every message it changed, as it now stands. */
export async function fold(event: Logged, lookup: Lookup): Promise<Kept[]> {
  switch (event.kind) {
    case 'post': {
      if (await lookup.get(event.message)) return []
      const message: Message = {
        id: event.message,
        seq: event.seq,
        at: event.at,
        author: event.author,
        body: event.body,
        alsoToChat: event.alsoToChat === true,
        files: event.files ?? [],
        mentions: event.mentions ?? [],
        reactions: {},
        pinned: false,
        history: [],
        deleted: false,
        replies: 0,
      }
      if (event.parent !== undefined) message.parent = event.parent
      if (event.quote !== undefined) message.quote = event.quote
      if (event.preview) message.preview = event.preview
      if (event.via) message.via = event.via
      if (event.poll) message.poll = { ...event.poll, votes: {} }
      const out: Kept[] = [{ message, upto: event.seq, marks: { r: [], v: [] } }]

      const parent = event.parent === undefined ? undefined : await fresh(lookup, event.parent, event)
      if (parent) {
        const was = parent.message
        out.push({
          ...parent,
          upto: event.seq,
          message: {
            ...was,
            replies: was.replies + 1,
            lastReplyAt: Math.max(was.lastReplyAt ?? event.at, event.at),
          },
        })
      }
      return out
    }

    case 'edit': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const was = kept.message
      if (was.deleted || was.author !== event.author || event.seq <= was.seq) return [touched(kept, event)]
      const message: Message = {
        ...was,
        body: event.body,
        files: event.files ?? was.files,
        editedAt: event.at,
        history: [...was.history, { body: was.body, at: was.editedAt ?? was.at }],
      }
      return [{ ...kept, upto: event.seq, message }]
    }

    case 'delete': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const was = kept.message
      if (was.deleted) return [touched(kept, event)]
      const message: Message = {
        id: was.id,
        seq: was.seq,
        at: was.at,
        author: was.author,
        body: '',
        alsoToChat: was.alsoToChat,
        files: [],
        mentions: [],
        reactions: {},
        pinned: false,
        history: [],
        deleted: true,
        replies: was.replies,
      }
      if (was.parent !== undefined) message.parent = was.parent
      if (was.lastReplyAt !== undefined) message.lastReplyAt = was.lastReplyAt
      const out: Kept[] = [{ message, upto: event.seq, marks: { r: [], v: [] } }]

      const parent = was.parent === undefined ? undefined : await fresh(lookup, was.parent, event)
      if (parent && was.parent !== undefined) {
        const newest = await lookup.newestReply(was.parent, new Set([was.id]))
        const replies = Math.max(0, parent.message.replies - 1)
        const changed: Message = { ...parent.message, replies }
        if (replies > 0 && newest) changed.lastReplyAt = newest.at
        else delete changed.lastReplyAt
        out.push({ ...parent, upto: event.seq, message: changed })
      }
      return out
    }

    case 'react': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      if (kept.message.deleted) return [touched(kept, event)]
      const r = kept.marks.r.filter(([emoji, who]) => emoji !== event.emoji || who !== event.author)
      if (event.on) r.push([event.emoji, event.author, event.seq])
      const reactions: Record<string, Who[]> = {}
      for (const [emoji, who] of r) (reactions[emoji] ??= []).push(who)
      return [
        {
          upto: event.seq,
          marks: { ...kept.marks, r },
          message: { ...kept.message, reactions },
        },
      ]
    }

    case 'pin': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      if (kept.message.deleted) return [touched(kept, event)]
      return [{ ...kept, upto: event.seq, message: { ...kept.message, pinned: event.on } }]
    }

    case 'vote': {
      const kept = await fresh(lookup, event.target, event)
      if (!kept) return []
      const poll = kept.message.poll
      if (kept.message.deleted || !poll) return [touched(kept, event)]
      const answers = [...new Set(event.answers)].sort((a, b) => a - b)
      const takes =
        answers.length > 0 &&
        answers.length === event.answers.length &&
        (poll.several || answers.length === 1) &&
        answers.every((one) => Number.isInteger(one) && one >= 0 && one < poll.answers.length) &&
        (poll.ends === undefined || event.at <= poll.ends)

      // A vote that does not take still sets the person's register, as the reducer's:
      // their earlier vote no longer stands.
      const v = kept.marks.v.filter(([who]) => who !== event.author)
      const votes: Record<Who, number[]> = {}
      for (const [who] of v) {
        const standing = poll.votes[who]
        if (standing) votes[who] = standing
      }
      if (takes) {
        v.push([event.author, event.seq])
        votes[event.author] = answers
      }
      return [
        {
          upto: event.seq,
          marks: { ...kept.marks, v },
          message: { ...kept.message, poll: { ...poll, votes } },
        },
      ]
    }

    case 'meta':
    case 'schedule':
      return []
  }
}

/** A message the event has not been folded into yet, or nothing. */
async function fresh(lookup: Lookup, id: string, event: Logged): Promise<Kept | undefined> {
  const kept = await lookup.get(id)
  return kept && kept.upto < event.seq ? kept : undefined
}

/** A message an event changed nothing of, current to it now. */
function touched(kept: Kept, event: Logged): Kept {
  return { ...kept, upto: event.seq }
}
