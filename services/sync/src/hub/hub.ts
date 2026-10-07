/** One account's hub: the socket every one of its signed-in devices keeps open.
 *
 *  A Durable Object named by the account's id (or a guest's), which makes it the one
 *  place every device of that account already agrees on - and so the one clock and
 *  the one order for what has to be decided between them. Three things happen here.
 *  Pokes: a space moved, and every device that can reach it runs a pass now rather
 *  than at its next poll. Leases: which computer may run a site's login right now,
 *  with a fence that only grows so that a computer which slept through losing one
 *  cannot write over the computer that took it. And the web key's relay between a
 *  new computer and one that can approve it; see keys.ts.
 *
 *  It hibernates. Beats are answered by the runtime without waking it, what each
 *  socket is lives on the socket, what each lease is lives in storage, and every
 *  moment it waits for is an alarm. So an account whose devices are all quiet costs
 *  nothing, and a crash is noticed by the alarm rather than by anybody's timer. A
 *  guest's hub hears pokes and nothing else: a guest has no web logins to lock and
 *  no key to be given. See docs/sync-v2.md sections 5.12 and 6. */

import { isWho } from '@nib/chats/wire'
import { note } from '../failed'
import { FENCED, SIGN_IN_TO_DO_THAT } from '../refused'
import { mayAcquire } from '../limits'
import type { Env } from '../types'
import { collectChunks, putState } from './bucket'
import { markSeen, register } from './devices'
import { type FromDevice, type FromHub, readFrame, say } from './frames'
import { denyKey, forgetWant, grantKey, type Relay, wantedOf, wantKey } from './keys'
import { HUB_AWAY } from './reach'
import {
  acquire,
  due,
  flushed,
  forget,
  freshLease,
  type Lease,
  type Outcome,
  release,
  type Said,
  settle,
  watched,
  type World,
} from './leases'
import {
  type Attached,
  aliveUntil,
  attach,
  attachedTo,
  everySocket,
  socketOf,
  tellDevice,
} from './sockets'

/** The heartbeat, both halves, as the runtime answers it. */
export const BEAT = 'beat'
export const BEAT_ANSWER = 'ok'

const LEASE = 'lease:'
/** The keys of the leases the alarm has to look at: a handover under way, or
 *  somebody waiting. Kept apart so that a close or an alarm reads a handful of
 *  leases rather than every site the account has ever used. */
const WATCH = 'watch'
/** Whether the next upload has to move the account to a new key generation, and
 *  from which: set when a device that held the key is ended. */
const ROTATE = 'rotate'

/** What a device asking for leases faster than a person could press anything is
 *  told. A flapping tab, not a reader, so it stays in English; see docs/conventions.md,
 *  "A sentence the Worker answers with is a row too". */
const TOO_MANY_TRIES = 'too many tries - try again in a minute'
const NO_KEY_YET = 'this computer does not have your web logins yet'
const SAY_HELLO = 'say hello first'

/** What the door decided about a socket before handing it here. */
export interface Joining {
  device: string
  who: string
  session: string
  guest: boolean
}

function readLease(value: unknown): Lease {
  if (typeof value !== 'object' || value === null) return freshLease()
  const held = value as Partial<Lease>
  const handover = held.handover
  return {
    fence: typeof held.fence === 'number' ? held.fence : 0,
    version: typeof held.version === 'number' ? held.version : 0,
    holder: typeof held.holder === 'string' ? held.holder : null,
    waiting: Array.isArray(held.waiting)
      ? held.waiting.filter((one) => typeof one === 'string')
      : [],
    handover:
      handover && typeof handover.to === 'string' && typeof handover.until === 'number'
        ? { to: handover.to, until: handover.until }
        : null,
    chunks: Array.isArray(held.chunks) ? held.chunks.filter((one) => typeof one === 'string') : [],
  }
}

const listOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

export class AccountHub implements DurableObject {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  /** What a route asks, named by a header; see reach.ts. */
  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    switch (headers.get('x-nib-hub') ?? '') {
      case 'join':
        return this.join(headers)
      case 'poke':
        this.poke(headers)
        return new Response(null, { status: 204 })
      case 'upload':
        return await this.upload(request)
      case 'revoke':
        return await this.revoke(headers)
      case 'renamed':
        this.renamed(headers)
        return new Response(null, { status: 204 })
      case 'erase':
        return await this.erase()
      case 'machine':
        this.machine(headers)
        return new Response(null, { status: 204 })
      case 'chat':
        this.chat(headers)
        return new Response(null, { status: 204 })
      default:
        return new Response('not something a hub does', { status: 400 })
    }
  }

  private join(headers: Headers): Response {
    const pair = new WebSocketPair()
    this.enter(pair[1], {
      device: headers.get('x-nib-device') ?? '',
      who: headers.get('x-nib-who') ?? '',
      session: headers.get('x-nib-session') ?? '',
      guest: headers.get('x-nib-guest') === 'yes',
    })
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** The hub's half of a socket, taken in. Apart from `fetch` because a test drives
   *  it without a runtime to make the pair. A device has one socket: one that
   *  connects again replaces the one it had, which is a socket the network has not
   *  yet told anybody is dead. */
  enter(server: WebSocket, joining: Joining): void {
    for (const old of this.ctx.getWebSockets(joining.device)) {
      if (old !== server) old.close(4000, 'this device connected again')
    }

    this.ctx.acceptWebSocket(server, [joining.device])
    attach(server, {
      ...joining,
      since: Date.now(),
      active: true,
      hello: false,
      name: '',
      keyed: false,
    })
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return

    const me = attachedTo(socket)
    const frame = readFrame(message)
    if (!me || !frame) return

    if (frame.t === 'active' || frame.t === 'idle') {
      await this.activity(socket, me, frame.t === 'active')
      return
    }

    if (frame.t === 'hello') {
      await this.hello(socket, me, frame)
      return
    }

    // A guest's socket is for pokes. It has no web logins to lock and no key to be
    // given, whatever it asks.
    if (me.guest) {
      refuse(socket, frame, SIGN_IN_TO_DO_THAT)
      return
    }
    if (!me.hello) {
      refuse(socket, frame, SAY_HELLO)
      return
    }

    switch (frame.t) {
      case 'acquire':
        await this.acquire(socket, me, frame.key, frame.take)
        break
      case 'release':
        await this.change(frame.key, (lease, world) => release(lease, me.device, world))
        break
      case 'flushed':
        await this.change(frame.key, (lease, world) => flushed(lease, me.device, world))
        break
      case 'want-key':
        await wantKey(this.relay(), socket, me, frame.pub)
        break
      case 'grant-key':
        await grantKey(this.relay(), socket, me, frame)
        break
      case 'deny-key':
        await denyKey(this.relay(), me, frame.to)
        break
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.gone(socket)
  }

  /** The one moment the hub waits for: a handover's time running out, or a holder
   *  somebody is waiting on missing its third beat. */
  async alarm(): Promise<void> {
    await this.settleWatched(this.world())
  }

  /* ── Devices ──────────────────────────────────────────────────────────── */

  /** A device saying who it is. For an account that is a row in `devices`, bound
   *  to the session its socket carries, and the web key wrapped to it if it has
   *  one - sent every time, so a device that was offline while it was given the key,
   *  or moved to a new generation, has it the moment it is back. A key holder is
   *  also told of every computer still waiting for one. */
  private async hello(
    socket: WebSocket,
    me: Attached,
    frame: Extract<FromDevice, { t: 'hello' }>,
  ): Promise<void> {
    // A socket speaks for the device it connected as, and for nobody else.
    if (frame.device !== me.device) return

    if (me.guest) {
      attach(socket, { ...me, hello: true, name: frame.name })
      return
    }

    const known = await register(this.env, me.who, me.session, frame)
    const now = { ...me, hello: true, name: known.name, keyed: known.key !== null }
    attach(socket, now)

    if (known.key) {
      say(socket, { t: 'key', wrapped: known.key.wrapped, generation: known.key.generation })
      await wantedOf(this.relay(), socket, now)
    }
  }

  /** A device's person came back, or went away. Going idle is what lets a waiting
   *  computer have the site without pressing anything. */
  private async activity(socket: WebSocket, me: Attached, active: boolean): Promise<void> {
    if (me.active === active) return
    attach(socket, { ...me, active })
    await this.settleWatched(this.world())
  }

  /** A socket that closed, or broke. Its device is not alive any more unless it has
   *  another socket, so whoever was waiting on it is told, and the account learns
   *  when it was last here. */
  private async gone(socket: WebSocket): Promise<void> {
    const me = attachedTo(socket)
    await this.settleWatched(this.world(socket))

    if (me && !me.guest && me.hello && !socketOf(this.ctx, me.device, socket)) {
      await markSeen(this.env, me.who, me.device)
    }
  }

  /** A device was ended from another: its sockets closed, every lease it held let
   *  go of, its request for the key forgotten, and - when it held the key - the
   *  next upload asked to move everybody left to a new generation. */
  private async revoke(headers: Headers): Promise<Response> {
    const device = headers.get('x-nib-device') ?? ''
    const generation = Number(headers.get('x-nib-rotate') ?? '')

    for (const socket of this.ctx.getWebSockets(device)) {
      socket.close(1008, 'this device was signed out')
    }

    await forgetWant(this.relay(), device)
    if (Number.isSafeInteger(generation) && generation > 0) {
      await this.ctx.storage.put(ROTATE, generation + 1)
    }

    const world = this.world()
    const leases = await this.ctx.storage.list({ prefix: LEASE })
    for (const [name, value] of leases) {
      const lease = readLease(value)
      if (lease.holder !== device && !lease.waiting.includes(device) && !lease.handover) continue
      await this.apply(name.slice(LEASE.length), forget(lease, device, world))
    }
    await this.schedule(world)

    return new Response(null, { status: 204 })
  }

  /** A device renamed from the Account pane: the name the hub gives it when it
   *  tells another device where a site is open. */
  private renamed(headers: Headers): void {
    const device = headers.get('x-nib-device') ?? ''
    const name = decodeURIComponent(headers.get('x-nib-name') ?? '')
    if (!name) return

    for (const socket of this.ctx.getWebSockets(device)) {
      const attached = attachedTo(socket)
      if (attached) attach(socket, { ...attached, name })
    }
  }

  /** The account is gone, and so is everything this hub kept for it. */
  private async erase(): Promise<Response> {
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer an account')
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  /* ── Pokes ────────────────────────────────────────────────────────────── */

  /** A space this account can reach moved. Every socket hears it but the device
   *  whose write it was, and nothing is read or written to hear it. */
  private poke(headers: Headers): void {
    const space = headers.get('x-nib-space') ?? ''
    const seq = Number(headers.get('x-nib-seq') ?? '')
    const from = headers.get('x-nib-from') ?? ''
    if (!space || !Number.isSafeInteger(seq)) return

    for (const { socket, attached } of everySocket(this.ctx)) {
      if (attached.device !== from) say(socket, { t: 'poke', space, seq })
    }
  }

  /** The account's online terminal machine changed state (docs/online-terminal.md,
   *  4.6): every device of the account hears it. Only an account's own hub is asked;
   *  a guest has no machine. */
  private machine(headers: Headers): void {
    const state = headers.get('x-nib-state')
    if (state !== 'asleep' && state !== 'starting' && state !== 'awake' && state !== 'stopping') {
      return
    }
    for (const { socket, attached } of everySocket(this.ctx)) {
      if (!attached.guest) say(socket, { t: 'machine', state })
    }
  }

  /** A chat this account reaches moved while none of its devices had it open: every
   *  device hears it, coalesced by the chat's `ChatLog` (chats/log.ts), and moves the
   *  chat's count; the words are pulled when it notifies or the chat opens. */
  private chat(headers: Headers): void {
    const chat = headers.get('x-nib-chat') ?? ''
    const seq = Number(headers.get('x-nib-seq') ?? '')
    const at = Number(headers.get('x-nib-at') ?? '')
    const by = headers.get('x-nib-by')
    if (!chat || !isWho(by) || !Number.isSafeInteger(seq) || !Number.isSafeInteger(at)) return

    const mention = headers.get('x-nib-mention') === 'yes'
    for (const { socket } of everySocket(this.ctx)) {
      say(socket, { t: 'chat', chat, seq, at, by, mention })
    }
  }

  /* ── Leases ───────────────────────────────────────────────────────────── */

  private async acquire(
    socket: WebSocket,
    me: Attached,
    key: string,
    take: boolean,
  ): Promise<void> {
    // A computer without the key cannot name a lease anyway; this says so rather
    // than handing it one it could not upload under.
    if (!me.keyed) {
      refuse(socket, { t: 'acquire', key, take }, NO_KEY_YET)
      return
    }
    // Counted before the lease is read, so nothing else can land on the lease
    // between the read and the write: the count is the one wait on another service.
    if (!(await mayAcquire(this.env, me.who, me.device))) {
      refuse(socket, { t: 'acquire', key, take }, TOO_MANY_TRIES)
      return
    }

    await this.change(key, (lease, world) => acquire(lease, me.device, take, world))
  }

  /** One lease read, decided about and written back, and everybody told. */
  private async change(key: string, decide: (lease: Lease, world: World) => Outcome) {
    const world = this.world()
    await this.apply(key, decide(await this.leaseOf(key), world))
    await this.schedule(world)
  }

  /** The world as the hub's clock sees it now. `closing` is a socket whose close
   *  handler is running, which no longer counts for its device. */
  private world(closing?: WebSocket): World {
    return {
      now: Date.now(),
      aliveUntil: (device) => aliveUntil(this.ctx, device, closing),
      active: (device) => {
        const socket = socketOf(this.ctx, device, closing)
        return socket ? (attachedTo(socket)?.active ?? false) : false
      },
    }
  }

  private async leaseOf(key: string): Promise<Lease> {
    return readLease(await this.ctx.storage.get(LEASE + key))
  }

  private async watching(): Promise<string[]> {
    return listOf(await this.ctx.storage.get(WATCH))
  }

  /** A lease written back, the list of watched ones kept with it, and what each
   *  device has to be told about it said. */
  private async apply(key: string, outcome: Outcome): Promise<void> {
    const lease = outcome.lease
    await this.ctx.storage.put(LEASE + key, lease)

    const watch = await this.watching()
    const is = watched(lease)
    if (is !== watch.includes(key)) {
      await this.ctx.storage.put(WATCH, is ? [...watch, key] : watch.filter((one) => one !== key))
    }

    const rotate = (await this.ctx.storage.get(ROTATE)) !== undefined
    for (const said of outcome.said)
      tellDevice(this.ctx, said.to, this.frame(key, lease, said, rotate))
  }

  /** What one device is told, with the names the hub knows devices by. */
  private frame(key: string, lease: Lease, said: Said, rotate: boolean): FromHub {
    switch (said.t) {
      case 'granted':
        return {
          t: 'granted',
          key,
          fence: lease.fence,
          version: lease.version,
          ...(rotate ? { rotate: true as const } : {}),
        }
      case 'busy':
      case 'lost':
        return { t: said.t, key, device: said.holder, name: this.nameOf(said.holder) }
      case 'flush':
        return { t: 'flush', key, fence: lease.fence }
      case 'free':
        return { t: 'free', key }
    }
  }

  private nameOf(device: string): string {
    const socket = socketOf(this.ctx, device)
    return socket ? (attachedTo(socket)?.name ?? '') : ''
  }

  /** Every watched lease looked at again, and the alarm set for the next moment
   *  any of them needs looking at. */
  private async settleWatched(world: World): Promise<void> {
    for (const key of await this.watching()) {
      await this.apply(key, settle(await this.leaseOf(key), world))
    }
    await this.schedule(world)
  }

  private async schedule(world: World): Promise<void> {
    let next: number | null = null
    for (const key of await this.watching()) {
      const at = due(await this.leaseOf(key), world)
      if (at !== null && (next === null || at < next)) next = at
    }

    if (next === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(next)
  }

  /* ── Uploads ──────────────────────────────────────────────────────────── */

  /** A site's newest state, written only if it was made under the lease as it
   *  stands: the device holding it, with the fence it was granted. The check and
   *  the write are one step - nothing else runs against this hub between them - so
   *  a grant cannot land in between and let a stale state through. Every other
   *  device is then told there is something newer, and the chunks no state names
   *  any more are let go of. */
  private async upload(request: Request): Promise<Response> {
    const headers = request.headers
    const user = headers.get('x-nib-user') ?? ''
    const key = headers.get('x-nib-key') ?? ''
    const device = headers.get('x-nib-device') ?? ''
    const fence = Number(headers.get('x-nib-fence') ?? '')
    const generation = Number(headers.get('x-nib-generation') ?? '')
    const chunks = (headers.get('x-nib-chunks') ?? '').split(',').filter(Boolean)
    const body = await request.arrayBuffer()

    // Nothing thrown may leave the critical section: a throw inside it resets the
    // whole object, which is every device's socket closed over one bucket's bad
    // moment. A failed write is answered as one, and the device sends it again.
    const version = await this.ctx.blockConcurrencyWhile(async () => {
      const lease = await this.leaseOf(key)
      if (lease.holder !== device || lease.fence !== fence) return null

      const written = lease.version + 1
      try {
        await putState(this.env, { user, key, device, fence, version: written, generation, body })
      } catch (error) {
        note(`hub upload ${user}`, error, null)
        return undefined
      }
      await this.ctx.storage.put(LEASE + key, { ...lease, version: written, chunks })

      const rotateFrom = await this.ctx.storage.get(ROTATE)
      if (typeof rotateFrom === 'number' && generation >= rotateFrom) {
        await this.ctx.storage.delete(ROTATE)
      }
      return written
    })

    if (version === null) return Response.json({ error: FENCED }, { status: 409 })
    if (version === undefined) return Response.json({ error: HUB_AWAY }, { status: 503 })

    for (const { socket, attached } of everySocket(this.ctx)) {
      if (attached.device !== device) say(socket, { t: 'state', key, version })
    }

    // The state has landed whatever happens here; the next upload collects again.
    try {
      await collectChunks(this.env, user, await this.named())
    } catch (error) {
      note(`hub chunks ${user}`, error, null)
    }
    return Response.json({ version })
  }

  /** Every chunk the account's states name now. */
  private async named(): Promise<Set<string>> {
    const named = new Set<string>()
    for (const value of (await this.ctx.storage.list({ prefix: LEASE })).values()) {
      for (const one of readLease(value).chunks) named.add(one)
    }
    return named
  }

  private relay(): Relay {
    return {
      ctx: this.ctx,
      env: this.env,
      // A fresh key: whatever rotation a revocation owed is done with.
      rotated: () => this.ctx.storage.delete(ROTATE).then(() => undefined),
    }
  }
}

/** A message the hub will not act on, answered with why. */
function refuse(socket: WebSocket, frame: FromDevice, error: string): void {
  say(socket, {
    t: 'refused',
    to: frame.t,
    ...('key' in frame ? { key: frame.key } : {}),
    error,
  })
}
