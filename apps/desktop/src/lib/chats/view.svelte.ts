/** An open chat, and one message's replies, as the surfaces draw them (docs/chats.md 4.15
 *  and 4.17): a window of messages from the device's store, the outbox drawn over it, and
 *  the chat's socket while it is open.
 *
 *  A window, never the chat: the 100 rows around the read place when it opens, 200 more
 *  as the reader nears either end, at most `MOST_HELD` at once, trimmed at the end the
 *  reader is furthest from. Every change the store says about the chat is put into the
 *  window where it falls - a new message at the end only when the window reaches the end
 *  - so a chat of 100,000 messages costs what its window costs. Every list is replaced,
 *  never changed in place. */

import { type Who } from '@nib/chats'
import { RECEIPTS_UP_TO, TYPING_EVERY, TYPING_SHOWN } from '@nib/chats/limits'
import type {
  ChatEntry,
  ChatMember,
  ChatView,
  MessageList,
  Presence,
  RepliesView,
  Shown,
} from './api'
import type { ChatCache, OutboxRow } from './cache'
import { isMain } from './cache'
import type { Change, ChatEngine } from './engine'
import type { Kept } from './fold'
import { type Filter, overlay } from './overlay'
import { ChatSocket } from './socket'

/** Rows a window opens with, pages by, and holds at most (4.17). */
const OPENING = 100
const PAGE = 200
const MOST_HELD = 1000

/** What a view needs from the store that made it. */
export interface Host {
  engine: ChatEngine
  cache: ChatCache
  me(): Who
  entry(chat: string): ChatEntry | null
  /** The account's session, for the socket. */
  token(): string | null
  device(): Promise<string | null>
  members(chat: string): Promise<ChatMember[]>
  /** Whether the reader shows and is shown read receipts. */
  receipts(): boolean
  /** Somebody changed their profile. */
  profile(who: Who): void
  /** One holder let the view go: answers whether it was the last. */
  release(chat: string): boolean
}

/** A window of one list of a chat, kept current. */
class Listing implements MessageList {
  messages = $state.raw<Shown[]>([])
  pending = $state.raw<Shown[]>([])
  atStart = $state(false)
  atEnd = $state(true)
  loading = $state(false)

  /** The placed window, oldest first. */
  protected window: Kept[] = []
  private readonly listeners = new Set<() => void>()
  private drawing = 0

  constructor(
    readonly chat: string,
    protected readonly host: Host,
    private readonly scope: string | undefined,
  ) {}

  /** Which messages this list draws. */
  protected readonly filter: Filter = (message) =>
    this.scope === undefined ? isMain(message) : message.parent === this.scope

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The store said something about this chat. */
  heard(change: Change): void {
    if (change.t === 'outbox') {
      void this.draw()
      return
    }
    if (change.t !== 'messages') return
    let moved = false
    const byId = new Map(this.window.map((one, at) => [one.message.id, at]))
    const next = [...this.window]
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
    const gone = new Set(change.gone)
    for (const one of change.kept) {
      const at = byId.get(one.message.id)
      if (!this.filter(one.message)) {
        if (at !== undefined) gone.add(one.message.id)
        continue
      }
      if (at !== undefined) {
        next[at] = one
        moved = true
        continue
      }
      const first = next[0]?.message.seq ?? Infinity
      const last = next.at(-1)?.message.seq ?? -Infinity
      const seq = one.message.seq
      if ((seq > first && seq < last) || (this.atEnd && seq > last) || next.length === 0) {
        next.push(one)
        moved = true
      }
    }
    if (gone.size) moved = true
    if (!moved) return
    this.window = next
      .filter((one) => !gone.has(one.message.id))
      .sort((a, b) => a.message.seq - b.message.seq)
    if (this.window.length > MOST_HELD) {
      this.window = this.window.slice(-MOST_HELD)
      this.atStart = false
    }
    void this.draw()
  }

  async older(): Promise<void> {
    if (this.atStart || this.loading) return
    const first = this.window[0]?.message.seq
    if (first === undefined) return
    await this.loadingWith(async () => {
      const rows = await this.filled({ before: first, limit: PAGE }, (some) => some.length >= PAGE)
      this.atStart = rows.length < PAGE && this.complete()
      this.window = [...rows, ...this.window]
      if (this.window.length > MOST_HELD) {
        this.window = this.window.slice(0, MOST_HELD)
        this.atEnd = false
      }
    })
  }

  async newer(): Promise<void> {
    if (this.atEnd || this.loading) return
    const last = this.window.at(-1)?.message.seq ?? 0
    await this.loadingWith(async () => {
      const rows = await this.rows({ after: last, limit: PAGE })
      this.atEnd = rows.length < PAGE
      this.window = [...this.window, ...rows]
      if (this.window.length > MOST_HELD) {
        this.window = this.window.slice(-MOST_HELD)
        this.atStart = false
      }
    })
  }

  async latest(): Promise<void> {
    await this.loadingWith(async () => {
      const rows = await this.filled({ limit: OPENING }, (some) => some.length >= OPENING)
      this.window = rows
      this.atEnd = true
      this.atStart = rows.length < OPENING && this.complete()
    })
  }

  /** The window around one place. */
  protected async around(seq: number): Promise<void> {
    await this.loadingWith(async () => {
      const half = OPENING / 2
      const older = (some: readonly Kept[]) => some.filter((one) => one.message.seq < seq).length
      const rows = await this.filled({ around: seq, limit: OPENING }, (some) => older(some) >= half)
      this.window = rows
      const before = older(rows)
      const after = rows.length - before
      this.atStart = before < half && this.complete()
      this.atEnd = after < OPENING - half
    })
  }

  private complete(): boolean {
    return this.host.engine.chats.get(this.chat)?.complete === true
  }

  /** Rows from the store, the account's older pages filled in first while the store
   *  has fewer than `enough` asks for. */
  private async filled(
    where: { before?: number; around?: number; limit: number },
    enough: (rows: readonly Kept[]) => boolean,
  ): Promise<Kept[]> {
    let rows = await this.rows(where)
    while (!enough(rows) && (await this.host.engine.fill(this.chat))) rows = await this.rows(where)
    return rows
  }

  private rows(where: { before?: number; after?: number; around?: number; limit: number }) {
    return this.host.cache.window({
      chat: this.chat,
      ...(this.scope === undefined ? {} : { parent: this.scope }),
      ...where,
    })
  }

  private async loadingWith(work: () => Promise<void>): Promise<void> {
    this.loading = true
    try {
      await work()
    } finally {
      this.loading = false
      await this.draw()
    }
  }

  /** The window and the outbox, drawn: the latest call's answer wins. */
  protected async draw(): Promise<void> {
    const turn = ++this.drawing
    const outbox: readonly OutboxRow[] = this.host.engine.pending(this.chat)
    const { messages, pending } = await overlay(this.window, outbox, this.host.me(), this.filter)
    if (turn !== this.drawing) return
    this.messages = messages
    this.pending = pending
    for (const listener of this.listeners) listener()
  }
}

class Replies extends Listing implements RepliesView {
  parent = $state.raw<Shown | null>(null)

  constructor(
    chat: string,
    host: Host,
    private readonly parentId: string,
    private readonly done: (replies: Replies) => void,
  ) {
    super(chat, host, parentId)
  }

  async open(): Promise<void> {
    await this.latest()
    await this.drawParent()
  }

  override heard(change: Change): void {
    super.heard(change)
    if (change.t === 'messages' && change.kept.some((one) => one.message.id === this.parentId))
      void this.drawParent()
  }

  private async drawParent(): Promise<void> {
    const [kept] = await this.host.cache.messages(this.chat, [this.parentId])
    const { messages } = await overlay(
      kept ? [kept] : [],
      this.host.engine.pending(this.chat),
      this.host.me(),
      () => true,
    )
    this.parent = messages[0] ?? null
  }

  close(): void {
    this.done(this)
  }
}

export class View extends Listing implements ChatView {
  members = $state.raw<ChatMember[]>([])
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never changed
  presence = $state.raw<Presence>({ here: [], typing: [], reads: new Map<Who, number>() })
  lineAt = $state(0)

  private socket: ChatSocket | null = null
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is told; nothing renders from it
  private readonly replying = new Set<Replies>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- `presence` is what renders
  private readonly reads = new Map<Who, number>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly typists = new Map<string, { who: Who; parent?: string; until: number }>()
  private typingTimer: ReturnType<typeof setTimeout> | undefined
  private typedAt = 0
  private stopListening: (() => void) | null = null
  private closed = false

  constructor(chat: string, host: Host) {
    super(chat, host, undefined)
    this.lineAt = host.entry(chat)?.readSeq ?? 0
    this.stopListening = host.engine.listen((change) => {
      if ('chat' in change && change.chat !== this.chat) return
      this.heard(change)
      for (const one of this.replying) one.heard(change)
    })
  }

  get entry(): ChatEntry | null {
    return this.host.entry(this.chat)
  }

  get meta() {
    return this.entry?.meta ?? { topic: '', posting: 'writers' as const, slowmode: 0 }
  }

  get role() {
    return this.entry?.role ?? null
  }

  /** The rows around the read place from the store, then the socket and the people
   *  once the first frame is drawn, then whatever the store did not have yet. */
  async open(): Promise<void> {
    const head = this.host.engine.chats.get(this.chat)?.seq ?? 0
    if (this.lineAt > 0 && this.lineAt < head) await this.around(this.lineAt + 1)
    else await this.latest()
    setTimeout(() => {
      if (this.closed) return
      void this.connect()
      void this.host.members(this.chat).then((members) => {
        if (!this.closed) {
          this.members = members
          this.drawPresence()
        }
      })
    }, 0)
    await this.host.engine.sync(this.chat)
    if (this.window.length === 0) await this.latest()
  }

  async jump(message: string): Promise<boolean> {
    const engine = this.host.engine
    let [kept] = await this.host.cache.messages(this.chat, [message])
    for (let pages = 0; !kept && pages < 500 && (await engine.fill(this.chat)); pages++) {
      ;[kept] = await this.host.cache.messages(this.chat, [message])
    }
    if (!kept) return false
    // A reply the chat itself does not show is found under the message it answers.
    let seq = kept.message.seq
    if (!isMain(kept.message) && kept.message.parent) {
      const [parent] = await this.host.cache.messages(this.chat, [kept.message.parent])
      seq = parent?.message.seq ?? seq
    }
    await this.around(seq)
    return true
  }

  replies(parent: string): RepliesView {
    const replies = new Replies(this.chat, this.host, parent, (one) => this.replying.delete(one))
    this.replying.add(replies)
    void replies.open()
    return replies
  }

  read(seq: number): void {
    if (!this.host.engine.readTo(this.chat, seq)) return
    if (!this.socket?.read(seq)) this.readLater(seq, false)
  }

  markUnread(seq: number): void {
    const place = Math.max(0, seq - 1)
    this.lineAt = place
    if (this.host.engine.readTo(this.chat, place, true)) this.readLater(place, true)
  }

  typed(parent?: string): void {
    const now = Date.now()
    if (now - this.typedAt < TYPING_EVERY) return
    if (this.socket?.typing(parent)) this.typedAt = now
  }

  /** Let go of by one holder; by the last, the socket goes and the store stops telling
   *  it. */
  close(): void {
    if (this.closed || !this.host.release(this.chat)) return
    this.closed = true
    this.socket?.close()
    this.socket = null
    this.stopListening?.()
    clearTimeout(this.typingTimer)
  }

  private readTimer: ReturnType<typeof setTimeout> | undefined

  /** A read place said over HTTP, once the reader stops scrolling. */
  private readLater(seq: number, back: boolean): void {
    clearTimeout(this.readTimer)
    this.readTimer = setTimeout(() => {
      void this.host.engine.tellRead(this.chat, seq, back)
    }, 500)
  }

  private async connect(): Promise<void> {
    const token = this.host.token()
    if (!token || this.socket || this.closed) return
    const device = await this.host.device()
    if (!this.alive()) return
    const engine = this.host.engine
    this.socket = new ChatSocket(
      this.chat,
      token,
      device,
      () => engine.chats.get(this.chat)?.seq ?? 0,
      {
        events: (events) => void engine.heard(this.chat, events),
        behind: (seq) => engine.behind(this.chat, seq),
        typing: (who, parent) => this.typing(who, parent),
        read: (who, seq) => {
          if (who === this.host.me()) {
            engine.readTo(this.chat, seq)
            return
          }
          this.reads.set(who, seq)
          this.drawPresence()
        },
        here: (who) => {
          this.presence = { ...this.presence, here: who }
        },
        profile: (who) => this.host.profile(who),
        state: (open) => {
          if (!open) {
            this.presence = { ...this.presence, here: [] }
            return
          }
          // Back after a drop: whatever was said meanwhile, and our place.
          void engine.sync(this.chat)
          const readSeq = this.entry?.readSeq
          if (readSeq) this.socket?.read(readSeq)
        },
        ended: () => void engine.refresh(),
      },
    )
  }

  /** Whether a holder still holds it: asked again after every wait. */
  private alive(): boolean {
    return !this.closed
  }

  private typing(who: Who, parent: string | undefined): void {
    if (who === this.host.me()) return
    this.typists.set(`${who}\u0000${parent ?? ''}`, {
      who,
      ...(parent ? { parent } : {}),
      until: Date.now() + TYPING_SHOWN,
    })
    this.drawPresence()
  }

  private drawPresence(): void {
    const now = Date.now()
    for (const [key, one] of this.typists) if (one.until <= now) this.typists.delete(key)
    const typing = [...this.typists.values()].map(({ who, parent }) =>
      parent ? { who, parent } : { who },
    )
    const shown = this.host.receipts() && this.members.length <= RECEIPTS_UP_TO
    this.presence = {
      here: this.presence.here,
      typing,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never changed
      reads: shown ? new Map(this.reads) : new Map<Who, number>(),
    }
    clearTimeout(this.typingTimer)
    const next = Math.min(...[...this.typists.values()].map((one) => one.until))
    if (Number.isFinite(next)) {
      this.typingTimer = setTimeout(() => this.drawPresence(), Math.max(0, next - now))
    }
  }
}
