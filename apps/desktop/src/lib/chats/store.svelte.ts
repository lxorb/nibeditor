/** The chats' store: the one place every surface reads a chat from and says anything in
 *  one (docs/chats.md 4.4, 4.5, 4.12 and 6.1). The shapes are ./api.ts.
 *
 *  Started after the launch (start.svelte.ts), for anybody signed in, on sync v1 and v2
 *  alike: the account's list of chats (`GET /v2/chats`), joined with the pointers this
 *  device holds, kept current by the hub's pokes; the device's store of every chat's
 *  messages (the crate's on a desktop and a phone, memory in the browser), caught up in
 *  the background; and the outbox. A chat opened is a `View` (view.svelte.ts), the same
 *  one for every surface that holds it, with a socket while any does. */

import {
  type Event,
  type FileRef,
  type Message,
  type Meta,
  mentionsIn,
  type Notify,
  parseSearch,
  type Post,
  type Preview,
  type SearchQuery,
  matches,
  ulid,
  type Who,
} from '@nib/chats'
import { MOST_FILES, UNSEND_WITHIN } from '@nib/chats/limits'
import { chatPokeOf } from '@nib/chats/wire'
import { account } from '../account.svelte'
import { within } from '../space-paths'
import { keep, storedText } from '../stored'
import { sync } from '../sync.svelte'
import { isNative } from '../tauri'
import { workspace } from '../workspace.svelte'
import type { ChatEntry, ChatMember, Chats, ChatView, Draft, Hit, Scheduled } from './api'
import { type ChatCache, MemoryCache } from './cache'
import { ChatEngine, type Remote } from './engine'
import * as http from './http'
import { chatName, findPointers, makePointer, type Place, readPointer } from './pointers'
import { type Host, View } from './view.svelte'

/** The reader's switch for read receipts, reciprocal (4.10): off, nobody sees theirs and
 *  they see nobody's. */
const RECEIPTS = 'nib:chat-receipts'

/** How often the pointers are looked for again when a chat turns up without one. */
const LOOK_AGAIN = 30_000

/** The account, over HTTP, as the engine asks it. */
const remote: Remote = {
  list: () => http.listChats(),
  events: (chat, after) => http.eventsOf(chat, { after }),
  state: (chat, before) => http.stateOf(chat, before),
  async post(chat, events) {
    try {
      return await http.postEvents(chat, events)
    } catch {
      // Refused whole: the chat is not this account's to write in any more.
      return 'gone'
    }
  },
  read: (chat, seq, back) => http.postRead(chat, seq, back).catch(() => false),
}

/** A new id: a ULID made now. */
function newId(): string {
  return ulid(Date.now(), Math.random)
}

/** The day a moment is on, where the reader is. */
function dayOf(at: number): string {
  const date = new Date(at)
  const pad = (one: number) => String(one).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The first moment of a reader's day. */
function startOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getTime()
}

class ChatsStore implements Chats {
  list = $state.raw<ChatEntry[]>([])
  ready = $state(false)

  private engine: ChatEngine | null = null
  private cache: ChatCache | null = null
  private account: string | null = null
  private readonly views = new Map<string, { view: View; holds: number }>()
  private places = new Map<string, Place>()
  private readonly unread = new Map<string, number>()
  private readonly drafts = new Map<string, string>()
  private readonly people = new Map<string, Promise<ChatMember[]>>()
  private readonly listeners = new Set<() => void>()
  private readonly arrivals = new Set<(chat: string, messages: readonly Message[]) => void>()
  private lookedAt = 0
  private stops: (() => void)[] = []

  get me(): Who | null {
    if (account.user) return `user:${account.user.id}`
    if (account.guest) return `guest:${account.guest.id}`
    return null
  }

  /** Starts for the session signed in now, by its account's or guest's id; a different
   *  one is stopped first. */
  async start(id: string | null): Promise<void> {
    if (id === this.account) return
    this.stop()
    if (!id) return
    this.account = id

    let cache: ChatCache = new MemoryCache()
    if (isNative && account.user) {
      const { nativeCache } = await import('./native-cache')
      cache = nativeCache(id)
    }
    const engine = new ChatEngine(cache, remote, () => this.me)
    await engine.load().catch(() => undefined)
    if (this.account !== id) return
    this.cache = cache
    this.engine = engine
    for (const one of await cache.drafts().catch(() => [])) this.drafts.set(one.chat, one.text)

    this.stops.push(
      engine.listen((change) => {
        if (change.t === 'messages') {
          this.countLater(change.chat)
          if (change.arrived.length)
            for (const hear of this.arrivals) hear(change.chat, change.arrived)
        }
        if (change.t === 'list') this.drawList()
      }),
    )
    this.drawList()
    engine.flushAll().catch(() => undefined)
    await engine.refresh()
    this.ready = true
    await this.lookForPointers()
  }

  /** The session ended: everything of it goes, the device's store too. */
  async forget(): Promise<void> {
    const cache = this.cache
    this.stop()
    await cache?.forget().catch(() => undefined)
  }

  private stop(): void {
    for (const stop of this.stops.splice(0)) stop()
    for (const { view } of this.views.values()) view.close()
    this.views.clear()
    this.engine?.stop()
    this.engine = null
    this.cache = null
    this.account = null
    this.places = new Map()
    this.unread.clear()
    this.drafts.clear()
    this.people.clear()
    this.list = []
    this.ready = false
  }

  /** The hub or the network came back: pokes may have been missed, so the list is asked
   *  again, and whatever waited is sent. */
  async reconnected(): Promise<void> {
    const engine = this.engine
    if (!engine) return
    await engine.flushAll()
    await engine.refresh()
  }

  /** A folder or a space moved: the pointers are looked for again. */
  lookAgain(): Promise<void> {
    return this.engine ? this.lookForPointers() : Promise.resolve()
  }

  /** The hub's `chat` frame, read with its check. */
  poked(said: unknown): void {
    const poke = chatPokeOf(said)
    if (poke) this.engine?.poked(poke)
  }

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** New messages by others, once the device holds them: what notifications read. */
  heard(listener: (chat: string, messages: readonly Message[]) => void): () => void {
    this.arrivals.add(listener)
    return () => this.arrivals.delete(listener)
  }

  entry(chat: string): ChatEntry | null {
    return this.list.find((one) => one.id === chat) ?? null
  }

  private drawList(): void {
    const engine = this.engine
    if (!engine) return
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read in this call
    const spaces = new Map<string, string>()
    const entries: ChatEntry[] = []
    for (const chat of engine.chats.values()) {
      const row = chat.row
      if (!row) continue
      const place = this.places.get(chat.id) ?? null
      let root = place?.root ?? spaces.get(row.space) ?? null
      if (!root) {
        root = workspace.spaces.find((one) => this.remoteOf(one.root) === row.space)?.root ?? null
        if (root) spaces.set(row.space, root)
      }
      const behind = row.lastSeq > row.readSeq && row.lastBy !== this.me
      entries.push({
        id: chat.id,
        space: row.space,
        root,
        path: place?.path ?? null,
        name: place ? chatName(place.path) : null,
        role: row.role,
        members: row.members,
        lastSeq: row.lastSeq,
        lastAt: row.lastAt,
        lastBy: row.lastBy,
        readSeq: row.readSeq,
        unread: Math.max(this.unread.get(chat.id) ?? 0, behind && chat.seq < row.lastSeq ? 1 : 0),
        mentions: row.mentions,
        notify: row.notify,
        mutedUntil: row.mutedUntil,
        meta: row.meta,
      })
    }
    entries.sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
    this.list = entries
    for (const listener of this.listeners) listener()
    if (entries.some((one) => !one.path) && Date.now() - this.lookedAt > LOOK_AGAIN) {
      void this.lookForPointers()
    }
  }

  /** A space's id on the account: the same under either sync. */
  private remoteOf(root: string): string | null {
    return sync.remoteIdFor(root)
  }

  private counting = new Set<string>()

  /** A chat's unread count, worked out from the store once it settles. */
  private countLater(chat: string): void {
    if (this.counting.has(chat)) return
    this.counting.add(chat)
    queueMicrotask(() => void this.count(chat))
  }

  private async count(chat: string): Promise<void> {
    {
      this.counting.delete(chat)
      const engine = this.engine
      const me = this.me
      const row = engine?.chats.get(chat)?.row
      if (!engine || !me || !row || !this.cache) return
      const count = await this.cache.unread(chat, row.readSeq, me).catch(() => 0)
      if (this.unread.get(chat) === count) return
      this.unread.set(chat, count)
      this.drawList()
    }
  }

  private async lookForPointers(): Promise<void> {
    this.lookedAt = Date.now()
    const found = await findPointers().catch(() => null)
    if (!found || !this.engine) return
    this.places = found
    this.drawList()
  }

  // -------------------------------------------------------------------------
  // Opening

  open(chat: string): ChatView {
    const held = this.views.get(chat)
    if (held) {
      held.holds += 1
      return held.view
    }
    const view = new View(chat, this.host())
    this.views.set(chat, { view, holds: 1 })
    void view.open()
    for (const one of this.list) if (one.id === chat) this.countLater(chat)
    return view
  }

  private host(): Host {
    const engine = this.engine
    const cache = this.cache
    if (!engine || !cache) throw new Error('chats have not started')
    return {
      engine,
      cache,
      me: () => this.me ?? 'user:nobody',
      entry: (chat) => this.entry(chat),
      token: () => account.token,
      device: async () => {
        const { hub, deviceId } = await import('../sync2/hub.svelte')
        return hub.device ?? (await deviceId().catch(() => null))
      },
      members: (chat) => this.members(chat),
      receipts: () => storedText(RECEIPTS) !== 'off',
      profile: (who) => {
        if (!who.startsWith('user:')) return
        void import('../people/people.svelte').then(({ people }) => people.refresh(who.slice(5)))
        this.people.clear()
      },
      closed: (chat) => this.views.delete(chat),
    }
  }

  // -------------------------------------------------------------------------
  // Saying things

  async send(chat: string, event: Event): Promise<void> {
    const engine = this.engine
    if (!engine) throw new Error('chats have not started')
    await engine.queue(chat, event)
  }

  private async postOf(chat: string, draft: Draft): Promise<Post> {
    const members = await this.members(chat).catch(() => [])
    const mentions = mentionsIn(
      draft.body,
      members.map((one) => ({ who: one.who, name: one.name ?? '' })),
    )
    const post: Post = { kind: 'post', id: newId(), message: newId(), body: draft.body }
    if (draft.parent) post.parent = draft.parent
    if (draft.quote) post.quote = draft.quote
    if (draft.files?.length) post.files = draft.files.slice(0, MOST_FILES)
    if (draft.poll) post.poll = draft.poll
    if (draft.preview) post.preview = draft.preview
    if (draft.via) post.via = draft.via
    if (draft.parent && draft.alsoToChat) post.alsoToChat = true
    if (mentions.length) post.mentions = mentions
    return post
  }

  async post(chat: string, draft: Draft): Promise<string> {
    const post = await this.postOf(chat, draft)
    await this.send(chat, post)
    this.keepDraft(chat, '')
    return post.message
  }

  async schedule(chat: string, draft: Draft, sendAt: number): Promise<string> {
    const post = await this.postOf(chat, draft)
    await this.send(chat, { kind: 'schedule', id: newId(), sendAt, post })
    this.keepDraft(chat, '')
    return post.message
  }

  async scheduled(chat: string): Promise<Scheduled[]> {
    return (await http.scheduledOf(chat)) ?? []
  }

  edit(chat: string, message: string, body: string, files?: FileRef[]): Promise<void> {
    return this.send(chat, {
      kind: 'edit',
      id: newId(),
      target: message,
      body,
      ...(files ? { files } : {}),
    })
  }

  async remove(chat: string, message: string): Promise<void> {
    // A post the account has not placed is taken out of the outbox, with everything
    // said about it since: it never happened anywhere else.
    const engine = this.engine
    const waiting = engine?.pending(chat).filter((row) => {
      const event = row.event
      return event.kind === 'post'
        ? event.message === message
        : 'target' in event && event.target === message
    })
    if (engine && waiting?.some((row) => row.event.kind === 'post')) {
      await engine.drop(waiting.map((row) => row.id))
      return
    }
    await this.send(chat, { kind: 'delete', id: newId(), target: message })
  }

  react(chat: string, message: string, emoji: string, on: boolean): Promise<void> {
    return this.send(chat, { kind: 'react', id: newId(), target: message, emoji, on })
  }

  pin(chat: string, message: string, on: boolean): Promise<void> {
    return this.send(chat, { kind: 'pin', id: newId(), target: message, on })
  }

  vote(chat: string, message: string, answers: number[]): Promise<void> {
    return this.send(chat, { kind: 'vote', id: newId(), target: message, answers })
  }

  setMeta(chat: string, meta: Partial<Meta>): Promise<void> {
    return this.send(chat, { kind: 'meta', id: newId(), ...meta })
  }

  async unsend(chat: string): Promise<string | null> {
    const engine = this.engine
    const me = this.me
    const cache = this.cache
    if (!engine || !me || !cache) return null
    const now = Date.now()
    const waiting = engine
      .pending(chat)
      .filter((row) => row.event.kind === 'post' && now - row.madeAt <= UNSEND_WITHIN)
      .at(-1)
    if (waiting?.event.kind === 'post') {
      const body = waiting.event.body
      await this.remove(chat, waiting.event.message)
      return body
    }
    const last = (await cache.window({ chat, limit: 20 }))
      .map((one) => one.message)
      .filter((one) => one.author === me && !one.deleted && now - one.at <= UNSEND_WITHIN)
      .at(-1)
    if (!last) return null
    await this.remove(chat, last.id)
    return last.body
  }

  /** The outbox rows about one message. */
  private rowsAbout(chat: string, message: string) {
    return (this.engine?.pending(chat) ?? []).filter((row) => {
      const event = row.event
      if (event.kind === 'post') return event.message === message
      return 'target' in event && event.target === message
    })
  }

  async retry(chat: string, message: string): Promise<void> {
    await this.engine?.retry(this.rowsAbout(chat, message).map((row) => row.id))
  }

  async discard(chat: string, message: string): Promise<void> {
    const rows = this.rowsAbout(chat, message).filter((row) => row.refused)
    await this.engine?.drop(rows.map((row) => row.id))
  }

  async notifyFor(chat: string, notify: Notify | null, mutedUntil: number | null): Promise<void> {
    await http.putMe(chat, notify, mutedUntil)
    const row = this.engine?.chats.get(chat)?.row
    const engineChat = this.engine?.chats.get(chat)
    if (row && engineChat) {
      engineChat.row = { ...row, notify, mutedUntil }
      this.drawList()
    }
  }

  members(chat: string): Promise<ChatMember[]> {
    let asked = this.people.get(chat)
    if (!asked) {
      asked = http.membersOf(chat).then((members) => {
        if (!members) this.people.delete(chat)
        return members ?? []
      })
      this.people.set(chat, asked)
    }
    return asked
  }

  // -------------------------------------------------------------------------
  // Searching

  parse(query: string): SearchQuery {
    return parseSearch(query, dayOf(Date.now()))
  }

  async search(query: string, chat?: string): Promise<Hit[]> {
    const cache = this.cache
    const me = this.me
    if (!cache || !me) return []
    if (!isNative) return (await http.searchOnAccount(query, chat)) ?? []

    const asked = this.parse(query)
    const names = new Map(this.list.map((one) => [one.id, one.name ?? '']))
    const inChats = asked.in.length
      ? this.list
          .filter((one) =>
            asked.in.some((name) => name.toLowerCase() === (one.name ?? '').toLowerCase()),
          )
          .map((one) => one.id)
      : []
    if (asked.in.length && !inChats.length) return []
    const chats = chat ? [chat] : inChats

    const candidates = await cache.search({
      chats,
      words: asked.words,
      phrases: asked.phrases,
      has: asked.has,
      reply: asked.isReply,
      ...(asked.since ? { since: startOf(asked.since) } : {}),
      ...(asked.until ? { until: startOf(asked.until) } : {}),
      limit: 2000,
    })
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and read in this call
    const known = new Map<Who, string[]>()
    for (const id of new Set(candidates.map((one) => one.chat))) {
      for (const member of await this.members(id).catch(() => [])) {
        if (member.name) known.set(member.who, [member.name])
      }
    }
    if (account.name) known.set(me, [account.name])
    return candidates
      .filter(({ chat: id, kept }) =>
        matches(asked, {
          message: kept.message,
          chat: names.get(id) ?? '',
          me,
          namesOf: (who) => known.get(who) ?? [],
          dayOf,
        }),
      )
      .slice(0, 100)
      .map(({ chat: id, kept }) => ({ chat: id, message: kept.message }))
  }

  // -------------------------------------------------------------------------
  // Drafts, files, previews, pointers

  draft(chat: string): string {
    return this.drafts.get(chat) ?? ''
  }

  keepDraft(chat: string, text: string): void {
    if ((this.drafts.get(chat) ?? '') === text) return
    if (text) this.drafts.set(chat, text)
    else this.drafts.delete(chat)
    void this.cache
      ?.write([
        text ? { t: 'draft', draft: { chat, text, at: Date.now() } } : { t: 'undraft', chat },
      ])
      .catch(() => undefined)
  }

  async upload(bytes: Uint8Array): Promise<string | null> {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
    const hash = [...new Uint8Array(digest)]
      .map((one) => one.toString(16).padStart(2, '0'))
      .join('')
    return (await http.putBlob(hash, bytes)) ? hash : null
  }

  private readonly urls = new Map<string, Promise<string | null>>()

  fileUrl(chat: string, hash: string): Promise<string | null> {
    const key = `${chat}/${hash}`
    let url = this.urls.get(key)
    if (!url) {
      url = http.fileOf(chat, hash).then((blob) => (blob ? URL.createObjectURL(blob) : null))
      this.urls.set(key, url)
    }
    return url
  }

  async preview(url: string): Promise<Preview | null> {
    const { previewOf } = await import('./preview')
    return previewOf(url, (bytes) => this.upload(bytes))
  }

  async make(folder: string, name: string): Promise<string | null> {
    const place = await makePointer(folder, name)
    if (!place) return null
    const chat = await readPointer(place.path)
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- `list` is what renders
    if (chat) this.places = new Map(this.places).set(chat, place)
    await this.engine?.refresh()
    return place.path
  }

  chatAt(path: string): Promise<string | null> {
    return readPointer(path)
  }

  /** The reader's switch for receipts. */
  get receipts(): boolean {
    return storedText(RECEIPTS) !== 'off'
  }

  set receipts(on: boolean) {
    keep(RECEIPTS, on ? 'on' : 'off')
  }

  /** A pointer moved, came or went on this device (workspace/file-ops.ts): where its
   *  chat is now. A move into another space moves the chat on the account. */
  async pointerMoved(from: string | null, to: string | null): Promise<void> {
    const before = [...this.places].find(([, place]) => from !== null && place.path === from)
    const chat = to ? await readPointer(to) : null
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- `list` is what renders
    const next = new Map(this.places)
    if (before) next.delete(before[0])
    if (chat && to) {
      const root = workspace.spaces.find((one) => within(one.root, to) !== null)?.root ?? null
      if (root) next.set(chat, { root, path: to })
      const remoteSpace = root ? this.remoteOf(root) : null
      const row = this.engine?.chats.get(chat)?.row
      if (remoteSpace && row && row.space !== remoteSpace) {
        await http.moveChat(chat, remoteSpace).catch(() => false)
        await this.engine?.refresh()
      }
    }
    this.places = next
    this.drawList()
  }
}

export const chats = new ChatsStore()
