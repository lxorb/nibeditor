/** One person's machine: the one door and the one fan-out (docs/online-terminal.md,
 *  4.4 and 4.6).
 *
 *  A Durable Object named by the machine's id. It holds the people's sockets through
 *  the hibernation API, so a machine asleep with a tab open costs nothing, and while
 *  the machine is awake it holds one link to `nibd` inside it. Every byte a session
 *  prints comes up that link once and goes out to every socket on the session, each at
 *  its own offset; everything typed is checked against the socket's right to type
 *  before it goes down.
 *
 *  The machine wakes when its owner puts one of its terminals on screen or presses
 *  Start, and decides about sleeping itself, on an alarm each minute while awake, by
 *  the one rule of 4.4 (`awake`). Going to sleep saves: `nibd` writes every screen, the
 *  home goes to R2, the root filesystem is snapshotted, and the instance stops. Waking
 *  boots from the snapshot when there is a good one, and otherwise from the image with
 *  the home put back from R2 (4.3).
 *
 *  What the door decided about a socket lives on the socket, and the minute alarm asks
 *  the rows again for all of them at once, so a file trashed or a person taken out of a
 *  space closes what it should within a minute even when nothing told the object; the
 *  routes that change access tell it at once besides (`revoke`, `typing`, `end`). */

import { randomToken } from '../crypto'
import { note } from '../failed'
import { askHub } from '../hub/reach'
import type { Env } from '../types'
import { audit, type Detail } from './audit'
import { budgetLeft } from './budget'
import { whyNotWake } from './gate'
import { ContainerHost, SECRET } from './host'
import { FREE, meter, SMALL, usedOf } from './meter'
import {
  type Activity,
  awake,
  clientFrameOf,
  type DownReason,
  INPUT_RATE,
  linkFrame,
  type MachineFrame,
  type MachineHost,
  type MachineState,
  MOST_INPUT,
  MOST_SOCKETS,
  mayType,
  nibdFrameOf,
  type NibdFrame,
  outFrame,
  type Refusal,
  type ServerFrame,
  type SpaceRole,
  sizeOf,
  text,
  type Typed,
  type Typing,
  type Watcher,
} from './online'
import { reachAgain } from './reach'
import { serviceOf } from './service'

/** The image the machine boots, by its name in wrangler.machines.jsonc's `images`. */
export const IMAGE = 'machine'

/** The home `nibd` keeps the person in, and what its backup leaves out: what any
 *  package manager fetches again (4.3). */
const HOME = '/home/nib'

/** How often the alarm looks, while awake. */
const MINUTE = 60_000
/** A person is active while they said hello or typed in the last five minutes. */
const ACTIVE_FOR = 5 * MINUTE
/** Reports older than this say nothing to the awake rule any more. */
const RECENT_FOR = 15 * MINUTE
/** What the breaker gives an awake machine before it sleeps. */
const BUDGET_GRACE = 10 * MINUTE
/** How long a snapshot is good for, from its making or its last restore. */
const SNAPSHOT_KEPT = 30 * 24 * 60 * MINUTE
/** How old the home's backup may be before a sleep writes a new one. */
const BACKUP_EVERY = 6 * 60 * MINUTE
/** How long the sleep waits for `nibd` to say every screen is saved, and for the
 *  instance to stop after SIGTERM. */
const SAVE_WAIT = 15_000
const STOP_GRACE = 15_000
/** How long somebody counts as typing after a key. */
const TYPING_FOR = 2_000
/** How often a socket's `seen` is written back to it, at most. */
const SEEN_EVERY = MINUTE

/** Storage keys. */
const ME = 'me'
const STATE = 'state'
const DOWN = 'down'
const RECENT = 'recent'
const METERED = 'metered'
const GRACE = 'grace'
const RESTORED = 'restored'

/** What the door decided about a socket, kept on it across a hibernation. */
export interface Viewer {
  who: string
  device: string
  term: string
  session: string
  guest: boolean
  role: SpaceRole | null
  owns: boolean
  typing: Typing
  cols: number
  rows: number
  /** When this person last said hello or typed, by the object's clock. */
  seen: number
}

/** Who the machine is: its id and its owner. */
interface Me {
  id: string
  user: string
}

/** What a session last said, kept for the joiners after it. */
interface SessionNews {
  program?: Extract<ServerFrame, { t: 'program' }>
  ended?: Extract<ServerFrame, { t: 'ended' }>
  size?: Extract<ServerFrame, { t: 'size' }>
}

const OPEN = 1
const encoder = new TextEncoder()

export function viewerOf(socket: WebSocket): Viewer | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Viewer>
  if (typeof one.who !== 'string' || typeof one.session !== 'string') return null
  return one as Viewer
}

export class Machine implements DurableObject {
  private readonly host: MachineHost
  private link: WebSocket | null = null
  private waking: Promise<void> | null = null
  /** Each socket's next offset: what it has drawn up to; -1 for a socket waiting for a
   *  screen. In memory: the link is, too, and a new link resets them all. */
  private readonly next = new Map<WebSocket, number>()
  /** Who typed last on each session, for the size (4.6). */
  private readonly typed = new Map<string, Typed[]>()
  /** Where each session's output has reached, from the frames that came up. */
  private readonly ends = new Map<string, number>()
  private readonly news = new Map<string, SessionNews>()
  /** Input frames each person sent this second, for the rate. */
  private readonly rate = new Map<string, { second: number; count: number }>()
  private readonly lastKey = new Map<string, number>()
  /** Activity and egress since the meter last counted. */
  private pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
  private saved: (() => void) | null = null

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    host?: MachineHost,
  ) {
    this.host = host ?? new ContainerHost(ctx, env)
  }

  /* ── Requests ─────────────────────────────────────────────────────────── */

  async fetch(request: Request): Promise<Response> {
    const headers = request.headers
    await this.remember(headers)
    switch (headers.get('x-nib-machine') ?? '') {
      case 'join':
        return this.join(headers)
      case 'start':
        await this.wake()
        return Response.json({ state: await this.state() })
      case 'stop':
        await this.sleep(downOf(headers.get('x-nib-reason')))
        return Response.json({ state: await this.state() })
      case 'state':
        return Response.json({ state: await this.state() })
      case 'typing':
        this.retype(headers.get('x-nib-term') ?? '', headers.get('x-nib-typing'))
        return new Response(null, { status: 204 })
      case 'revoke':
        this.revoke(headers.get('x-nib-who') ?? '', headers.get('x-nib-role'), headers)
        return new Response(null, { status: 204 })
      case 'end':
        this.end(headers.get('x-nib-session') ?? '')
        return new Response(null, { status: 204 })
      case 'erase':
        return await this.erase()
      default:
        return new Response('not something a machine does', { status: 400 })
    }
  }

  /** The machine's id and owner, said by every request a route makes. */
  private async remember(headers: Headers): Promise<void> {
    const id = headers.get('x-nib-id')
    const user = headers.get('x-nib-user')
    if (!id || !user) return
    const known = await this.ctx.storage.get<Me>(ME)
    if (known?.id !== id || known.user !== user) await this.ctx.storage.put(ME, { id, user })
  }

  private join(headers: Headers): Response {
    const pair = new WebSocketPair()
    void this.enter(pair[1], viewerFrom(headers), headers.get('x-nib-wake') ?? 'no')
    return new Response(null, { status: 101, webSocket: pair[0] })
  }

  /** A socket the door let in. Apart from `fetch` so a test can drive it with no
   *  runtime to make the pair. `wake` is `yes` where the owner's socket may wake the
   *  machine, or why it may not. */
  async enter(server: WebSocket, viewer: Viewer, wake: string): Promise<void> {
    this.ctx.acceptWebSocket(server, [viewer.session, viewer.who])
    server.serializeAttachment(viewer)
    this.next.set(server, -1)

    if (this.ctx.getWebSockets(viewer.session).length > MOST_SOCKETS) {
      this.say(server, { t: 'refused', error: 'rate' })
      server.close(4429, 'too many sockets on this terminal')
      return
    }

    const state = await this.state()
    this.say(server, { t: 'role', type: maySocketType(viewer) })
    const reason = await this.down()
    this.say(server, { t: 'machine', state, ...(reason ? { reason } : {}) })
    const news = this.news.get(viewer.session)
    if (news?.size) this.say(server, news.size)
    if (news?.program) this.say(server, news.program)
    if (news?.ended) this.say(server, news.ended)
    this.people(viewer.session)

    const me = await this.me()
    if (me) {
      await audit(this.env, me.id, 'open', {
        who: viewer.who,
        device: viewer.device,
        detail: viewer.guest ? 'guest' : viewer.owns ? 'owner' : viewer.role,
      })
    }

    if (state === 'asleep' && viewer.owns) {
      if (wake === 'yes') await this.wake()
      else if (isRefusal(wake)) this.say(server, { t: 'refused', error: wake })
    }
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const viewer = viewerOf(socket)
    if (!viewer) return

    if (typeof message !== 'string') {
      await this.input(socket, viewer, new Uint8Array(message))
      return
    }

    const frame = clientFrameOf(message)
    if (!frame) return
    switch (frame.t) {
      case 'hello':
        await this.hello(socket, { ...viewer, cols: frame.cols, rows: frame.rows }, frame.since)
        break
      case 'in':
        await this.input(socket, viewer, encoder.encode(frame.data))
        break
      case 'size':
        this.resized(socket, { ...viewer, cols: frame.cols, rows: frame.rows })
        break
      case 'start':
        if (!maySocketType(viewer)) this.say(socket, { t: 'refused', error: 'role' })
        else this.tell(viewer.session, { t: 'open', session: viewer.session, ...this.sizeFor(viewer) })
        break
      case 'resume':
        await this.resume(socket, viewer)
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
    this.next.delete(socket)
    const viewer = viewerOf(socket)
    if (!viewer) return
    this.people(viewer.session, socket)
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'close', { who: viewer.who, device: viewer.device })
  }

  /* ── The app's frames ─────────────────────────────────────────────────── */

  /** A socket saying what it last drew. It is sent what came after, or a screen. */
  private async hello(socket: WebSocket, viewer: Viewer, since?: number): Promise<void> {
    socket.serializeAttachment({ ...viewer, seen: Date.now() })
    this.next.set(socket, since ?? -1)
    this.ensureOpen(viewer)
    this.tell(viewer.session, { t: 'want', session: viewer.session, since: since ?? 0 })

    // The owner putting a sleeping machine's terminal on screen wakes it.
    if (viewer.owns && (await this.state()) === 'asleep' && (await this.mayWake()) === null) {
      await this.wake()
    }
  }

  private async input(socket: WebSocket, viewer: Viewer, data: Uint8Array): Promise<void> {
    if (!maySocketType(viewer)) {
      this.say(socket, { t: 'refused', error: 'role' })
      return
    }
    if (data.length > MOST_INPUT) {
      this.say(socket, { t: 'refused', error: 'large' })
      return
    }
    const now = Date.now()
    const second = Math.floor(now / 1000)
    const counted = this.rate.get(viewer.who)
    const count = counted?.second === second ? counted.count + 1 : 1
    this.rate.set(viewer.who, { second, count })
    if (count > INPUT_RATE) {
      if (count === INPUT_RATE + 1) this.say(socket, { t: 'refused', error: 'rate' })
      return
    }

    if (now - viewer.seen > SEEN_EVERY) socket.serializeAttachment({ ...viewer, seen: now })

    const wasTyping = now - (this.lastKey.get(viewer.who) ?? 0) < TYPING_FOR
    this.lastKey.set(viewer.who, now)
    this.typedBy(viewer, now)

    this.ensureOpen(viewer)
    this.tell(viewer.session, { t: 'in', session: viewer.session, data })
    this.toSession(viewer.session, {
      t: 'typed',
      who: viewer.who,
      seq: this.ends.get(viewer.session) ?? 0,
    })
    if (!wasTyping) this.people(viewer.session)
  }

  /** A typist's first key makes the pty their size (tmux's `latest`). */
  private typedBy(viewer: Viewer, at: number): void {
    const list = (this.typed.get(viewer.session) ?? []).filter((one) => one.who !== viewer.who)
    list.push({ who: viewer.who, at, cols: viewer.cols, rows: viewer.rows })
    this.typed.set(viewer.session, list)
    this.applySize(viewer.session, viewer.who)
  }

  private resized(socket: WebSocket, viewer: Viewer): void {
    socket.serializeAttachment(viewer)
    const list = this.typed.get(viewer.session) ?? []
    const mine = list.find((one) => one.who === viewer.who)
    if (!mine) return
    mine.cols = viewer.cols
    mine.rows = viewer.rows
    this.applySize(viewer.session, viewer.who)
  }

  private applySize(session: string, by: string): void {
    const size = sizeOf(this.typed.get(session) ?? [])
    if (!size) return
    const news = this.news.get(session) ?? {}
    if (news.size?.cols === size.cols && news.size.rows === size.rows) return
    const frame = { t: 'size' as const, ...size, by }
    this.news.set(session, { ...news, size: frame })
    this.tell(session, { t: 'size', session, ...size })
    this.toSession(session, frame)
  }

  private sizeFor(viewer: Viewer): { cols: number; rows: number } {
    return sizeOf(this.typed.get(viewer.session) ?? []) ?? { cols: viewer.cols, rows: viewer.rows }
  }

  /** Resume (4.7): the saved agent's own continue command, typed by the owner's hand. */
  private async resume(socket: WebSocket, viewer: Viewer): Promise<void> {
    if (!viewer.owns) {
      this.say(socket, { t: 'refused', error: 'role' })
      return
    }
    const restored = (await this.ctx.storage.get<Record<string, string | null>>(RESTORED)) ?? {}
    const command = resumeOf(restored[viewer.session] ?? null)
    if (!command) return
    await this.input(socket, viewer, encoder.encode(command))
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'resume', { who: viewer.who, device: viewer.device })
  }

  /* ── The link to nibd ─────────────────────────────────────────────────── */

  private opened = new Set<string>()

  /** The session open in `nibd`, at the size it should be, once per link. */
  private ensureOpen(viewer: Viewer): void {
    if (!this.link || this.opened.has(viewer.session)) return
    this.opened.add(viewer.session)
    this.tell(viewer.session, { t: 'open', session: viewer.session, ...this.sizeFor(viewer) })
  }

  /** One frame down the link, if there is one. */
  private tell(_session: string, frame: MachineFrame): void {
    if (!this.link) return
    try {
      this.link.send(linkFrame(frame))
    } catch {
      // A link the runtime gave up on: its close handler deals with that.
    }
  }

  private async attachLink(): Promise<void> {
    const me = await this.me()
    if (!me) throw new Error('a machine that does not know its id')
    const link = await this.host.link(me.id)
    this.link = link
    this.opened = new Set()
    for (const socket of this.ctx.getWebSockets()) this.next.set(socket, -1)

    link.addEventListener('message', (event: MessageEvent) => {
      const data: unknown = event.data
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : data instanceof Uint8Array
            ? data
            : null
      const frame = bytes ? nibdFrameOf(bytes) : null
      if (frame) void this.fromNibd(frame)
    })
    link.addEventListener('close', () => {
      if (this.link === link) void this.lost()
    })

    // Every session somebody is on, opened again and asked for what they need.
    const sessions = new Map<string, Viewer>()
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = viewerOf(socket)
      if (viewer && !sessions.has(viewer.session)) sessions.set(viewer.session, viewer)
    }
    for (const viewer of sessions.values()) {
      this.ensureOpen(viewer)
      this.tell(viewer.session, { t: 'want', session: viewer.session, since: 0 })
    }
  }

  /** What `nibd` said. Exposed to the tests, which have no link to listen on. */
  async fromNibd(frame: NibdFrame): Promise<void> {
    switch (frame.t) {
      case 'out':
        this.out(frame.session, frame.seq, frame.data)
        return
      case 'screen': {
        const { t: _t, session, ...screen } = frame
        if (screen.restored) {
          const restored =
            (await this.ctx.storage.get<Record<string, string | null>>(RESTORED)) ?? {}
          await this.ctx.storage.put(RESTORED, { ...restored, [session]: screen.restored.program })
        }
        for (const socket of this.ctx.getWebSockets(session)) {
          if ((this.next.get(socket) ?? -1) >= screen.seq) continue
          this.say(socket, { t: 'screen', ...screen })
          this.next.set(socket, screen.seq)
        }
        this.ends.set(session, Math.max(this.ends.get(session) ?? 0, screen.seq))
        return
      }
      case 'program': {
        const { t: _t, session, ...program } = frame
        const said = { t: 'program' as const, ...program }
        this.news.set(session, { ...this.news.get(session), program: said })
        this.toSession(session, said)
        return
      }
      case 'ended': {
        const said = { t: 'ended' as const, code: frame.code }
        this.news.set(frame.session, { ...this.news.get(frame.session), ended: said })
        this.opened.delete(frame.session)
        this.toSession(frame.session, said)
        return
      }
      case 'activity':
        await this.activity(frame.activity)
        return
      case 'saved':
        this.saved?.()
        return
    }
  }

  /** Output, to every socket on the session from where each of them is. */
  private out(session: string, seq: number, data: Uint8Array): void {
    const end = seq + data.length
    this.ends.set(session, Math.max(this.ends.get(session) ?? 0, end))
    if (this.news.get(session)?.ended) {
      const { ended: _ended, ...rest } = this.news.get(session) ?? {}
      this.news.set(session, rest)
    }

    for (const socket of this.ctx.getWebSockets(session)) {
      const next = this.next.get(socket) ?? -1
      if (next === -1) {
        // Waiting for a screen: a stream from the very start is as good as one, drawn
        // on a cleared terminal.
        if (seq !== 0) continue
        this.say(socket, { t: 'screen', seq: 0, cols: 80, rows: 24, data: '' })
        this.send(socket, outFrame(0, data))
        this.next.set(socket, end)
        continue
      }
      if (end <= next) continue
      if (seq > next) {
        // A gap: ask for what came after what it drew, or a screen.
        this.next.set(socket, -1)
        this.tell(session, { t: 'want', session, since: next })
        continue
      }
      this.send(socket, outFrame(next, data.subarray(next - seq)))
      this.next.set(socket, end)
    }
  }

  private async activity(one: Activity): Promise<void> {
    const recent = ((await this.ctx.storage.get<Activity[]>(RECENT)) ?? []).filter(
      (old) => one.at - old.at <= RECENT_FOR,
    )
    recent.push({ ...one, at: Date.now() })
    await this.ctx.storage.put(RECENT, recent)
    // CPU as a share of the machine's vCPUs over the 30 s the report covers.
    this.pending.cpuS += one.cpu * SMALL.vcpu * 30
    this.pending.egressBytes += one.net
    this.pending.homeBytes = one.homeBytes
  }

  /** The link went without a sleep: the instance stopped under it (a restart nobody
   *  asked for, 3.4). The screens were saved on its SIGTERM; the next wake shows them. */
  private async lost(): Promise<void> {
    this.link = null
    const state = await this.state()
    if (state !== 'awake') return
    await this.meterNow()
    await this.setState('asleep', 'restart')
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'sleep', { detail: 'restart' })
    await this.ctx.storage.deleteAlarm()
  }

  /* ── Awake and asleep ─────────────────────────────────────────────────── */

  /** Wakes the machine, once however many ask at the same moment. */
  async wake(): Promise<void> {
    const state = await this.state()
    if (state === 'awake' && this.link) return
    this.waking ??= this.waken().finally(() => {
      this.waking = null
    })
    return this.waking
  }

  private async waken(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const refused = await this.mayWake()
    if (refused) {
      this.everybody({ t: 'refused', error: refused })
      return
    }

    await this.setState('starting')
    const row = await this.env.DB.prepare(
      'select snapshot, snapshot_at, snapshot_image, backup, image from machines where id = ?',
    )
      .bind(me.id)
      .first<{
        snapshot: string | null
        snapshot_at: number | null
        snapshot_image: string | null
        backup: string | null
        image: string
      }>()

    const now = Date.now()
    const secret = randomToken()
    await this.ctx.storage.put(SECRET, secret)
    const env = { NIBD_SECRET: secret }

    // A snapshot of this image, still kept, brings everything back in one step; past
    // that, a fresh system with the home put back (4.3).
    let from: Detail = 'fresh'
    try {
      const snapshot = row?.snapshot
      const good =
        snapshot &&
        row.snapshot_image === IMAGE &&
        row.snapshot_at !== null &&
        now - row.snapshot_at < SNAPSHOT_KEPT
      if (good) {
        try {
          await this.host.restore(me.id, { snapshot })
          await this.host.start(me.id, IMAGE, env)
          from = 'snapshot'
        } catch (error) {
          note(`machine ${me.id} snapshot`, error, null)
        }
      }
      if (from !== 'snapshot') {
        await this.host.start(me.id, IMAGE, env)
        if (row?.backup) {
          try {
            await this.host.restore(me.id, { backup: row.backup })
            from = 'backup'
          } catch (error) {
            note(`machine ${me.id} restore`, error, null)
            await audit(this.env, me.id, 'failed', { detail: 'backup' })
          }
        }
      }
      await this.attachLink()
    } catch (error) {
      note(`machine ${me.id} wake`, error, null)
      await audit(this.env, me.id, 'failed', { detail: 'restart' })
      await this.host.stop(me.id, 0).catch(() => undefined)
      this.link = null
      await this.setState('asleep', 'restart')
      return
    }

    await this.env.DB.prepare(
      `update machines set woke_at = ?2,
         snapshot_at = case when ?3 = 'snapshot' then ?2 else snapshot_at end
       where id = ?1`,
    )
      .bind(me.id, now, from)
      .run()
    await audit(this.env, me.id, 'wake', { detail: from })
    await this.ctx.storage.put(METERED, now)
    await this.ctx.storage.delete(GRACE)
    await this.setState('awake')
    await this.ctx.storage.setAlarm(now + MINUTE)
  }

  /** Why the machine may not wake now, or null; see gate.ts. */
  private async mayWake(): Promise<Refusal | null> {
    const me = await this.me()
    return me ? await whyNotWake(this.env, me.user, Date.now()) : 'gone'
  }

  /** The minute: count what was used, ask the rows again, and decide. */
  async alarm(): Promise<void> {
    const state = await this.state()
    if (state !== 'awake') return
    const me = await this.me()
    if (!me) return
    const now = Date.now()

    if (!this.link) {
      try {
        await this.attachLink()
      } catch {
        // The object came back without its link and could not make one: the instance
        // is gone, as after a restart.
        await this.setState('asleep', 'restart')
        return
      }
    }

    await this.meterNow()
    await this.recheck()

    const down = await this.decide(me, now)
    if (down) {
      await this.sleep(down)
      return
    }
    await this.ctx.storage.setAlarm(now + MINUTE)
  }

  /** Why the machine sleeps now, or null to stay awake. */
  private async decide(me: Me, now: number): Promise<DownReason | null> {
    const service = await serviceOf(this.env)
    if (!service.on) return 'off'
    const row = await this.env.DB.prepare(
      'select u.online as online, m.held as held, m.keep_awake as keep from users u left join machines m on m.user_id = u.id where u.id = ?',
    )
      .bind(me.user)
      .first<{ online: number; held: string | null; keep: number | null }>()
    if (row?.online !== 1) return 'off'
    if (row.held) return row.held === 'flag' ? 'flag' : 'stopped'

    const recent = (await this.ctx.storage.get<Activity[]>(RECENT)) ?? []
    const answer = awake(
      now,
      this.watchers(now),
      recent,
      row.keep === 1,
      await usedOf(this.env, me.user, now),
      FREE,
      await budgetLeft(this.env, service.ceiling, now),
    )
    if (answer.stay) {
      await this.ctx.storage.delete(GRACE)
      return null
    }
    if (answer.reason !== 'budget') return answer.reason

    // The breaker gives an awake machine ten minutes and says so on its screens.
    const grace = await this.ctx.storage.get<number>(GRACE)
    if (grace === undefined) {
      await this.ctx.storage.put(GRACE, now + BUDGET_GRACE)
      this.everybody({ t: 'machine', state: 'awake', reason: 'budget' })
      return null
    }
    return now >= grace ? 'budget' : null
  }

  private watchers(now: number): Watcher[] {
    return this.ctx.getWebSockets().flatMap((socket) => {
      const viewer = viewerOf(socket)
      if (!viewer || socket.readyState !== OPEN) return []
      const seen = Math.max(viewer.seen, this.lastKey.get(viewer.who) ?? 0)
      return [{ who: viewer.who, device: viewer.device, active: now - seen < ACTIVE_FOR, onScreen: true }]
    })
  }

  /** Sleeps the machine, saving as it goes: screens, the home, the root filesystem. */
  async sleep(reason: DownReason): Promise<void> {
    const state = await this.state()
    const me = await this.me()
    if (!me || state === 'asleep' || state === 'stopping') return
    await this.setState('stopping', reason)

    if (this.link) {
      const saved = new Promise<void>((resolve) => {
        this.saved = resolve
        setTimeout(resolve, SAVE_WAIT)
      })
      this.tell('', { t: 'sleep' })
      await saved
      this.saved = null
    }

    const now = Date.now()
    const row = await this.env.DB.prepare('select backup_at, backup_key from machines where id = ?')
      .bind(me.id)
      .first<{ backup_at: number | null; backup_key: string | null }>()
    if (state === 'awake' && (row?.backup_at ?? 0) < now - BACKUP_EVERY) {
      try {
        const record = await this.host.backup(me.id, HOME)
        const key = keyOf(record)
        await this.env.DB.prepare(
          'update machines set backup = ?2, backup_key = ?3, backup_at = ?4 where id = ?1',
        )
          .bind(me.id, record, key, now)
          .run()
        if (row?.backup_key && row.backup_key !== key) await this.env.HOMES?.delete(row.backup_key)
        await audit(this.env, me.id, 'backup')
      } catch (error) {
        note(`machine ${me.id} backup`, error, null)
        await audit(this.env, me.id, 'failed', { detail: 'backup' })
      }
    }

    if (state === 'awake') {
      try {
        const snapshot = await this.host.snapshot(me.id)
        await this.env.DB.prepare(
          'update machines set snapshot = ?2, snapshot_at = ?3, snapshot_image = ?4 where id = ?1',
        )
          .bind(me.id, snapshot, now, IMAGE)
          .run()
        await audit(this.env, me.id, 'snapshot')
      } catch (error) {
        note(`machine ${me.id} snapshot`, error, null)
        await audit(this.env, me.id, 'failed', { detail: 'snapshot' })
      }
    }

    const link = this.link
    this.link = null
    try {
      link?.close(1000, 'asleep')
    } catch {
      // Already closed.
    }
    try {
      await this.host.stop(me.id, STOP_GRACE)
    } catch (error) {
      note(`machine ${me.id} stop`, error, null)
    }

    await this.meterNow()
    await this.env.DB.prepare('update machines set slept_at = ?2 where id = ?1')
      .bind(me.id, Date.now())
      .run()
    await audit(this.env, me.id, 'sleep', { detail: reason })
    await this.ctx.storage.delete(RECENT)
    await this.ctx.storage.deleteAlarm()
    await this.setState('asleep', reason)
  }

  /** What was used since the meter last counted, added to the month. */
  private async meterNow(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const now = Date.now()
    const from = (await this.ctx.storage.get<number>(METERED)) ?? now
    const host = await this.host.usage(me.id, from).catch(() => ({ cpuS: 0, egressBytes: 0 }))
    const used = {
      awakeS: Math.max(0, (now - from) / 1000),
      cpuS: Math.max(host.cpuS, this.pending.cpuS),
      egressBytes: Math.max(host.egressBytes, this.pending.egressBytes),
    }
    const home = this.pending.homeBytes
    this.pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
    await meter(this.env, me.user, now, used)
    await this.ctx.storage.put(METERED, now)
    if (home >= 0) {
      await this.env.DB.prepare('update machines set home_bytes = ?2 where id = ?1')
        .bind(me.id, home)
        .run()
    }
  }

  /* ── Access ───────────────────────────────────────────────────────────── */

  /** Every socket's person and file asked of the rows again: what no longer reaches
   *  closes, and what may no longer type is told so. */
  private async recheck(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const sockets = this.ctx
      .getWebSockets()
      .flatMap((socket) => {
        const viewer = viewerOf(socket)
        return viewer ? [{ socket, viewer }] : []
      })
    if (!sockets.length) return

    const pairs = new Map<string, { who: string; term: string; guest: boolean }>()
    for (const { viewer } of sockets) {
      pairs.set(`${viewer.who}\n${viewer.term}`, {
        who: viewer.who,
        term: viewer.term,
        guest: viewer.guest,
      })
    }
    const reached = await reachAgain(this.env, me.id, [...pairs.values()])
    const now = new Map(reached.map((one) => [`${one.who}\n${one.term}`, one]))

    for (const { socket, viewer } of sockets) {
      const one = now.get(`${viewer.who}\n${viewer.term}`)
      if (!one || one.session !== viewer.session) {
        socket.close(4403, 'no longer reaches this terminal')
        continue
      }
      this.reattach(socket, { ...viewer, role: one.role, owns: one.owns, typing: one.typing })
    }
  }

  /** A socket's rights changed: kept on it, and said when typing changed. */
  private reattach(socket: WebSocket, viewer: Viewer): void {
    const before = viewerOf(socket)
    socket.serializeAttachment(viewer)
    if (before && maySocketType(before) !== maySocketType(viewer)) {
      this.say(socket, { t: 'role', type: maySocketType(viewer) })
    }
  }

  private retype(term: string, typing: string | null): void {
    const value: Typing = typing === 'writers' ? 'writers' : 'owner'
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = viewerOf(socket)
      if (viewer?.term === term) this.reattach(socket, { ...viewer, typing: value })
    }
  }

  /** Somebody's access to a space ended or narrowed to reading, and these are the
   *  terminals of that space on this machine. */
  private revoke(who: string, role: string | null, headers: Headers): void {
    const terms = new Set((headers.get('x-nib-terms') ?? '').split(',').filter(Boolean))
    for (const socket of this.ctx.getWebSockets(who)) {
      const viewer = viewerOf(socket)
      if (!viewer || viewer.owns || !terms.has(viewer.term)) continue
      if (role === 'read') this.reattach(socket, { ...viewer, role: 'read' })
      else socket.close(4403, 'no longer reaches this terminal')
    }
  }

  /** A session ended by its owner: the shell closed and every socket on it with it. */
  private end(session: string): void {
    this.tell(session, { t: 'close', session })
    this.opened.delete(session)
    for (const socket of this.ctx.getWebSockets(session)) {
      this.say(socket, { t: 'ended', code: null })
      socket.close(4404, 'this session ended')
    }
  }

  private async erase(): Promise<Response> {
    const me = await this.me()
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer a machine')
    try {
      this.link?.close(1000, 'erased')
    } catch {
      // Already closed.
    }
    this.link = null
    if (me) await this.host.stop(me.id, 0).catch(() => undefined)
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  /* ── State and saying things ──────────────────────────────────────────── */

  private async me(): Promise<Me | null> {
    return (await this.ctx.storage.get<Me>(ME)) ?? null
  }

  async state(): Promise<MachineState> {
    return (await this.ctx.storage.get<MachineState>(STATE)) ?? 'asleep'
  }

  private async down(): Promise<DownReason | null> {
    return (await this.ctx.storage.get<DownReason>(DOWN)) ?? null
  }

  /** A new state: kept, mirrored into the row, said to every socket and to every
   *  device of the owner through their hub. */
  private async setState(state: MachineState, reason?: DownReason): Promise<void> {
    await this.ctx.storage.put(STATE, state)
    if (reason) await this.ctx.storage.put(DOWN, reason)
    else await this.ctx.storage.delete(DOWN)

    const me = await this.me()
    if (!me) return
    await this.env.DB.prepare('update machines set state = ?2 where id = ?1').bind(me.id, state).run()
    this.everybody({ t: 'machine', state, ...(reason ? { reason } : {}) })
    await askHub(this.env, me.user, 'machine', { 'x-nib-state': state })
  }

  private people(session: string, except?: WebSocket): void {
    const now = Date.now()
    const seen = new Set<string>()
    const people = this.ctx.getWebSockets(session).flatMap((socket) => {
      const viewer = viewerOf(socket)
      if (!viewer || socket === except || socket.readyState !== OPEN) return []
      const key = `${viewer.who}\n${viewer.device}`
      if (seen.has(key)) return []
      seen.add(key)
      const typing = now - (this.lastKey.get(viewer.who) ?? 0) < TYPING_FOR
      return [{ who: viewer.who, device: viewer.device, typing }]
    })
    this.toSession(session, { t: 'people', people }, except)
  }

  private toSession(session: string, frame: ServerFrame, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      if (socket !== except) this.say(socket, frame)
    }
  }

  private everybody(frame: ServerFrame): void {
    for (const socket of this.ctx.getWebSockets()) this.say(socket, frame)
  }

  private say(socket: WebSocket, frame: ServerFrame): void {
    try {
      socket.send(text(frame))
    } catch {
      // Closing or closed: its close handler deals with that.
    }
  }

  private send(socket: WebSocket, bytes: Uint8Array): void {
    try {
      socket.send(bytes)
    } catch {
      // As above.
    }
  }
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

function maySocketType(viewer: Viewer): boolean {
  return mayType(viewer.role, viewer.guest, viewer.owns, viewer.typing)
}

/** What the door decided, off the headers it handed the object. */
function viewerFrom(headers: Headers): Viewer {
  const role = headers.get('x-nib-role')
  return {
    who: headers.get('x-nib-who') ?? '',
    device: headers.get('x-nib-device') ?? '',
    term: headers.get('x-nib-term') ?? '',
    session: headers.get('x-nib-session') ?? '',
    guest: headers.get('x-nib-guest') === 'yes',
    role: role === 'owner' || role === 'write' || role === 'read' ? role : null,
    owns: headers.get('x-nib-owns') === 'yes',
    typing: headers.get('x-nib-typing') === 'writers' ? 'writers' : 'owner',
    cols: 80,
    rows: 24,
    seen: Date.now(),
  }
}

const REFUSALS: readonly Refusal[] = [
  'gone',
  'role',
  'list',
  'allowance',
  'budget',
  'off',
  'flag',
  'sessions',
  'rate',
  'large',
]

function isRefusal(value: string): value is Refusal {
  return REFUSALS.some((one) => one === value)
}

function downOf(value: string | null): DownReason {
  return value === 'flag' || value === 'off' || value === 'budget' || value === 'allowance'
    ? value
    : 'stopped'
}

/** The command Resume types for the program a session's saved screen had in front. */
export function resumeOf(program: string | null): string | null {
  if (program === 'claude') return 'claude --continue\r'
  if (program === 'codex') return 'codex resume --last\r'
  return null
}

/** The bucket key a backup's record names, for deleting the one it replaces. */
function keyOf(record: string): string | null {
  try {
    const parsed = JSON.parse(record) as { key?: unknown }
    return typeof parsed.key === 'string' ? parsed.key : null
  } catch {
    return null
  }
}
