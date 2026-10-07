/** A chats store in memory, with the client store's shapes (../api.ts): what the
 *  surfaces are tested and photographed against without an account, and what a drive
 *  steers (docs/chats.md 6.2, lane 5).
 *
 *  It keeps the promises the real one makes, by the same code where there is code to
 *  share: every event goes through `apply` from `@nib/chats`, so an edit, a delete, a
 *  reaction, a pin or a vote looks here as it will look from the account; a post waits
 *  in the outbox for a moment before it is placed, drawn as sending; a chat's view is a
 *  window of at most a thousand messages, paged two hundred at a time; a search reads
 *  the language with `parseSearch` and `matches`. `speak` is somebody else writing, for
 *  a drive that needs an arrival.
 *
 *  Never the app's store: nothing builds one but a test, a drive or the screenshots. */

import {
  apply,
  type ChatState,
  chatState,
  type Event,
  type FileRef,
  type Logged,
  type Message,
  type Meta,
  mentionsIn,
  matches,
  type Notify,
  parseSearch,
  type Post,
  type Preview,
  type SearchQuery,
  ulid,
  type Who,
} from '@nib/chats'
import { SvelteMap } from 'svelte/reactivity'
import type {
  ChatEntry,
  ChatMember,
  Chats,
  ChatView,
  Draft,
  Hit,
  Presence,
  RepliesView,
  Scheduled,
  Shown,
} from '../api'
import { dayOf } from './when'

/** Rows a window opens with, pages by, and holds at most: the real store's. */
const OPENING = 100
const PAGE = 200
const MOST_HELD = 1000

interface Held {
  entry: ChatEntry
  state: ChatState
  /** The chat's own messages, in `seq` order, and where each is in that list. */
  ordered: Message[]
  at: Map<string, number>
  members: ChatMember[]
  reads: SvelteMap<Who, number>
  pending: Shown[]
  scheduled: Scheduled[]
  views: Set<FixtureView | FixtureReplies>
  typing: { who: Who; parent?: string }[]
}

/** A random number the same every run, so a fixture's ids are too. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const shown = (message: Message): Shown => ({ ...message, sending: false, refused: null })
const isMain = (message: Message) => message.parent === undefined || message.alsoToChat

export class FixtureChats implements Chats {
  readonly me: Who
  list = $state.raw<ChatEntry[]>([])
  ready = true
  receipts = true
  /** How long a post waits in the outbox before it is placed. */
  delay = 250
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- the fixture's own books; `list` and the views are what draw
  private readonly held = new Map<string, Held>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly drafts = new Map<string, string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly files = new Map<string, string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly listeners = new Set<() => void>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly hearers = new Set<(chat: string, messages: readonly Message[]) => void>()
  private readonly random: () => number
  private readonly now: () => number

  constructor(me: Who, options: { seed?: number; now?: () => number } = {}) {
    this.me = me
    this.random = seeded(options.seed ?? 7)
    this.now = options.now ?? (() => Date.now())
  }

  // ---------------------------------------------------------------------------
  // Steering, for tests and drives

  /** A chat with these people, and nothing said yet. */
  add(name: string, members: ChatMember[], more: Partial<ChatEntry> = {}): string {
    const id = `c_${Array.from({ length: 32 }, () => Math.floor(this.random() * 16).toString(16)).join('')}`
    const entry: ChatEntry = {
      id,
      space: 's_team',
      root: '/spaces/Team',
      path: `/spaces/Team/${name}.chat`,
      name,
      role: 'write',
      members: members.length,
      lastSeq: 0,
      lastAt: null,
      lastBy: null,
      readSeq: 0,
      unread: 0,
      mentions: 0,
      notify: null,
      mutedUntil: null,
      meta: { topic: '', posting: 'writers', slowmode: 0 },
      ...more,
    }
    this.held.set(id, {
      entry,
      state: chatState(),
      ordered: [],
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- an index into `ordered`
      at: new Map(),
      members,
      reads: new SvelteMap(),
      pending: [],
      scheduled: [],
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who to tell
      views: new Set(),
      typing: [],
    })
    this.list = [...this.list, entry]
    return id
  }

  /** An event as somebody placed it at `at`, past the outbox: history being seeded, or
   *  another person writing. */
  place(chat: string, author: Who, event: Event, at = this.now()): void {
    const held = this.must(chat)
    const logged = { ...event, seq: held.state.seq + 1, at, author } as Logged
    const changed = apply(held.state, logged)
    for (const one of changed) {
      if (!isMain(one)) continue
      const index = held.at.get(one.id)
      if (index === undefined) {
        held.at.set(one.id, held.ordered.length)
        held.ordered.push(one)
      } else held.ordered[index] = one
    }
    const entry = { ...held.entry }
    if (event.kind === 'post') {
      entry.lastSeq = logged.seq
      entry.lastAt = at
      entry.lastBy = author
      if (author === this.me) entry.readSeq = logged.seq
      else {
        entry.unread += 1
        if (event.mentions?.includes(this.me)) entry.mentions += 1
      }
    }
    if (event.kind === 'meta') entry.meta = { ...held.state.meta }
    this.setEntry(chat, entry)
    for (const view of held.views) view.refresh()
    if (event.kind === 'post' && author !== this.me) {
      for (const hear of this.hearers) hear(chat, changed)
    }
  }

  /** Somebody else posts words. Answers the message's id. */
  speak(chat: string, author: Who, body: string, more: Partial<Post> = {}): string {
    const message = this.id()
    this.place(chat, author, { kind: 'post', id: this.id(), message, body, ...more })
    return message
  }

  /** Where somebody else has read to. */
  readTo(chat: string, who: Who, seq: number): void {
    this.must(chat).reads.set(who, seq)
    for (const view of this.must(chat).views) view.refresh()
  }

  /** Somebody typing, or stopping. */
  typing(chat: string, who: Who, on: boolean, parent?: string): void {
    const held = this.must(chat)
    held.typing = held.typing.filter((one) => one.who !== who)
    if (on) held.typing.push({ who, ...(parent ? { parent } : {}) })
    for (const view of held.views) view.refresh()
  }

  /** Where the reader has read to, as if read on another device. */
  readHere(chat: string, seq: number, unread = 0): void {
    this.setEntry(chat, { ...this.must(chat).entry, readSeq: seq, unread, mentions: 0 })
  }

  id(): string {
    return ulid(this.now(), this.random)
  }

  must(chat: string): Held {
    const held = this.held.get(chat)
    if (!held) throw new Error(`no chat ${chat}`)
    return held
  }

  ordered(chat: string): readonly Message[] {
    return this.must(chat).ordered
  }

  private setEntry(chat: string, entry: ChatEntry): void {
    this.must(chat).entry = entry
    this.list = this.list.map((one) => (one.id === chat ? entry : one))
    for (const listener of this.listeners) listener()
  }

  // ---------------------------------------------------------------------------
  // The store's shapes

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  heard(listener: (chat: string, messages: readonly Message[]) => void): () => void {
    this.hearers.add(listener)
    return () => this.hearers.delete(listener)
  }

  entry(chat: string): ChatEntry | null {
    return this.list.find((one) => one.id === chat) ?? null
  }

  open(chat: string): ChatView {
    const view = new FixtureView(this, chat)
    void view.open()
    return view
  }

  hold(chat: string, view: FixtureView | FixtureReplies): void {
    this.must(chat).views.add(view)
  }

  release(chat: string, view: FixtureView | FixtureReplies): void {
    this.must(chat).views.delete(view)
  }

  async send(chat: string, event: Event): Promise<void> {
    const held = this.must(chat)
    if (event.kind === 'schedule') {
      held.scheduled.push({ id: event.post.message, sendAt: event.sendAt, post: event.post })
      return
    }
    if (
      event.kind === 'delete' &&
      held.scheduled.some((one) => one.post.message === event.target)
    ) {
      held.scheduled = held.scheduled.filter((one) => one.post.message !== event.target)
      return
    }
    if (event.kind !== 'post') {
      this.place(chat, this.me, event)
      return
    }
    held.pending = [
      ...held.pending,
      { ...outboxMessage(event, this.me, this.now()), sending: true, refused: null },
    ]
    for (const view of held.views) view.refresh()
    await new Promise((done) => setTimeout(done, this.delay))
    held.pending = held.pending.filter((one) => one.id !== event.message)
    this.place(chat, this.me, event)
  }

  private postOf(chat: string, draft: Draft): Post {
    const mentions = mentionsIn(
      draft.body,
      this.must(chat).members.map((one) => ({ who: one.who, name: one.name ?? '' })),
    )
    return {
      kind: 'post',
      id: this.id(),
      message: this.id(),
      body: draft.body,
      ...(draft.parent ? { parent: draft.parent } : {}),
      ...(draft.quote ? { quote: draft.quote } : {}),
      ...(draft.files?.length ? { files: draft.files } : {}),
      ...(draft.poll ? { poll: draft.poll } : {}),
      ...(draft.preview ? { preview: draft.preview } : {}),
      ...(draft.parent && draft.alsoToChat ? { alsoToChat: true } : {}),
      ...(mentions.length ? { mentions } : {}),
    }
  }

  async post(chat: string, draft: Draft): Promise<string> {
    const post = this.postOf(chat, draft)
    this.keepDraft(chat, '')
    await this.send(chat, post)
    return post.message
  }

  async schedule(chat: string, draft: Draft, sendAt: number): Promise<string> {
    const post = this.postOf(chat, draft)
    await this.send(chat, { kind: 'schedule', id: this.id(), sendAt, post })
    return post.message
  }

  scheduled(chat: string): Promise<Scheduled[]> {
    return Promise.resolve([...this.must(chat).scheduled])
  }

  edit(chat: string, message: string, body: string, files?: FileRef[]): Promise<void> {
    return this.send(chat, {
      kind: 'edit',
      id: this.id(),
      target: message,
      body,
      ...(files ? { files } : {}),
    })
  }

  remove(chat: string, message: string): Promise<void> {
    return this.send(chat, { kind: 'delete', id: this.id(), target: message })
  }

  react(chat: string, message: string, emoji: string, on: boolean): Promise<void> {
    return this.send(chat, { kind: 'react', id: this.id(), target: message, emoji, on })
  }

  pin(chat: string, message: string, on: boolean): Promise<void> {
    return this.send(chat, { kind: 'pin', id: this.id(), target: message, on })
  }

  vote(chat: string, message: string, answers: number[]): Promise<void> {
    return this.send(chat, { kind: 'vote', id: this.id(), target: message, answers })
  }

  setMeta(chat: string, meta: Partial<Meta>): Promise<void> {
    return this.send(chat, { kind: 'meta', id: this.id(), ...meta })
  }

  async unsend(chat: string): Promise<string | null> {
    const now = this.now()
    const last = [...this.must(chat).ordered]
      .reverse()
      .find((one) => one.author === this.me && !one.deleted && now - one.at <= 15_000)
    if (!last) return null
    await this.remove(chat, last.id)
    return last.body
  }

  retry(): Promise<void> {
    return Promise.resolve()
  }

  discard(chat: string, message: string): Promise<void> {
    const held = this.must(chat)
    held.pending = held.pending.filter((one) => one.id !== message)
    for (const view of held.views) view.refresh()
    return Promise.resolve()
  }

  notifyFor(chat: string, notify: Notify | null, mutedUntil: number | null): Promise<void> {
    this.setEntry(chat, { ...this.must(chat).entry, notify, mutedUntil })
    return Promise.resolve()
  }

  members(chat: string): Promise<ChatMember[]> {
    return Promise.resolve(this.must(chat).members)
  }

  parse(query: string): SearchQuery {
    return parseSearch(query, dayOf(this.now()))
  }

  search(query: string, chat?: string): Promise<Hit[]> {
    const read = this.parse(query)
    const hits: Hit[] = []
    for (const [id, held] of this.held) {
      if (chat !== undefined && chat !== id) continue
      for (const message of held.state.messages.values()) {
        const hit = {
          message,
          chat: held.entry.name ?? '',
          me: this.me,
          namesOf: (who: Who) =>
            held.members.filter((one) => one.who === who).map((one) => one.name ?? ''),
          dayOf,
        }
        if (matches(read, hit)) hits.push({ chat: id, message })
      }
    }
    return Promise.resolve(hits.sort((a, b) => b.message.at - a.message.at))
  }

  linking(): Promise<Hit[]> {
    return Promise.resolve([])
  }

  draft(chat: string): string {
    return this.drafts.get(chat) ?? ''
  }

  keepDraft(chat: string, text: string): void {
    if (text) this.drafts.set(chat, text)
    else this.drafts.delete(chat)
  }

  upload(bytes: Uint8Array): Promise<string | null> {
    const hash = Array.from({ length: 64 }, () => Math.floor(this.random() * 16).toString(16)).join(
      '',
    )
    this.files.set(hash, URL.createObjectURL(new Blob([bytes.slice()])))
    return Promise.resolve(hash)
  }

  fileUrl(_chat: string, hash: string): Promise<string | null> {
    return Promise.resolve(this.files.get(hash) ?? pictureOf(hash))
  }

  preview(): Promise<Preview | null> {
    return Promise.resolve(null)
  }

  make(folder: string, name: string): Promise<string | null> {
    const id = this.add(name, [{ who: this.me, name: 'Me', role: 'owner' }])
    const path = `${folder}/${name}.chat`
    this.setEntry(id, { ...this.must(id).entry, path })
    return Promise.resolve(path)
  }

  chatAt(path: string): Promise<string | null> {
    return Promise.resolve(this.list.find((one) => one.path === path)?.id ?? null)
  }
}

/** A post as it is drawn from the outbox, before it has a place. */
function outboxMessage(post: Post, author: Who, at: number): Message {
  return {
    id: post.message,
    seq: Number.MAX_SAFE_INTEGER,
    at,
    author,
    body: post.body,
    alsoToChat: post.alsoToChat === true,
    files: post.files ?? [],
    mentions: post.mentions ?? [],
    reactions: {},
    pinned: false,
    history: [],
    deleted: false,
    replies: 0,
    ...(post.parent === undefined ? {} : { parent: post.parent }),
    ...(post.quote === undefined ? {} : { quote: post.quote }),
    ...(post.poll ? { poll: { ...post.poll, votes: {} } } : {}),
    ...(post.preview ? { preview: post.preview } : {}),
  }
}

/** A window of a chat, by the first and last `seq` it holds. */
class FixtureView implements ChatView {
  messages = $state.raw<Shown[]>([])
  pending = $state.raw<Shown[]>([])
  atStart = $state(true)
  atEnd = $state(true)
  loading = $state(true)
  members = $state.raw<ChatMember[]>([])
  presence = $state.raw<Presence>({ here: [], typing: [], reads: new Map() })
  lineAt = $state(0)
  private low = 0
  private high = Infinity
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly store: FixtureChats,
    readonly chat: string,
  ) {
    this.lineAt = store.entry(chat)?.readSeq ?? 0
    store.hold(chat, this)
  }

  get entry(): ChatEntry | null {
    return this.store.entry(this.chat)
  }

  get meta(): Meta {
    return this.entry?.meta ?? { topic: '', posting: 'writers', slowmode: 0 }
  }

  get role() {
    return this.entry?.role ?? null
  }

  open(): Promise<void> {
    const all = this.store.ordered(this.chat)
    const head = all.at(-1)?.seq ?? 0
    if (this.lineAt > 0 && this.lineAt < head) this.around(this.lineAt + 1)
    else this.window(Math.max(0, all.length - OPENING), all.length)
    this.loading = false
    return Promise.resolve()
  }

  /** Holds the messages from index `from` to `to` (not) of the chat's own. */
  private window(from: number, to: number): void {
    const all = this.store.ordered(this.chat)
    if (to - from > MOST_HELD) to = from + MOST_HELD
    this.low = all[from]?.seq ?? 0
    this.high = to >= all.length ? Infinity : (all[to - 1]?.seq ?? Infinity)
    this.refresh()
  }

  private indexOf(seq: number): number {
    const all = this.store.ordered(this.chat)
    let low = 0
    let high = all.length
    while (low < high) {
      const middle = (low + high) >> 1
      if ((all[middle]?.seq ?? 0) < seq) low = middle + 1
      else high = middle
    }
    return low
  }

  private around(seq: number): void {
    const at = this.indexOf(seq)
    const from = Math.max(0, at - OPENING / 2)
    this.window(from, from + OPENING)
  }

  refresh(): void {
    const held = this.store.must(this.chat)
    const all = held.ordered
    const from = this.indexOf(this.low)
    const to = this.high === Infinity ? all.length : this.indexOf(this.high + 1)
    this.messages = all.slice(from, to).map(shown)
    this.atStart = from === 0
    this.atEnd = to >= all.length
    this.pending = held.pending.filter(isMain)
    this.members = held.members
    this.presence = {
      here: [this.store.me],
      typing: [...held.typing],
      reads: held.members.length <= 10 ? new Map(held.reads) : new Map(),
    }
    for (const listener of this.listeners) listener()
  }

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  older(): Promise<void> {
    const from = this.indexOf(this.low)
    const to =
      this.high === Infinity ? this.store.ordered(this.chat).length : this.indexOf(this.high + 1)
    const next = Math.max(0, from - PAGE)
    this.window(next, Math.min(to, next + MOST_HELD))
    return Promise.resolve()
  }

  newer(): Promise<void> {
    const all = this.store.ordered(this.chat)
    const from = this.indexOf(this.low)
    const to = this.high === Infinity ? all.length : this.indexOf(this.high + 1)
    const next = Math.min(all.length, to + PAGE)
    this.window(Math.max(from, next - MOST_HELD), next)
    return Promise.resolve()
  }

  jump(message: string): Promise<boolean> {
    const found = this.store.must(this.chat).state.messages.get(message)
    if (!found) return Promise.resolve(false)
    this.around(found.seq)
    return Promise.resolve(true)
  }

  latest(): Promise<void> {
    const all = this.store.ordered(this.chat)
    this.window(Math.max(0, all.length - OPENING), all.length)
    return Promise.resolve()
  }

  replies(parent: string): RepliesView {
    return new FixtureReplies(this.store, this.chat, parent)
  }

  read(seq: number): void {
    const entry = this.store.entry(this.chat)
    if (entry && seq > entry.readSeq) this.store.readHere(this.chat, seq)
  }

  markUnread(seq: number): void {
    this.lineAt = Math.max(0, seq - 1)
    const unread = this.store.ordered(this.chat).filter((one) => one.seq >= seq).length
    this.store.readHere(this.chat, this.lineAt, unread)
  }

  typed(): void {
    // Nobody else is listening to a fixture.
  }

  close(): void {
    this.store.release(this.chat, this)
  }
}

class FixtureReplies implements RepliesView {
  messages = $state.raw<Shown[]>([])
  pending = $state.raw<Shown[]>([])
  parent = $state.raw<Shown | null>(null)
  atStart = true
  atEnd = true
  loading = false
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly store: FixtureChats,
    private readonly chat: string,
    private readonly id: string,
  ) {
    store.hold(chat, this)
    this.refresh()
  }

  refresh(): void {
    const held = this.store.must(this.chat)
    const all = [...held.state.messages.values()]
    const parent = held.state.messages.get(this.id)
    this.parent = parent ? shown(parent) : null
    this.messages = all
      .filter((one) => one.parent === this.id)
      .sort((a, b) => a.seq - b.seq)
      .map(shown)
    this.pending = held.pending.filter((one) => one.parent === this.id)
    for (const listener of this.listeners) listener()
  }

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close(): void {
    this.store.release(this.chat, this)
  }
}

/** A picture for a hash nobody uploaded: a soft gradient, different for each hash, so a
 *  gallery in a screenshot looks like pictures rather than empty boxes. */
function pictureOf(hash: string): string {
  const hue = (parseInt(hash.slice(0, 2), 16) || 0) * 1.4
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 62%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 50) % 360} 60% 38%)"/></linearGradient></defs>` +
    `<rect width="480" height="320" fill="url(#g)"/>` +
    `<circle cx="360" cy="90" r="38" fill="hsl(${(hue + 30) % 360} 80% 85%)" opacity=".8"/>` +
    `<path d="M0 260 L140 150 L250 240 L330 190 L480 290 L480 320 L0 320 Z" fill="hsl(${hue} 40% 25%)" opacity=".7"/>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** A file of a fixture's own, by a made-up hash. */
export function fixtureFile(random: () => number, more: Omit<FileRef, 'hash'>): FileRef {
  const hash = Array.from({ length: 64 }, () => Math.floor(random() * 16).toString(16)).join('')
  return { hash, ...more }
}
