/** What a device does with its chats, apart from any surface (docs/chats.md 4.4, 4.5 and
 *  4.17): keeps the device's store in step with the account, and places what the reader
 *  said through the outbox.
 *
 *  - **Catching up.** Each chat's store holds every event up to one place (`seq`). It asks
 *    the account for the events after it, in pages, and folds them in (fold.ts). A chat
 *    new to the device, or more than `MOST_BEHIND` events behind, takes the messages as
 *    they stand instead, newest first, so it opens at once; the past fills in behind it a
 *    page at a time (`fill`). One chat's work runs one step at a time, so two answers about
 *    one chat never fold over each other.
 *  - **The outbox.** Everything the reader says is written to the outbox before anything
 *    else, so a crash loses nothing; it is drawn at once from there; it goes to the account
 *    in order, a chat at a time, up to fifty events a request, each answered with its place
 *    or why not; and it leaves the outbox once the store has folded the event it became.
 *    Every event has an id the device made, so a resend after a lost answer is the same
 *    event and is placed once. A refusal stays, marked, until the reader retries or lets
 *    it go; a limit (`rate`) and a moment's trouble are tried again on their own.
 *  - **Listening.** The hub's poke moves a chat's head and starts its catch-up; an open
 *    chat's socket hands its events straight in.
 *
 *  Everything it learns it says once, through `listen`, as which messages changed. */

import type { Event, Logged, Message, Meta, Who } from '@nib/chats'
import { MOST_BEHIND } from '@nib/chats/limits'
import {
  type ChatList,
  type ChatPoke,
  eventOf,
  type EventsPage,
  type Results,
  type StatePage,
} from '@nib/chats/wire'
import { roomDelay } from '../backoff'
import type { CacheChange, CachedChat, ChatCache, OutboxRow } from './cache'
import { foldAll, type Kept, type Lookup, marksOf } from './fold'

/** The account, as the engine asks it: http.ts's calls, or a test's own account. */
export interface Remote {
  list(): Promise<ChatList | null>
  events(chat: string, after: number): Promise<EventsPage | null>
  state(chat: string, before?: number): Promise<StatePage | null>
  /** Null for a moment's trouble; `gone` for a chat this account no longer reaches. */
  post(chat: string, events: readonly Event[]): Promise<Results | 'gone' | null>
  read(chat: string, seq: number, back: boolean): Promise<boolean>
}

/** What changed, said once to every listener. */
export type Change =
  /** Messages of one chat as they now stand, those gone from the device, and the new
   *  posts by others among them, in order. */
  | { t: 'messages'; chat: string; kept: Kept[]; gone: string[]; arrived: Message[] }
  /** The outbox of one chat changed. */
  | { t: 'outbox'; chat: string }
  /** The list of chats or a chat's row changed. */
  | { t: 'list' }

/** Events one request carries from the outbox. */
const BATCH = 50

/** How many pages of events one catch-up takes before it hands the chat to the next
 *  turn: a chat far behind does not hold the others up. */
const PAGES_A_TURN = 20

export class ChatEngine {
  /** Every chat the device has heard of, by id. */
  readonly chats = new Map<string, CachedChat>()
  /** The outbox, oldest first. */
  private outbox: OutboxRow[] = []
  /** Events the account placed that the store has not folded yet: where each went. */
  private readonly placed = new Map<string, number>()
  /** One chain of work per chat. */
  private readonly lines = new Map<string, Promise<unknown>>()
  private readonly sending = new Set<string>()
  private readonly retries = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly tries = new Map<string, number>()
  private readonly listeners = new Set<(change: Change) => void>()
  private stopped = false

  constructor(
    private readonly cache: ChatCache,
    private readonly remote: Remote,
    private readonly me: () => Who | null,
    private readonly now: () => number = Date.now,
  ) {}

  /** What the device kept from before: its chats and its outbox. */
  async load(): Promise<void> {
    for (const chat of await this.cache.chats()) this.chats.set(chat.id, chat)
    this.outbox = await this.cache.outbox()
  }

  listen(listener: (change: Change) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  stop(): void {
    this.stopped = true
    for (const timer of this.retries.values()) clearTimeout(timer)
    this.retries.clear()
  }

  private say(change: Change): void {
    for (const listener of this.listeners) listener(change)
  }

  /** Runs `work` after everything already asked of this chat. */
  private line<T>(chat: string, work: () => Promise<T>): Promise<T> {
    const before = this.lines.get(chat) ?? Promise.resolve()
    const next = before.then(work, work)
    this.lines.set(
      chat,
      next.catch(() => undefined),
    )
    return next
  }

  private chatOf(id: string, space = ''): CachedChat {
    let chat = this.chats.get(id)
    if (!chat) {
      chat = { id, space, seq: 0, readSeq: 0, older: null, complete: false, row: null }
      this.chats.set(id, chat)
    }
    return chat
  }

  // -------------------------------------------------------------------------
  // The list

  /** The account's list, taken in: every row kept, a chat no longer listed let go of
   *  (its outbox refused as gone), and every chat behind caught up, one after another.
   *  Answers whether the account answered. */
  async refresh(): Promise<boolean> {
    const listed = await this.remote.list()
    if (!listed || this.stopped) return false
    const ids = new Set(listed.chats.map((row) => row.id))
    const changes: CacheChange[] = []
    for (const row of listed.chats) {
      const chat = this.chatOf(row.id, row.space)
      chat.space = row.space
      chat.row = row
      chat.readSeq = row.readSeq
      changes.push({ t: 'chat', chat: { ...chat } })
    }
    for (const id of [...this.chats.keys()]) {
      if (ids.has(id)) continue
      this.chats.delete(id)
      changes.push({ t: 'forget', chat: id })
      for (const row of this.outbox.filter((one) => one.chat === id && !one.refused)) {
        row.refused = 'gone'
        changes.push({ t: 'queue', row: { ...row } })
      }
    }
    await this.cache.write(changes)
    this.say({ t: 'list' })
    void this.catchUpAll()
    return true
  }

  /** Every chat behind its head, caught up one after another. */
  async catchUpAll(): Promise<void> {
    for (const chat of [...this.chats.values()]) {
      if (this.stopped) return
      if ((chat.row?.lastSeq ?? 0) > chat.seq || (chat.seq === 0 && !chat.complete)) {
        await this.sync(chat.id).catch(() => undefined)
      }
    }
  }

  /** The hub said a chat moved on: its head moves now, and its words follow. */
  poked(poke: ChatPoke): void {
    const chat = this.chats.get(poke.chat)
    if (chat?.row && poke.seq > chat.row.lastSeq) {
      const mine = poke.by === this.me()
      chat.row = {
        ...chat.row,
        lastSeq: poke.seq,
        lastAt: poke.at,
        lastBy: poke.by,
        mentions: chat.row.mentions + (poke.mention && !mine ? 1 : 0),
        readSeq: mine ? Math.max(chat.row.readSeq, poke.seq) : chat.row.readSeq,
      }
      this.say({ t: 'list' })
    }
    if (chat) void this.sync(poke.chat).catch(() => undefined)
    else void this.refresh()
  }

  // -------------------------------------------------------------------------
  // Catching up

  /** The chat's store brought up to the account's head. */
  sync(id: string): Promise<void> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      const head = chat.row?.lastSeq ?? 0
      if ((chat.seq === 0 && !chat.complete) || head - chat.seq > MOST_BEHIND) {
        if (!(await this.firstCopy(chat))) return
      }
      for (let pages = 0; pages < PAGES_A_TURN && !this.stopped; pages++) {
        const page = await this.remote.events(id, chat.seq)
        if (!page) return
        await this.folded(chat, page.events)
        if (!page.more || !page.events.length) return
      }
      // Far behind: the rest on the next turn, after the others.
      void this.sync(id)
    })
  }

  /** Events the chat's socket said, in order: folded at once where they follow the
   *  place held, and fetched from the account where some were missed. */
  heard(id: string, events: readonly Logged[]): Promise<void> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      const first = events[0]
      if (!first) return
      if (first.seq > chat.seq + 1 || (chat.seq === 0 && !chat.complete)) {
        void this.sync(id)
        return
      }
      await this.folded(chat, events)
    })
  }

  /** The socket said the device is too far behind for events. */
  behind(id: string, seq: number): void {
    const chat = this.chatOf(id)
    if (chat.row) chat.row = { ...chat.row, lastSeq: Math.max(chat.row.lastSeq, seq) }
    void this.sync(id)
  }

  /** The messages as they stand, newest first, in place of whatever the device held: a
   *  first copy, or a chat too far behind to catch up by events. */
  private async firstCopy(chat: CachedChat): Promise<boolean> {
    const page = await this.remote.state(chat.id)
    if (!page) return false
    const kept = page.messages.map((message): Kept => ({
      message,
      upto: page.seq,
      marks: marksOf(message, page.seq),
    }))
    chat.seq = page.seq
    chat.older = page.next
    chat.complete = page.next === null
    if (chat.row) chat.row = { ...chat.row, meta: page.meta }
    await this.cache.write([
      { t: 'forget', chat: chat.id },
      { t: 'chat', chat: { ...chat } },
      ...kept.map((one): CacheChange => ({ t: 'message', chat: chat.id, kept: one })),
    ])
    this.settle(chat)
    this.say({ t: 'messages', chat: chat.id, kept, gone: [], arrived: [] })
    return true
  }

  /** One older page of a chat's past into the store; answers whether one came in: not
   *  once the chat's first message is here, before its first copy, or while the account
   *  cannot be reached. */
  fill(id: string): Promise<boolean> {
    return this.line(id, async () => {
      const chat = this.chatOf(id)
      if (chat.complete || (chat.seq === 0 && chat.older === null)) return false
      const page = await this.remote.state(id, chat.older ?? undefined)
      if (!page) return false
      const have = new Set(
        (
          await this.cache.messages(
            id,
            page.messages.map((one) => one.id),
          )
        ).map((one) => one.message.id),
      )
      // As they stood when the page was read, which may be after the place the store
      // holds: the events between are in them already, and `upto` says so.
      const kept = page.messages
        .filter((one) => !have.has(one.id))
        .map((message): Kept => ({ message, upto: page.seq, marks: marksOf(message, page.seq) }))
      chat.older = page.next
      chat.complete = page.next === null
      await this.cache.write([
        { t: 'chat', chat: { ...chat } },
        ...kept.map((one): CacheChange => ({ t: 'message', chat: id, kept: one })),
      ])
      this.say({ t: 'messages', chat: id, kept, gone: [], arrived: [] })
      return true
    })
  }

  /** Events folded into the store, the place moved, the outbox settled, and said. */
  private async folded(chat: CachedChat, events: readonly Logged[]): Promise<void> {
    const id = chat.id
    const lookup: Lookup = {
      get: async (one) => (await this.cache.messages(id, [one]))[0],
      newestReply: async (parent, except) => {
        const replies = await this.cache.window({ chat: id, parent, limit: 50 })
        return replies
          .map((one) => one.message)
          .filter((one) => !one.deleted && !except.has(one.id))
          .at(-1)
      },
    }
    const { kept, gone, seq } = await foldAll(events, lookup, chat.seq)
    if (seq === chat.seq) return

    const me = this.me()
    const fresh = events.filter((one) => one.seq > chat.seq)
    for (const event of fresh) {
      if (event.kind === 'meta' && chat.row)
        chat.row = { ...chat.row, meta: metaWith(chat.row.meta, event) }
      if (event.author === me && chat.row) {
        chat.row = { ...chat.row, readSeq: Math.max(chat.row.readSeq, event.seq) }
      }
    }
    chat.seq = seq
    if (chat.row && seq > chat.row.lastSeq) {
      const last = fresh.at(-1)
      chat.row = {
        ...chat.row,
        lastSeq: seq,
        lastAt: last?.at ?? null,
        lastBy: last?.author ?? null,
      }
    }

    await this.cache.write([
      { t: 'chat', chat: { ...chat } },
      ...[...kept.values()].map((one): CacheChange => ({ t: 'message', chat: id, kept: one })),
      ...[...gone].map((one): CacheChange => ({ t: 'unmessage', chat: id, id: one })),
    ])
    const arrived = fresh.flatMap((event) => {
      if (event.kind !== 'post' || event.author === me) return []
      const message = kept.get(event.message)?.message
      return message ? [message] : []
    })
    this.settle(chat)
    this.say({ t: 'messages', chat: id, kept: [...kept.values()], gone: [...gone], arrived })
    this.say({ t: 'list' })
  }

  // -------------------------------------------------------------------------
  // The outbox

  /** What this device said in a chat that the store does not hold yet, oldest first. */
  pending(chat: string): readonly OutboxRow[] {
    const held = this.chats.get(chat)?.seq ?? 0
    return this.outbox.filter(
      (row) => row.chat === chat && !((this.placed.get(row.id) ?? Infinity) <= held),
    )
  }

  /** The one write path: an event into the outbox, then on its way. */
  async queue(chat: string, event: Event): Promise<void> {
    const checked = eventOf(event)
    if (!checked) throw new Error(`a ${event.kind} the account would not read`)
    const row: OutboxRow = {
      id: checked.id,
      chat,
      event: checked,
      madeAt: this.now(),
      tries: 0,
      refused: null,
    }
    await this.cache.write([{ t: 'queue', row }])
    this.outbox.push(row)
    this.say({ t: 'outbox', chat })
    void this.flush(chat)
  }

  /** Rows let go of: out of the outbox, never sent or never to be. */
  async drop(ids: readonly string[]): Promise<void> {
    const gone = new Set(ids)
    const chats = new Set(this.outbox.filter((row) => gone.has(row.id)).map((row) => row.chat))
    this.outbox = this.outbox.filter((row) => !gone.has(row.id))
    await this.cache.write(ids.map((id): CacheChange => ({ t: 'unqueue', id })))
    for (const chat of chats) this.say({ t: 'outbox', chat })
  }

  /** Refused rows sent again. */
  async retry(ids: readonly string[]): Promise<void> {
    const again = new Set(ids)
    const changes: CacheChange[] = []
    const chats = new Set<string>()
    for (const row of this.outbox) {
      if (!again.has(row.id) || !row.refused) continue
      row.refused = null
      row.tries = 0
      changes.push({ t: 'queue', row: { ...row } })
      chats.add(row.chat)
    }
    await this.cache.write(changes)
    for (const chat of chats) {
      this.say({ t: 'outbox', chat })
      void this.flush(chat)
    }
  }

  /** Every chat with something to send, sent. */
  async flushAll(): Promise<void> {
    await Promise.all(
      [...new Set(this.outbox.map((row) => row.chat))].map((chat) => this.flush(chat)),
    )
  }

  /** A chat's outbox, sent in order a batch at a time, until it is empty, refused, or
   *  the account cannot be reached (then again after a wait). */
  async flush(chat: string): Promise<void> {
    if (this.sending.has(chat) || this.stopped) return
    this.sending.add(chat)
    clearTimeout(this.retries.get(chat))
    this.retries.delete(chat)
    let placedAny = false
    let later = false
    try {
      for (;;) {
        const batch = this.outbox
          .filter((row) => row.chat === chat && !row.refused && !this.placed.has(row.id))
          .slice(0, BATCH)
        if (!batch.length) break
        const answer = await this.remote.post(
          chat,
          batch.map((row) => row.event),
        )
        if (answer === null) {
          later = true
          break
        }
        const changes: CacheChange[] = []
        const dropped: string[] = []
        if (answer === 'gone') {
          for (const row of batch) {
            row.refused = 'gone'
            changes.push({ t: 'queue', row: { ...row } })
          }
        } else {
          const results = new Map(answer.results.map((one) => [one.id, one]))
          for (const row of batch) {
            const result = results.get(row.id)
            if (!result) {
              later = true
            } else if ('refused' in result) {
              if (result.refused === 'rate') {
                later = true
                row.tries += 1
              } else row.refused = result.refused
              changes.push({ t: 'queue', row: { ...row } })
            } else if (result.seq === 0) {
              // Held for its time, or a held post taken back: in no log yet.
              dropped.push(row.id)
            } else {
              this.placed.set(row.id, result.seq)
              placedAny = true
            }
          }
        }
        await this.cache.write(changes)
        if (dropped.length) await this.drop(dropped)
        this.say({ t: 'outbox', chat })
        if (later) break
      }
    } finally {
      this.sending.delete(chat)
    }
    if (later) this.again(chat)
    else this.tries.delete(chat)
    if (!placedAny) return
    // The socket may have folded them already; else the catch-up does.
    const held = this.chats.get(chat)
    if (held) this.settle(held)
    await this.sync(chat)
  }

  private again(chat: string): void {
    if (this.stopped || this.retries.has(chat)) return
    const tries = (this.tries.get(chat) ?? 0) + 1
    this.tries.set(chat, tries)
    this.retries.set(
      chat,
      setTimeout(() => {
        this.retries.delete(chat)
        void this.flush(chat)
      }, roomDelay(tries)),
    )
  }

  /** Placed rows the store now holds, out of the outbox. */
  private settle(chat: CachedChat): void {
    const done = this.outbox
      .filter((row) => row.chat === chat.id && (this.placed.get(row.id) ?? Infinity) <= chat.seq)
      .map((row) => row.id)
    if (!done.length) return
    for (const id of done) this.placed.delete(id)
    void this.drop(done)
  }

  // -------------------------------------------------------------------------
  // Reading

  /** The reader read to `seq`: kept here at once, and told to the account by whoever
   *  calls (the socket, or `remote.read`). Answers whether it moved. */
  readTo(id: string, seq: number, back = false): boolean {
    const chat = this.chats.get(id)
    const row = chat?.row
    if (!chat || !row) return false
    if (back ? seq >= row.readSeq : seq <= row.readSeq) return false
    chat.readSeq = seq
    chat.row = { ...row, readSeq: seq, mentions: seq >= row.lastSeq ? 0 : row.mentions }
    void this.cache.write([{ t: 'chat', chat: { ...chat } }])
    this.say({ t: 'list' })
    return true
  }

  /** A read place told to the account over HTTP, from a chat with no socket open. */
  tellRead(chat: string, seq: number, back: boolean): Promise<boolean> {
    return this.remote.read(chat, seq, back)
  }
}

/** A chat's settings with a `meta` event's keys over them. */
function metaWith(meta: Meta, event: Extract<Event, { kind: 'meta' }>): Meta {
  return {
    topic: event.topic ?? meta.topic,
    posting: event.posting ?? meta.posting,
    slowmode: event.slowmode ?? meta.slowmode,
  }
}
