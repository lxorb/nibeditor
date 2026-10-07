import { apply, chatState, type Event, type Logged, type Message, type Who } from '@nib/chats'
import { describe, expect, test } from 'vitest'
import { foldAll, keepsRow, type Kept, type Lookup, marksOf } from './fold'
import { random } from './test-account'

const PEOPLE: Who[] = ['user:ana', 'user:ben', 'guest:cy']
const EMOJI = ['👍', '❤️', '👀']

/** A log as the account would place it: every event about a message that exists and is
 *  not deleted, most by people who may, some that change nothing. */
function logOf(seed: number, length: number): Logged[] {
  const next = random(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T
  const live = new Map<string, { author: Who; poll: boolean }>()
  const log: Logged[] = []
  for (let seq = 1; seq <= length; seq++) {
    const author = pick(PEOPLE)
    const at = seq * 1000
    const ids = [...live.keys()]
    const roll = next()
    let event: Event
    if (ids.length === 0 || roll < 0.3) {
      const message = `m${String(seq)}`
      const parent = ids.length && next() < 0.4 ? pick(ids) : undefined
      const poll = next() < 0.15
      event = {
        kind: 'post',
        id: `e${String(seq)}`,
        message,
        body: `words ${String(seq)}`,
        ...(parent ? { parent, ...(next() < 0.3 ? { alsoToChat: true } : {}) } : {}),
        ...(poll
          ? { poll: { question: 'q', answers: ['a', 'b', 'c'], several: next() < 0.5 } }
          : {}),
      }
      live.set(message, { author, poll })
    } else {
      const target = pick(ids)
      const about = live.get(target)
      const id = `e${String(seq)}`
      if (roll < 0.45) {
        event = { kind: 'edit', id, target, body: `edited ${String(seq)}` }
      } else if (roll < 0.55) {
        event = { kind: 'delete', id, target }
        live.delete(target)
      } else if (roll < 0.8) {
        event = { kind: 'react', id, target, emoji: pick(EMOJI), on: next() < 0.75 }
      } else if (roll < 0.88) {
        event = { kind: 'pin', id, target, on: next() < 0.6 }
      } else if (about?.poll) {
        event = { kind: 'vote', id, target, answers: next() < 0.2 ? [] : [pick([0, 1, 2])] }
      } else {
        event = { kind: 'meta', id, topic: `topic ${String(seq)}` }
      }
      // The account refuses an edit of somebody else's message, so none is logged.
      if (event.kind === 'edit' && about) {
        log.push({ ...event, seq, at, author: about.author })
        continue
      }
    }
    log.push({ ...event, seq, at, author })
  }
  return log
}

/** What the reducer says, as a device keeps it: rows that keep a place. */
function reduced(log: readonly Logged[]): Map<string, Message> {
  const state = chatState()
  for (const event of log) apply(state, event)
  return new Map([...state.messages].filter(([, message]) => keepsRow(message)))
}

/** A device's store in memory. */
class Store implements Lookup {
  readonly rows = new Map<string, Kept>()
  seq = 0

  get(id: string): Promise<Kept | undefined> {
    return Promise.resolve(this.rows.get(id))
  }

  newestReply(parent: string, except: ReadonlySet<string>): Promise<Message | undefined> {
    const replies = [...this.rows.values()]
      .map((one) => one.message)
      .filter((one) => one.parent === parent && !except.has(one.id) && !one.deleted)
      .sort((a, b) => b.seq - a.seq)
    return Promise.resolve(replies[0])
  }

  async fold(events: readonly Logged[]): Promise<void> {
    const { kept, gone, seq } = await foldAll(events, this, this.seq)
    this.seq = seq
    for (const [id, one] of kept) this.rows.set(id, one)
    for (const id of gone) this.rows.delete(id)
  }

  messages(): Map<string, Message> {
    return new Map([...this.rows].map(([id, one]) => [id, one.message]))
  }
}

/** Reactions with each emoji's people in a fixed order: what a state page cannot say is
 *  when each was set, so a person setting one they already had is drawn in either
 *  place. */
function settled(messages: Map<string, Message>): Map<string, Message> {
  return new Map(
    [...messages].map(([id, message]) => [
      id,
      {
        ...message,
        reactions: Object.fromEntries(
          Object.entries(message.reactions)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([emoji, people]) => [emoji, [...people].sort()]),
        ),
      },
    ]),
  )
}

describe('folding in order is the reducer', () => {
  test('one event at a time, for many logs', async () => {
    for (let seed = 1; seed <= 200; seed++) {
      const log = logOf(seed, 80)
      const store = new Store()
      for (const event of log) await store.fold([event])
      expect(store.messages(), `seed ${String(seed)}`).toEqual(reduced(log))
    }
  })

  test('in pages of any size, and with a page said twice', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const log = logOf(seed, 120)
      const store = new Store()
      const next = random(seed * 31)
      for (let at = 0; at < log.length;) {
        const size = 1 + Math.floor(next() * 30)
        const page = log.slice(at, at + size)
        await store.fold(page)
        // The socket and a page saying the same events: folded once.
        if (next() < 0.3) await store.fold(page)
        at += size
      }
      expect(store.messages(), `seed ${String(seed)}`).toEqual(reduced(log))
    }
  })

  test('after a first copy of the messages as they stood', async () => {
    for (let seed = 1; seed <= 100; seed++) {
      const log = logOf(seed, 120)
      const cut = 1 + Math.floor(random(seed)() * 100)
      const store = new Store()
      for (const [id, message] of reduced(log.slice(0, cut))) {
        store.rows.set(id, { message, upto: cut, marks: marksOf(message, cut) })
      }
      store.seq = cut
      // The page was read a little later than its head: events it already holds come
      // again and change nothing.
      await store.fold(log.slice(Math.max(0, cut - 5)))
      expect(settled(store.messages()), `seed ${String(seed)}`).toEqual(settled(reduced(log)))
    }
  })
})
