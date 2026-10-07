/** A chat's account as the tests meet it: one log, placed by the reducer's rules as
 *  `ChatLog` places it, read in small pages so every device pages, and reachable only
 *  while a device says it is online. What engine.test.ts and view.test.ts run devices
 *  against. */

import {
  apply,
  chatState,
  type Event,
  type Logged,
  type Message,
  mayEvent,
  type Who,
} from '@nib/chats'
import type { ChatRow, EventsPage, Result, StatePage } from '@nib/chats/wire'
import type { Remote } from './engine'
import { keepsRow } from './fold'

export const CHAT = `c_${'a'.repeat(32)}`

export function random(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 2 ** 32
  }
}

/** The account: one chat's log, placed by the reducer's rules, read in small pages so
 *  every device pages. */
export class Account {
  readonly log: Logged[] = []
  private clock = 1_000_000

  state(): Map<string, Message> {
    const state = chatState()
    for (const event of this.log) apply(state, event)
    return state.messages
  }

  head(): number {
    return this.log.at(-1)?.seq ?? 0
  }

  place(who: Who, event: Event): Result {
    const had = this.log.find((one) => one.id === event.id)
    if (had) return { id: event.id, seq: had.seq, at: had.at }
    const messages = this.state()
    const target = 'target' in event ? messages.get(event.target) : undefined
    if ('target' in event && (!target || target.deleted)) return { id: event.id, refused: 'gone' }
    if (event.kind === 'post') {
      if (messages.has(event.message)) return { id: event.id, refused: 'invalid' }
      if (event.parent && messages.get(event.parent)?.deleted !== false) {
        return { id: event.id, refused: 'gone' }
      }
    }
    if (!mayEvent('write', event, target?.author === who, 'writers')) {
      return { id: event.id, refused: 'role' }
    }
    this.clock += 1000
    const logged: Logged = { ...event, seq: this.head() + 1, at: this.clock, author: who }
    this.log.push(logged)
    return { id: event.id, seq: logged.seq, at: logged.at }
  }

  remote(who: Who, online: () => boolean): Remote {
    const head = (): ChatRow => ({
      id: CHAT,
      space: 'space',
      role: 'write',
      members: 3,
      lastSeq: this.head(),
      lastAt: this.log.at(-1)?.at ?? null,
      lastBy: this.log.at(-1)?.author ?? null,
      readSeq: 0,
      mentions: 0,
      notify: null,
      mutedUntil: null,
      meta: { topic: '', posting: 'writers', slowmode: 0 },
    })
    const reach = <T>(answer: () => T): Promise<T | null> =>
      Promise.resolve(online() ? answer() : null)
    return {
      list: () => reach(() => ({ chats: [head()] })),
      events: (_chat, after) =>
        reach((): EventsPage => {
          const events = this.log.filter((one) => one.seq > after)
          return { events: events.slice(0, 7), more: events.length > 7 }
        }),
      state: (_chat, before) =>
        reach((): StatePage => {
          const all = [...this.state().values()]
            .filter((one) => keepsRow(one) && one.seq < (before ?? Infinity))
            .sort((a, b) => b.seq - a.seq)
          const page = all.slice(0, 5)
          return {
            messages: page,
            meta: { topic: '', posting: 'writers', slowmode: 0 },
            seq: this.head(),
            next: all.length > 5 ? (page.at(-1)?.seq ?? null) : null,
          }
        }),
      post: (_chat, events) =>
        reach(() => ({ results: events.map((event) => this.place(who, event)) })),
      read: () => reach(() => true).then(Boolean),
    }
  }
}
