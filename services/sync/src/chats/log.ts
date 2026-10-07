/** One chat's log: the Durable Object that gives every event of one chat its place in
 *  one order, and holds the chat (docs/chats.md 4.3 and 4.4).
 *
 *  Named by the chat's id, SQLite-backed, hibernating. Everything about who may come in
 *  is decided at the door (door.ts) and by the routes (routes.ts), where the database
 *  is: the object is told who each socket and request is and at what role, and decides
 *  only what that role may do to the log, by `@nib/chats`' own table and reducer
 *  (placing.ts). Its SQLite holds the log, every message as it stands with a full-text
 *  index, the chat's settings, each person's read place, scheduled posts and its
 *  bookkeeping (schema.ts); nothing lives in fields but caches.
 *
 *  What it tells the rest of the service, coalesced so a busy chat costs little:
 *  - the chat's head, settings and each person's read place and mentions, written to D1
 *    at most once a second (`chats`, `chat_reads`), so the Chats panel lists every chat
 *    in one query and wakes no object;
 *  - a `chat` poke (`ChatPoke`) through the hub of every person it reaches who has no
 *    socket open here, at most one every two seconds each, carrying no words;
 *  - the files a post names (`chat_files`), which is what lets its members fetch them.
 *
 *  One alarm carries all three of its waits: the next write to D1, the next poke owed,
 *  and the next scheduled post. */

import type { Event, Logged, Message, Post, Who } from '@nib/chats'
import { MOST_BEHIND, MOST_PAGE, RECEIPTS_UP_TO, TYPING_EVERY } from '@nib/chats/limits'
import { clientFrameOf, isWho, type Refusal, type ServerFrame } from '@nib/chats/wire'
import { BEAT, BEAT_ANSWER } from '@nib/sync-core/wire'
import { places } from '../bound'
import { note } from '../failed'
import { askHub } from '../hub/reach'
import type { Env } from '../types'
import {
  admit,
  type Asker,
  type Effects,
  type EventRow,
  INVALID,
  loggedOf,
  metaOf,
  place,
  placedEvent,
  readMeta,
  ROLE,
  setMeta,
} from './placing'
import { hubIdOf, reachAs, reaching } from './reach'
import { SCHEMA } from './schema'

/** What a route or the door asks the object, named by `x-nib-chat-ask`; see ask.ts. */
export type ChatAsk =
  | 'join'
  | 'send'
  | 'events'
  | 'state'
  | 'message'
  | 'search'
  | 'read'
  | 'scheduled'
  | 'revoke'
  | 'erase'
  | 'profile'

/** A person a request or a socket is from, as the door or the route decided. */
export type Person = Asker & { id: string; guest: boolean }

/** What the door decided about a socket, kept on it across a sleep. */
interface Attached extends Person {
  hello: boolean
  /** When this socket last had a typing frame relayed. */
  typedAt: number
}

/** One answer to one event, to its sender: its place, or why not. A post held for its
 *  time, or taken back before it went, is answered with `seq` 0: it is in no log yet. */
export type Answer = Extract<ServerFrame, { t: 'placed' } | { t: 'refused' }>

/** The most messages one page of state answers, and the most bytes it holds (4.4). */
const MOST_MESSAGES = 1000
const MOST_PAGE_BYTES = 4 * 1024 * 1024

/** The most candidates a search hands the route to match. */
const MOST_CANDIDATES = 1000

/** D1 hears the head at most once a second, a person at most one poke every two. */
const FLUSH_EVERY = 1000
const POKE_EVERY = 2000

/** How long the list of who the chat reaches is believed. */
const REACHERS_FOR = 60_000

/** How long a row saying somebody has a chat open is believed; see rooms/room.ts. */
const OPEN_FOR = 24 * 60 * 60 * 1000

function attachedTo(socket: WebSocket): Attached | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Attached>
  if (!isWho(one.who) || typeof one.id !== 'string') return null
  return {
    who: one.who,
    id: one.id,
    guest: one.guest === true,
    role: one.role === 'owner' || one.role === 'write' ? one.role : 'read',
    ...(typeof one.device === 'string' && one.device ? { device: one.device } : {}),
    hello: one.hello === true,
    typedAt: typeof one.typedAt === 'number' ? one.typedAt : 0,
  }
}

function attach(socket: WebSocket, attached: Attached): void {
  socket.serializeAttachment(attached)
}

/** The one thing every socket write goes through. A socket the runtime has already given
 *  up on throws on `send`, and its close handler deals with that. */
function say(socket: WebSocket, frame: ServerFrame): void {
  try {
    socket.send(JSON.stringify(frame))
  } catch {
    // Closing or closed.
  }
}

/** A whole number from a query, or null. */
function wholeIn(value: string | null): number | null {
  if (value === null || !/^\d{1,16}$/.test(value)) return null
  return Number(value)
}

export class ChatLog implements DurableObject {
  private ready = false
  private reachers: { at: number; list: { id: string; guest: boolean }[] } | null = null

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  /** The object's SQLite, its tables made on the first use after every wake. */
  private get sql(): SqlStorage {
    const sql = this.ctx.storage.sql
    if (!this.ready) {
      sql.exec(SCHEMA)
      this.ready = true
    }
    return sql
  }

  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    const ask = (headers.get('x-nib-chat-ask') ?? '') as ChatAsk

    if (ask === 'erase') return await this.erase()
    if (ask === 'revoke') {
      return await this.revoke(headers.get('x-nib-revoked') ?? '', headers.get('x-nib-role'))
    }
    if (ask === 'profile') {
      const who = headers.get('x-nib-profile')
      if (isWho(who)) this.everyone({ t: 'profile', who })
      return new Response(null, { status: 204 })
    }

    this.remember(headers.get('x-nib-chat'), headers.get('x-nib-space'))
    const query = new URL(request.url).searchParams
    if (ask === 'events') return Response.json(this.eventsPage(query))
    if (ask === 'state') return Response.json(this.statePage(query))
    if (ask === 'message') return Response.json({ message: this.messageById(query.get('id')) })
    if (ask === 'search') return Response.json({ messages: this.candidates(await request.json()) })

    const person = personOf(headers)
    if (!person) return new Response('nobody', { status: 400 })
    switch (ask) {
      case 'join': {
        const pair = new WebSocketPair()
        await this.enter(pair[1], person)
        return new Response(null, { status: 101, webSocket: pair[0] })
      }
      case 'send': {
        const { events } = await request.json<{ events: Event[] }>()
        const results = []
        for (const event of events) results.push(resultOf(await this.take(person, event, null)))
        return Response.json({ results })
      }
      case 'read': {
        const body = await request.json<{ seq: number; back?: boolean }>()
        await this.read(person.who, body.seq, body.back === true, null)
        return Response.json({ seq: this.readPlace(person.who) })
      }
      case 'scheduled':
        return Response.json({ scheduled: this.scheduledOf(person.who) })
      default:
        return new Response('not something a chat does', { status: 400 })
    }
  }

  /** Which chat this object is, and which space it is in now: said by every request,
   *  kept for the alarm, which has nobody to ask. */
  private remember(chat: string | null, space: string | null): void {
    if (chat && readMeta(this.sql, 'chat') !== chat) setMeta(this.sql, 'chat', chat)
    if (space && readMeta(this.sql, 'space') !== space) setMeta(this.sql, 'space', space)
  }

  /* ── Sockets ──────────────────────────────────────────────────────────── */

  /** The object's half of a socket, taken in. Apart from `fetch` because a test drives
   *  it without a runtime to make the pair. The device says `hello` next. */
  async enter(server: WebSocket, person: Person): Promise<void> {
    // Written down before the socket is taken, so a revocation can always find it: a
    // socket no row names is a socket nobody can close.
    await this.writeSocketRow(person.id)

    this.ctx.acceptWebSocket(server, [person.who])
    attach(server, { ...person, hello: false, typedAt: 0 })
    this.sayHere()
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return
    const me = attachedTo(socket)
    if (!me) return
    const frame = clientFrameOf(message)
    if (!frame) {
      say(socket, { t: 'refused', id: null, error: INVALID })
      return
    }

    switch (frame.t) {
      case 'hello':
        await this.hello(socket, me, frame.since ?? 0)
        break
      case 'send':
        say(socket, await this.take(me, frame.event, socket))
        break
      case 'typing':
        this.typing(socket, me, frame.parent)
        break
      case 'read':
        await this.read(me.who, frame.seq, false, socket)
        break
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  private async gone(socket: WebSocket): Promise<void> {
    const me = attachedTo(socket)
    if (!me) return
    const others = this.ctx.getWebSockets(me.who).some((one) => one !== socket)
    if (!others) await this.forgetSocketRow(me.id)
    this.sayHere(socket)
  }

  /** A device saying where it is: the events after its seq, or that it is too far
   *  behind for them; then who is here, and, in a small chat, where everybody has read
   *  to. Who the chat reaches decides that, and a moment's failure to ask leaves the
   *  receipts out rather than the greeting unsent. */
  private async hello(socket: WebSocket, me: Attached, since: number): Promise<void> {
    attach(socket, { ...me, hello: true })
    await this.reachersNow().catch(() => [])

    const head = this.head()
    if (since < head && head - since > MOST_BEHIND) {
      say(socket, { t: 'behind', seq: head })
    } else {
      let after = since
      while (after < head) {
        const rows = this.sql
          .exec<EventRow>(
            'select * from events where seq > ? order by seq limit ?',
            after,
            MOST_PAGE,
          )
          .toArray()
        if (!rows.length) break
        say(socket, { t: 'events', events: rows.map(loggedOf) })
        after = rows[rows.length - 1]?.seq ?? head
      }
    }

    say(socket, { t: 'here', who: this.here() })
    if (this.showsReceipts()) {
      for (const place of this.readPlaces(me.who)) say(socket, { t: 'read', ...place })
    }
  }

  private typing(socket: WebSocket, me: Attached, parent: string | undefined): void {
    // A reader types nothing.
    if (me.role === 'read' || (me.role === 'write' && metaOf(this.sql).posting === 'owner')) return
    const now = Date.now()
    if (now - me.typedAt < TYPING_EVERY) return
    attach(socket, { ...me, typedAt: now })

    const frame: ServerFrame = { t: 'typing', who: me.who, ...(parent ? { parent } : {}) }
    for (const other of this.ctx.getWebSockets()) {
      const them = attachedTo(other)
      if (other !== socket && them?.hello && them.who !== me.who) say(other, frame)
    }
  }

  /** Who has the chat open, once each. */
  private here(leaving?: WebSocket): Who[] {
    const who = new Set<Who>()
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === leaving) continue
      const one = attachedTo(socket)
      if (one) who.add(one.who)
    }
    return [...who]
  }

  private sayHere(leaving?: WebSocket): void {
    const frame: ServerFrame = { t: 'here', who: this.here(leaving) }
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== leaving && attachedTo(socket)?.hello) say(socket, frame)
    }
  }

  /** A frame to every socket that said hello, but one. */
  private everyone(frame: ServerFrame, but?: WebSocket | null): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== but && attachedTo(socket)?.hello) say(socket, frame)
    }
  }

  /* ── Placing ──────────────────────────────────────────────────────────── */

  /** One event from one person, answered: placed, refused, held for its time or taken
   *  back before it went. Everybody else hears what was placed. */
  async take(person: Person, event: Event, from: WebSocket | null): Promise<Answer> {
    const sql = this.sql
    const at = Date.now()

    // A resend of something already placed or held is answered as it was.
    const had = placedEvent(sql, event.id)
    if (had) return { t: 'placed', id: had.id, seq: had.seq, at: had.at }
    const held = this.heldAnswer(event.id)
    if (held) return held

    // Taking back a post that has not gone yet.
    if (event.kind === 'delete' && this.unschedule(person.who, event.target)) {
      return { t: 'placed', id: event.id, seq: 0, at }
    }

    const refused = admit(sql, event, person, at)
    if (refused) return { t: 'refused', id: event.id, error: refused }
    if (!(await this.holds(person, event))) return { t: 'refused', id: event.id, error: INVALID }

    if (event.kind === 'schedule' && event.sendAt > at + FLUSH_EVERY) {
      await this.schedule(person, event)
      return { t: 'placed', id: event.id, seq: 0, at: event.sendAt }
    }
    return await this.placeNow(person, event.kind === 'schedule' ? event.post : event, at, from)
  }

  /** An admitted event placed, its effects set going, and everybody told. */
  private async placeNow(
    person: Person,
    event: Exclude<Event, { kind: 'schedule' }>,
    at: number,
    from: WebSocket | null,
  ): Promise<Answer> {
    const { logged, effects, called } = this.ctx.storage.transactionSync(() => {
      const placed = place(this.sql, event, person, at)
      return { ...placed, called: this.noted(placed.logged, placed.effects) }
    })
    this.everyone({ t: 'events', events: [logged] }, from)
    await this.after(logged, effects, called)
    return { t: 'placed', id: logged.id, seq: logged.seq, at: logged.at }
  }

  /** In the transaction that placed an event: the head owed to D1, and for a post who
   *  it calls - counted until they read past it - and its author's own read place moved
   *  past it. `@here` and `@everyone` call everybody the chat reaches. */
  private noted(logged: Logged, effects: Effects): Who[] {
    this.flushSoon()
    if (logged.kind !== 'post') return []
    const sql = this.sql
    const called = new Set<Who>()
    for (const one of effects.called) {
      if (one === 'here' || one === 'everyone') {
        for (const person of this.reachers?.list ?? []) {
          called.add(person.guest ? `guest:${person.id}` : `user:${person.id}`)
        }
      } else called.add(one)
    }
    if (effects.answered) called.add(effects.answered)
    called.delete(logged.author)
    for (const who of called) {
      sql.exec('insert or ignore into mentioned (who, seq) values (?, ?)', who, logged.seq)
      sql.exec(
        'insert into members (who, dirty) values (?, 1) on conflict(who) do update set dirty = 1',
        who,
      )
    }
    sql.exec(
      `insert into members (who, read_seq, dirty) values (?, ?, 1)
       on conflict(who) do update set read_seq = max(read_seq, excluded.read_seq), dirty = 1`,
      logged.author,
      logged.seq,
    )
    return [...called]
  }

  /** What a placed event sets going outside the object: the files it names written down
   *  for its members, the files a delete let go of, and pokes for a post. */
  private async after(logged: Logged, effects: Effects, called: readonly Who[]): Promise<void> {
    try {
      await this.keepFiles(effects, logged.at)
      await this.freeFiles(effects)
    } catch (error) {
      note(`chat ${this.chatId()} files`, error, null)
    }
    if (logged.kind === 'post') await this.poke(logged, called)
    await this.plan()
  }

  /** Whether the sender holds every blob the event names; a guest holds none. */
  private async holds(person: Person, event: Event): Promise<boolean> {
    const post = event.kind === 'schedule' ? event.post : event
    if (post.kind !== 'post' && post.kind !== 'edit') return true
    const hashes = new Set<string>()
    for (const file of post.files ?? []) {
      hashes.add(file.hash)
      if (file.preview) hashes.add(file.preview)
    }
    if (post.kind === 'post' && post.preview?.picture) hashes.add(post.preview.picture)
    if (!hashes.size) return true
    if (person.guest) return false
    const { results } = await this.env.DB.prepare(
      `select distinct hash from blobs where user_id = ? and hash in (${places(hashes.size)})`,
    )
      .bind(person.id, ...hashes)
      .all<{ hash: string }>()
    return results.length === hashes.size
  }

  /* ── Scheduled posts ──────────────────────────────────────────────────── */

  private heldAnswer(id: string): Answer | null {
    const row = this.sql
      .exec<{ send_at: number }>('select send_at from scheduled where id = ?', id)
      .toArray()[0]
    return row ? { t: 'placed', id, seq: 0, at: row.send_at } : null
  }

  /** A post held for its time, replacing one the same person held for the same message:
   *  a scheduled post is editable until it goes. */
  private async schedule(person: Person, event: Extract<Event, { kind: 'schedule' }>) {
    const sql = this.sql
    this.ctx.storage.transactionSync(() => {
      sql.exec(
        'delete from scheduled where message = ? and author = ?',
        event.post.message,
        person.who,
      )
      sql.exec(
        `insert into scheduled (id, message, author, device, send_at, post)
         values (?, ?, ?, ?, ?, ?)`,
        event.id,
        event.post.message,
        person.who,
        person.device ?? null,
        event.sendAt,
        JSON.stringify(event.post),
      )
    })
    await this.plan()
  }

  /** A delete of a post still waiting for its time takes it back, for its author. */
  private unschedule(who: Who, message: string): boolean {
    const row = this.sql
      .exec<{ id: string }>(
        'select id from scheduled where message = ? and author = ?',
        message,
        who,
      )
      .toArray()[0]
    if (row) this.sql.exec('delete from scheduled where id = ?', row.id)
    return row !== undefined
  }

  private scheduledOf(who: Who) {
    return this.sql
      .exec<{ id: string; send_at: number; post: string; refused: string | null }>(
        'select id, send_at, post, refused from scheduled where author = ? order by send_at',
        who,
      )
      .toArray()
      .map((one) => ({
        id: one.id,
        sendAt: one.send_at,
        post: JSON.parse(one.post) as Post,
        ...(one.refused ? { refused: one.refused as Refusal } : {}),
      }))
  }

  /** Every post whose time has come, placed as its author - who is asked about again,
   *  because their role may have changed since. One that is refused stays, marked with
   *  why, for its author to see. */
  private async placeDue(now: number): Promise<void> {
    const chat = this.chatId()
    if (!chat) return
    const due = this.sql
      .exec<{ id: string; author: string; device: string | null; post: string }>(
        `select id, author, device, post from scheduled
          where send_at <= ? and refused is null order by send_at limit 50`,
        now,
      )
      .toArray()

    for (const one of due) {
      const who = one.author as Who
      const id = hubIdOf(who)
      const guest = who.startsWith('guest:')
      const reached = await reachAs(this.env, { id, guest }, chat)
      this.sql.exec('delete from scheduled where id = ?', one.id)
      const post = JSON.parse(one.post) as Post
      const answer = reached
        ? await this.take(
            { who, id, guest, role: reached.role, ...(one.device ? { device: one.device } : {}) },
            post,
            null,
          )
        : ({ t: 'refused', id: post.id, error: ROLE } as const)
      if (answer.t === 'refused') {
        this.sql.exec(
          `insert into scheduled (id, message, author, device, send_at, post, refused)
           values (?, ?, ?, ?, ?, ?, ?)`,
          one.id,
          post.message,
          who,
          one.device,
          now,
          one.post,
          answer.error,
        )
      }
    }
  }

  /* ── Reading ──────────────────────────────────────────────────────────── */

  private head(): number {
    return (
      this.sql.exec<{ seq: number | null }>('select max(seq) as seq from events').one().seq ?? 0
    )
  }

  private readPlace(who: Who): number {
    return (
      this.sql
        .exec<{ read_seq: number }>('select read_seq from members where who = ?', who)
        .toArray()[0]?.read_seq ?? 0
    )
  }

  private mentionsOf(who: Who): number {
    return this.sql
      .exec<{ many: number }>(
        'select count(*) as many from mentioned where who = ? and seq > ?',
        who,
        this.readPlace(who),
      )
      .one().many
  }

  /** A person's read place moved: forward as they read, or back where they said so
   *  (Mark unread). Their other devices follow; everybody sees it in a small chat. */
  async read(who: Who, seq: number, back: boolean, from: WebSocket | null): Promise<void> {
    const sql = this.sql
    const to = Math.min(seq, this.head())
    const was = this.readPlace(who)
    if (to === was || (to < was && !back)) return

    sql.exec(
      `insert into members (who, read_seq, dirty) values (?, ?, 1)
       on conflict(who) do update set read_seq = excluded.read_seq, dirty = 1`,
      who,
      to,
    )
    sql.exec('delete from mentioned where who = ? and seq <= ?', who, Math.min(to, was))
    this.flushSoon()

    const frame: ServerFrame = { t: 'read', who, seq: to }
    const shown = this.showsReceipts()
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === from) continue
      const them = attachedTo(socket)
      if (them?.hello && (them.who === who || shown)) say(socket, frame)
    }
    await this.plan()
  }

  /** Whether this chat is small enough for receipts, by the people it reached when last
   *  asked (decision 7.5). */
  private showsReceipts(): boolean {
    const known = this.reachers?.list.length ?? 0
    return known > 0 && known <= RECEIPTS_UP_TO
  }

  /** Everybody else's read place. */
  private readPlaces(but: Who): { who: Who; seq: number }[] {
    return this.sql
      .exec<{ who: string; read_seq: number }>(
        'select who, read_seq from members where read_seq > 0 and who <> ?',
        but,
      )
      .toArray()
      .map((one) => ({ who: one.who as Who, seq: one.read_seq }))
  }

  /* ── Pages over HTTP ──────────────────────────────────────────────────── */

  /** Events by seq: after one, before one, or around one (4.4). */
  private eventsPage(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(wholeIn(query.get('limit')) ?? 200, MOST_PAGE))
    const before = wholeIn(query.get('before'))
    const around = wholeIn(query.get('around'))
    const older = (from: number, many: number) =>
      this.sql
        .exec<EventRow>('select * from events where seq < ? order by seq desc limit ?', from, many)
        .toArray()
        .reverse()
    const newer = (from: number, many: number) =>
      this.sql
        .exec<EventRow>('select * from events where seq > ? order by seq limit ?', from, many)
        .toArray()

    let rows: EventRow[]
    let more: boolean
    if (around !== null) {
      const half = Math.floor(limit / 2)
      rows = [...older(around, half), ...newer(around - 1, limit - half)]
      more = rows.length >= limit
    } else if (before !== null) {
      rows = older(before, limit + 1)
      more = rows.length > limit
      if (more) rows = rows.slice(1)
    } else {
      rows = newer(wholeIn(query.get('after')) ?? 0, limit + 1)
      more = rows.length > limit
      if (more) rows = rows.slice(0, limit)
    }
    return { events: rows.map(loggedOf), more }
  }

  /** One message as it stands, by its id: where an agent's `before` or `around` is. */
  private messageById(id: string | null): Message | null {
    if (!id) return null
    const row = this.sql
      .exec<{ json: string }>('select json from messages where id = ?', id)
      .toArray()[0]
    return row ? (JSON.parse(row.json) as Message) : null
  }

  /** Messages as they stand, newest first, for a first copy (4.5): a message deleted
   *  with nothing under it is left out, one with replies kept as the line they hang
   *  from. `next` is the `before` of the following page. `parent` narrows it to one
   *  message's replies, which the account connector reads (4.14). */
  private statePage(query: URLSearchParams) {
    const limit = Math.max(1, Math.min(wholeIn(query.get('limit')) ?? MOST_MESSAGES, MOST_MESSAGES))
    const before = wholeIn(query.get('before')) ?? Number.MAX_SAFE_INTEGER
    const parent = query.get('parent')
    const head = this.head()
    const rows = this.sql
      .exec<{ seq: number; json: string }>(
        `select seq, json from messages where seq < ? and (deleted = 0 or replies > 0)
            and (? is null or parent = ?)
          order by seq desc limit ?`,
        before,
        parent,
        parent,
        limit + 1,
      )
      .toArray()

    const messages: Message[] = []
    let bytes = 0
    for (const row of rows.slice(0, limit)) {
      bytes += row.json.length
      if (bytes > MOST_PAGE_BYTES && messages.length) break
      messages.push(JSON.parse(row.json) as Message)
    }
    const more = messages.length < rows.length
    return {
      messages,
      meta: metaOf(this.sql),
      seq: head,
      next: more ? (messages.at(-1)?.seq ?? null) : null,
    }
  }

  /** What a search may match, newest first: the messages that have every word as the
   *  start of one of theirs (the words index), or the newest messages where it names no
   *  words. The route answers the query over them with `matches` from `@nib/chats`. */
  candidates(asked: unknown): Message[] {
    const words = (
      Array.isArray((asked as { words?: unknown } | null)?.words)
        ? (asked as { words: unknown[] }).words
        : []
    )
      .filter((one): one is string => typeof one === 'string')
      .flatMap((one) => one.split(/[^\p{L}\p{N}]+/u))
      .filter(Boolean)
      .slice(0, 20)
    const rows = words.length
      ? this.sql
          .exec<{ json: string }>(
            `select m.json from messages m
              where m.deleted = 0 and m.seq in (select rowid from words where words match ?)
              order by m.seq desc limit ?`,
            words.map((one) => `"${one.replaceAll('"', '')}"*`).join(' '),
            MOST_CANDIDATES,
          )
          .toArray()
      : this.sql
          .exec<{ json: string }>(
            'select json from messages where deleted = 0 order by seq desc limit ?',
            MOST_CANDIDATES,
          )
          .toArray()
    return rows.map((row) => JSON.parse(row.json) as Message)
  }

  /* ── D1: heads, files, pokes ──────────────────────────────────────────── */

  private chatId(): string | null {
    return readMeta(this.sql, 'chat')
  }

  /** The next write of the head and read places to D1, a second after the last. */
  private flushSoon(): void {
    const sql = this.sql
    if (readMeta(sql, 'flush_at') !== null) return
    const last = Number(readMeta(sql, 'flushed_at') ?? 0)
    setMeta(sql, 'flush_at', String(Math.max(Date.now(), last + FLUSH_EVERY)))
  }

  private async flush(): Promise<void> {
    const chat = this.chatId()
    const sql = this.sql
    if (!chat) return
    const head = sql
      .exec<{ seq: number; at: number; author: string }>(
        'select seq, at, author from events order by seq desc limit 1',
      )
      .toArray()[0]
    const meta = metaOf(sql)
    const dirty = sql
      .exec<{ who: string; read_seq: number }>(
        'select who, read_seq from members where dirty = 1 limit 200',
      )
      .toArray()

    await this.env.DB.batch([
      this.env.DB.prepare(
        `update chats set last_seq = ?, last_at = ?, last_by = ?, topic = ?, posting = ?,
           slowmode = ? where id = ?`,
      ).bind(
        head?.seq ?? 0,
        head?.at ?? null,
        head?.author ?? null,
        meta.topic,
        meta.posting,
        meta.slowmode,
        chat,
      ),
      ...dirty
        .filter((one) => !one.who.startsWith('program:'))
        .map((one) =>
          this.env.DB.prepare(
            `insert into chat_reads (chat_id, who, read_seq, mentions) values (?, ?, ?, ?)
             on conflict(chat_id, who) do update
               set read_seq = excluded.read_seq, mentions = excluded.mentions`,
          ).bind(chat, hubIdOf(one.who), one.read_seq, this.mentionsOf(one.who as Who)),
        ),
    ])

    for (const one of dirty) {
      sql.exec('update members set dirty = 0 where who = ? and read_seq = ?', one.who, one.read_seq)
    }
    setMeta(sql, 'flushed_at', String(Date.now()))
    setMeta(sql, 'flush_at', null)
    // More than one write's worth was waiting: the next goes a second from now.
    if (dirty.length === 200) this.flushSoon()
  }

  /** The files a post names, written down so the chat's members may fetch them. */
  private async keepFiles(effects: Effects, at: number): Promise<void> {
    const chat = this.chatId()
    if (!chat || !effects.files.length) return
    const rows = effects.files.flatMap((file) => [
      { hash: file.hash, size: file.size, type: file.type, name: file.name },
      ...(file.preview
        ? [{ hash: file.preview, size: 0, type: 'image/webp', name: file.name }]
        : []),
    ])
    await this.env.DB.batch(
      rows.map((one) =>
        this.env.DB.prepare(
          `insert into chat_files (chat_id, hash, size, type, name, at) values (?, ?, ?, ?, ?, ?)
           on conflict(chat_id, hash) do nothing`,
        ).bind(chat, one.hash, one.size, one.type, one.name, at),
      ),
    )
  }

  /** The files a deleted message named, let go of where no message still names them. */
  private async freeFiles(effects: Effects): Promise<void> {
    const chat = this.chatId()
    if (!chat || !effects.freed.length) return
    const hashes = effects.freed.flatMap((file) =>
      file.preview ? [file.hash, file.preview] : [file.hash],
    )
    const loose = hashes.filter(
      (hash) =>
        !this.sql
          .exec('select 1 from messages where deleted = 0 and json like ? limit 1', `%${hash}%`)
          .toArray().length,
    )
    if (!loose.length) return
    await this.env.DB.prepare(
      `delete from chat_files where chat_id = ? and hash in (${places(loose.length)})`,
    )
      .bind(chat, ...loose)
      .run()
  }

  /** Everybody the chat reaches, believed for a minute. */
  private async reachersNow(): Promise<{ id: string; guest: boolean }[]> {
    const now = Date.now()
    if (this.reachers && now - this.reachers.at < REACHERS_FOR) return this.reachers.list
    const chat = this.chatId()
    const list = chat ? await reaching(this.env, chat) : []
    this.reachers = { at: now, list }
    return list
  }

  /** A post, owed to everybody the chat reaches who has no socket open to it: sent now
   *  where their last poke was two seconds ago or more, held and merged otherwise. */
  private async poke(logged: Logged, called: readonly Who[]): Promise<void> {
    let reachers: { id: string; guest: boolean }[]
    try {
      reachers = await this.reachersNow()
    } catch (error) {
      note(`chat ${this.chatId()} reachers`, error, null)
      return
    }
    const open = new Set(this.here().map(hubIdOf))
    const named = new Set(called.map(hubIdOf))
    const now = Date.now()
    const sql = this.sql
    const sendNow: string[] = []

    for (const one of reachers) {
      if (open.has(one.id)) continue
      const row = sql
        .exec<{ sent_at: number; mention: number }>(
          'select sent_at, mention from pokes where id = ?',
          one.id,
        )
        .toArray()[0]
      const mention = named.has(one.id) || row?.mention === 1 ? 1 : 0
      sql.exec(
        `insert into pokes (id, sent_at, seq, at, by, mention) values (?, ?, ?, ?, ?, ?)
         on conflict(id) do update set seq = excluded.seq, at = excluded.at, by = excluded.by,
           mention = excluded.mention`,
        one.id,
        row?.sent_at ?? 0,
        logged.seq,
        logged.at,
        logged.author,
        mention,
      )
      if (!row || now - row.sent_at >= POKE_EVERY) sendNow.push(one.id)
    }
    await this.sendPokes(sendNow, now)
  }

  /** The pokes owed to these hubs, sent and marked sent. */
  private async sendPokes(ids: readonly string[], now: number): Promise<void> {
    const chat = this.chatId()
    if (!chat || !ids.length) return
    const sql = this.sql
    await Promise.all(
      ids.map(async (id) => {
        const row = sql
          .exec<{ seq: number | null; at: number | null; by: string | null; mention: number }>(
            'select seq, at, by, mention from pokes where id = ?',
            id,
          )
          .toArray()[0]
        if (row?.seq === null || row?.seq === undefined) return
        sql.exec(
          'update pokes set sent_at = ?, seq = null, at = null, by = null, mention = 0 where id = ?',
          now,
          id,
        )
        await askHub(this.env, id, 'chat', {
          'x-nib-chat': chat,
          'x-nib-seq': String(row.seq),
          'x-nib-at': String(row.at ?? now),
          'x-nib-by': row.by ?? '',
          'x-nib-mention': row.mention === 1 ? 'yes' : 'no',
        })
      }),
    )
  }

  /* ── The alarm ────────────────────────────────────────────────────────── */

  async alarm(): Promise<void> {
    const now = Date.now()
    const flushAt = Number(readMeta(this.sql, 'flush_at') ?? Number.NaN)
    try {
      if (flushAt <= now) await this.flush()
    } catch (error) {
      note(`chat ${this.chatId()} flush`, error, null)
    }
    try {
      const owed = this.sql
        .exec<{ id: string }>(
          'select id from pokes where seq is not null and sent_at <= ?',
          now - POKE_EVERY,
        )
        .toArray()
      await this.sendPokes(
        owed.map((one) => one.id),
        now,
      )
    } catch (error) {
      note(`chat ${this.chatId()} pokes`, error, null)
    }
    try {
      await this.placeDue(now)
    } catch (error) {
      note(`chat ${this.chatId()} scheduled`, error, null)
    }
    await this.plan()
  }

  /** The alarm set for the soonest of the three waits, or taken off. */
  private async plan(): Promise<void> {
    const sql = this.sql
    const flushAt = readMeta(sql, 'flush_at')
    const poke = sql
      .exec<{ at: number | null }>('select min(sent_at) as at from pokes where seq is not null')
      .one().at
    const scheduled = sql
      .exec<{ at: number | null }>('select min(send_at) as at from scheduled where refused is null')
      .one().at
    const times = [
      flushAt === null ? null : Number(flushAt),
      poke === null ? null : poke + POKE_EVERY,
      scheduled,
    ].filter((one): one is number => one !== null && Number.isFinite(one))
    if (!times.length) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.max(Math.min(...times), Date.now()))
  }

  /* ── Access ending ────────────────────────────────────────────────────── */

  /** Somebody's access ended, or narrowed to reading, while they had the chat open. */
  private async revoke(id: string, role: string | null): Promise<Response> {
    this.reachers = null
    const toRead = role === 'read'
    for (const socket of this.ctx.getWebSockets()) {
      const them = attachedTo(socket)
      if (them?.id !== id) continue
      if (toRead) attach(socket, { ...them, role: 'read' })
      else socket.close(1008, 'no longer in this space')
    }
    if (!toRead) {
      await this.forgetSocketRow(id)
      this.sayHere()
    }
    return new Response(null, { status: 204 })
  }

  /** The chat is gone for good, and so is everything this object kept of it. */
  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'this chat is gone')
    this.reachers = null
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    this.ready = false
    return new Response(null, { status: 204 })
  }

  /** This person has this chat open; see `chat_sockets` in 0047. */
  private async writeSocketRow(who: string): Promise<void> {
    const chat = this.chatId()
    const space = readMeta(this.sql, 'space')
    if (!chat || !space) return
    await this.env.DB.prepare('delete from chat_sockets where opened_at < ?')
      .bind(Date.now() - OPEN_FOR)
      .run()
    await this.env.DB.prepare(
      `insert into chat_sockets (chat_id, space_id, who, opened_at) values (?, ?, ?, ?)
       on conflict(chat_id, who) do update
         set space_id = excluded.space_id, opened_at = excluded.opened_at`,
    )
      .bind(chat, space, who, Date.now())
      .run()
  }

  private async forgetSocketRow(who: string): Promise<void> {
    const chat = this.chatId()
    if (!chat) return
    await this.env.DB.prepare('delete from chat_sockets where chat_id = ? and who = ?')
      .bind(chat, who)
      .run()
  }
}

/** Whoever the door or a route said a request is from. */
function personOf(headers: Headers): Person | null {
  const id = headers.get('x-nib-who') ?? ''
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const guest = headers.get('x-nib-guest') === 'yes'
  const role = headers.get('x-nib-role')
  const device = headers.get('x-nib-device')
  return {
    id,
    guest,
    who: guest ? `guest:${id}` : `user:${id}`,
    role: role === 'owner' || role === 'write' ? role : 'read',
    ...(device ? { device } : {}),
  }
}

/** An answer as `POST /v2/chats/:chat/events` says it (`Result` in `@nib/chats/wire`). */
function resultOf(answer: Answer) {
  return answer.t === 'placed'
    ? { id: answer.id, seq: answer.seq, at: answer.at }
    : { id: answer.id ?? '', refused: answer.error }
}
