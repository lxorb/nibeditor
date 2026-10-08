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
 *  root filesystem is snapshotted, the home goes to R2, and the instance stops. Waking
 *  boots from the snapshot when there is a good one, and otherwise from the image with
 *  the home put back from R2 (4.3).
 *
 *  An awake machine is either working or says it is not. The link to `nibd` is pinged;
 *  a link that goes quiet or closes is made again, and where it cannot be, the machine
 *  is saved as far as it can be and started afresh, its sockets told `starting` and
 *  then `awake` (`recover`). A wake never waits on the home's backup: the machine is
 *  awake at once, and its sessions open once the home is back or could not be.
 *
 *  What the door decided about a socket lives on the socket, and the minute alarm asks
 *  the rows again for all of them at once, so a file trashed or a person taken out of a
 *  space closes what it should within a minute even when nothing told the object; the
 *  routes that change access tell it at once besides (`revoke`, `typing`, `end`).
 *
 *  A machine on a host that is always on (a Hetzner server, 4.15) is never put to sleep
 *  but by a kill switch, and keeps no snapshot or backup: its disk is a disk. It is awake
 *  once `nibd` answers; a server still setting itself up, or one whose `nibd` stopped
 *  answering, is waited for on the alarm (`waitForNibd`), and one that does not come
 *  back is power-cycled through the host's API. */

import { BEAT, BEAT_ANSWER } from '@nib/sync-core/wire'
import { randomToken } from '../crypto'
import { note } from '../failed'
import { askHub } from '../hub/reach'
import type { Env } from '../types'
import { audit, type Detail, failureOf, type Step } from './audit'
import { budgetLeft } from './budget'
import { whyNotWake } from './gate'
import { HostRefused } from './hetzner-host'
import { hostOf, SECRET } from './host'
import { meter, usedOf } from './meter'
import {
  type Activity,
  awake,
  ALLOWANCE,
  type Disk,
  diskFull,
  type HostKind,
  type MachineHost,
  type MachineState,
  mayType,
  OFF,
  sizeOf,
  SMALL,
  type SpaceRole,
  type Typed,
  type Typing,
  type Watcher,
} from '@nib/online'
import {
  clientFrameOf,
  type DownReason,
  INPUT_RATE,
  linkFrame,
  type MachineFrame,
  MOST_INPUT,
  MOST_SOCKETS,
  nibdFrameOf,
  type NibdFrame,
  outFrame,
  PING_EVERY,
  QUIET_FOR,
  type Refusal,
  REFUSALS,
  type ServerFrame,
  text,
} from '@nib/online/wire'
import { reachAgain } from './reach'
import { serviceOf } from './service'

/** The image the machine boots, by its name in wrangler.jsonc's `images`. */
const IMAGE = 'machine'

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
/** The most a host call may take before the machine gives up on it: a call with no answer
 *  must never leave the machine starting or stopping for good. */
const START_LIMIT = 90_000
const RESTORE_LIMIT = 120_000
const SAVE_LIMIT = 120_000
/** How long a link to `nibd` may take to make: the host's own tries are about ten
 *  seconds of a cold start. */
const LINK_LIMIT = 20_000
/** A restart's snapshot is of a machine that stopped answering, taken so that what is on
 *  its disk survives the restart; it gets less time than a sleep's. */
const RESTART_SAVE_LIMIT = 60_000

/** How long somebody counts as typing after a key. */
const TYPING_FOR = 2_000
/** How often a socket's `seen` is written back to it, at most. */
const SEEN_EVERY = MINUTE
/** How many addresses a machine may have opened on its owner's computer in a minute,
 *  and how many sign-in callbacks it may be asked to make: a program in a loop opens
 *  a few tabs and then nothing, never a wall of them (docs/online-terminal.md 4.13). */
const OPENS_A_MINUTE = 10
const CALLBACKS_A_MINUTE = 10

/** How often a machine that is always on is asked for `nibd` while it is set up or comes
 *  back; how long its first boot may take (cloud-init installs everything, a few
 *  minutes); how long one that stopped answering is waited for before it is
 *  power-cycled, and then for its reboot. */
const PROVISION_EVERY = 10_000
/** One that stopped answering is looked for sooner at first: a `nibd` that ended is
 *  started again by systemd in about three seconds (`RestartSec=2`, then `nib-update`),
 *  which a flat ten seconds between looks turned into fifteen (issue 208). The looks
 *  come at half the time waited so far, from one second up to `PROVISION_EVERY`. */
const FIRST_LOOK = 1_000
const FIRST_BOOT_LIMIT = 20 * MINUTE
const REBOOT_AFTER = 3 * MINUTE
const REBOOT_LIMIT = 10 * MINUTE
/** A `nibd` that goes quiet again this soon after it was linked again is restarted. */
const SILENT_AGAIN = 5 * MINUTE

/** Storage keys. */
const ME = 'me'
/** The machine's host kind, kept here too: an erased account's row is gone before its
 *  object is emptied, and the object must still know what to take away. */
const HOST = 'host'
/** An always-on machine being waited for (`Provision`). */
const PROVISION = 'provision'
const STATE = 'state'
const DOWN = 'down'
const RECENT = 'recent'
const METERED = 'metered'
const GRACE = 'grace'
const RESTORED = 'restored'

/** What a wake reads of the machine's row: its snapshot and backup. */
interface Booted {
  /** The Hetzner server under it, where there is one already (4.15). */
  server_id: number | null
  snapshot: string | null
  snapshot_at: number | null
  snapshot_image: string | null
  backup: string | null
}

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

/** An always-on machine being waited for: since when, why - a `boot` (made, or powered
 *  on) or a `recover` (its `nibd` stopped answering) - and whether it was power-cycled. */
interface Provision {
  since: number
  why: 'boot' | 'recover'
  rebooted: boolean
}

/** What a session last said, kept for the joiners after it. */
interface SessionNews {
  program?: Extract<ServerFrame, { t: 'program' }>
  ended?: Extract<ServerFrame, { t: 'ended' }>
  size?: Extract<ServerFrame, { t: 'size' }>
}

const OPEN = 1
const encoder = new TextEncoder()

/** `promise`, or an error once `ms` pass without it settling. */
function capped<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error(`${what} took longer than ${String(ms)} ms`)), ms)
  })
  return Promise.race([promise, late]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

function viewerOf(socket: WebSocket): Viewer | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null
  const one = held as Partial<Viewer>
  if (typeof one.who !== 'string' || typeof one.session !== 'string') return null
  return one as Viewer
}

export class Machine implements DurableObject {
  /** The host a test handed in, which every other choice yields to. */
  private readonly given: MachineHost | null
  /** The host, once its kind is known: machines.host, kept in storage as well. */
  private made: { kind: HostKind; host: MachineHost } | null = null
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
  /** The owner's device whose keys reached each session last: where an address a program in it
   *  asks a browser for is opened. */
  private readonly lastDevice = new Map<string, string>()
  /** When this minute's opens and callbacks began, and how many there were. */
  private opens = { minute: 0, count: 0 }
  private callbacks = { minute: 0, count: 0 }
  /** Activity and egress since the meter last counted. */
  private pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
  private saved: (() => void) | null = null
  /** A sleep running in this instance; a `stopping` kept without one was cut short. */
  private sleeping = false
  /** When the link last said anything. */
  private heard = 0
  /** A link being made again, or the machine restarted, after the last one died. */
  private recovering: Promise<void> | null = null
  /** The home being put back from its backup after a fresh start; sessions open after. */
  private restoring: Promise<void> | null = null
  /** The disk `nibd` last said, and whether its being full was said to the sockets. */
  private disk: Disk | null = null
  private diskSaid = false
  /** When a link that went quiet was last made again, for one that keeps going quiet. */
  private relinked = 0
  /** A sleep that backs the home up whatever its age: before the machine moves host. */
  private backupNow = false

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    host?: MachineHost,
  ) {
    this.given = host ?? null
    // The app's heartbeat, answered without waking the object (lib/online/link.ts).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(BEAT, BEAT_ANSWER))
  }

  /** The host this machine runs on (4.15): asked of its row once, then kept. */
  private async host(): Promise<MachineHost> {
    if (this.given) return this.given
    const kind = await this.kind()
    if (this.made?.kind !== kind) this.made = { kind, host: hostOf(kind, this.ctx, this.env) }
    return this.made.host
  }

  private async kind(): Promise<HostKind> {
    if (this.made) return this.made.kind
    const me = await this.me()
    const row = me
      ? await this.env.DB.prepare('select host from machines where id = ?')
          .bind(me.id)
          .first<{ host: HostKind }>()
      : null
    if (row) {
      await this.ctx.storage.put(HOST, row.host)
      return row.host
    }
    return (await this.ctx.storage.get<HostKind>(HOST)) ?? 'cloudflare'
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
        return await this.erase(headers.get('x-nib-id'))
      case 'restart':
        await this.restartNibd(headers.get('x-nib-who'))
        return Response.json({ state: await this.state() })
      case 'reboot':
        await this.reboot()
        return Response.json({ state: await this.state() })
      case 'host':
        await this.move(headers.get('x-nib-host') === 'hetzner' ? 'hetzner' : 'cloudflare')
        return Response.json({ state: await this.state() })
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
    if (this.diskSaid) this.say(server, { t: 'note', note: 'disk' })
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
      this.input(socket, viewer, new Uint8Array(message))
      return
    }

    const frame = clientFrameOf(message)
    if (!frame) return
    switch (frame.t) {
      case 'hello':
        await this.hello(socket, { ...viewer, cols: frame.cols, rows: frame.rows }, frame.since)
        break
      case 'in':
        this.input(socket, viewer, encoder.encode(frame.data))
        break
      case 'size':
        this.resized(socket, { ...viewer, cols: frame.cols, rows: frame.rows })
        break
      case 'start':
        if (!maySocketType(viewer)) this.say(socket, { t: 'refused', error: 'role' })
        else
          this.tell(viewer.session, { t: 'open', session: viewer.session, ...this.sizeFor(viewer) })
        break
      case 'resume':
        await this.resume(socket, viewer)
        break
      case 'callback':
        this.callback(socket, viewer, frame.url)
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
    // Before anybody typed, the pty is the size of whoever may type and arrived; after,
    // the latest typist's (4.6).
    if (maySocketType(viewer) && !this.typed.get(viewer.session)?.length) {
      this.tell(viewer.session, {
        t: 'size',
        session: viewer.session,
        cols: viewer.cols,
        rows: viewer.rows,
      })
    }
    this.tell(viewer.session, { t: 'want', session: viewer.session, since: since ?? 0 })
    // A link gone under an awake machine is made again now, not at the next minute: a
    // terminal opened meanwhile says so and waits a bounded while, never for ever.
    if (!this.link) void this.recover()

    // The owner putting a sleeping machine's terminal on screen wakes it.
    if (viewer.owns && (await this.state()) === 'asleep' && (await this.mayWake()) === null) {
      await this.wake()
    }
  }

  private input(socket: WebSocket, viewer: Viewer, data: Uint8Array): void {
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

    // Down the link before anything else is done with it, and nothing on the way waits:
    // no storage, no query, no await. A key is a round trip the typist feels, and the
    // bookkeeping after it is nobody's wait. Only the size goes first, so the key lands
    // at the typist's size (4.6).
    const wasTyping = now - (this.lastKey.get(viewer.who) ?? 0) < TYPING_FOR
    this.lastKey.set(viewer.who, now)
    if (viewer.owns) this.lastDevice.set(viewer.session, viewer.device)
    this.typedBy(viewer, now)
    this.ensureOpen(viewer)
    this.tell(viewer.session, { t: 'in', session: viewer.session, data })
    if (!this.link) void this.recover()

    if (now - viewer.seen > SEEN_EVERY) socket.serializeAttachment({ ...viewer, seen: now })
    // Said to everybody else: the typist knows they typed, and on a slow link a frame
    // per key back to them is a frame their echo queues behind.
    this.toSession(
      viewer.session,
      { t: 'typed', who: viewer.who, seq: this.ends.get(viewer.session) ?? 0 },
      socket,
    )
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
    this.input(socket, viewer, encoder.encode(command))
    const me = await this.me()
    if (me) await audit(this.env, me.id, 'resume', { who: viewer.who, device: viewer.device })
  }

  /* ── The owner's computer ──────────────────────────────────────────────── */

  /** An address a program in a session asked a browser for: to one socket of the
   *  machine's owner on that session - the device that typed there last, or else the
   *  one there longest awake - and to nobody else. A watcher in somebody's space is
   *  never sent a page by their machine (4.13). */
  private browse(session: string, url: string): void {
    if (!within(this.opens, OPENS_A_MINUTE)) return
    const owners = this.ctx.getWebSockets(session).flatMap((socket) => {
      const viewer = viewerOf(socket)
      return viewer?.owns && socket.readyState === OPEN ? [{ socket, viewer }] : []
    })
    const device = this.lastDevice.get(session)
    const chosen =
      owners.find((one) => one.viewer.device === device) ??
      owners.sort((a, b) => b.viewer.seen - a.viewer.seen)[0]
    if (chosen) this.say(chosen.socket, { t: 'browse', url })
  }

  /** A tab the owner's nib opened landed on the program's own sign-in callback: that
   *  request, made on the machine, where the program listens. The owner's alone. */
  private callback(socket: WebSocket, viewer: Viewer, url: string): void {
    if (!viewer.owns) {
      this.say(socket, { t: 'refused', error: 'role' })
      return
    }
    if (!within(this.callbacks, CALLBACKS_A_MINUTE)) {
      this.say(socket, { t: 'refused', error: 'rate' })
      return
    }
    this.tell(viewer.session, { t: 'callback', session: viewer.session, url })
  }

  /** How a callback was answered, to the owner's sockets on that session. */
  private called(session: string, frame: Extract<ServerFrame, { t: 'called' }>): void {
    for (const socket of this.ctx.getWebSockets(session)) {
      if (viewerOf(socket)?.owns) this.say(socket, frame)
    }
  }

  /* ── The link to nibd ─────────────────────────────────────────────────── */

  private opened = new Set<string>()

  /** The session open in `nibd`, at the size it should be, once per link - and not while
   *  the home is being put back, which would leave its shell in the home being replaced. */
  private ensureOpen(viewer: Viewer): void {
    if (!this.link || this.restoring || this.opened.has(viewer.session)) return
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
    const asked = (await this.host()).link(me.id)
    let link: WebSocket
    try {
      link = await capped(asked, LINK_LIMIT, 'link')
    } catch (error) {
      // A link that turns up after it was given up on is nobody's.
      asked.then(
        (late) => {
          try {
            late.close(1000, 'late')
          } catch {
            // Closed already.
          }
        },
        () => undefined,
      )
      throw error
    }
    // Binary frames as bytes, read in order: since the standard binary type
    // (compatibility date 2026), the runtime hands a socket's binary messages over as
    // Blobs, which no frame check reads.
    link.binaryType = 'arraybuffer'
    this.link = link
    this.heard = Date.now()
    this.opened = new Set()
    for (const socket of this.ctx.getWebSockets()) this.next.set(socket, -1)

    link.addEventListener('message', (event: MessageEvent) => {
      if (this.link === link) this.heard = Date.now()
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
      if (this.link === link) void this.recover()
    })
    const beat = setInterval(() => {
      this.pulse(link, beat)
    }, PING_EVERY)

    this.reopen()
  }

  /** The heartbeat (docs/online-terminal.md 4.6): a ping down the link, and a link that
   *  has said nothing at all for `QUIET_FOR` - no pong, no output, no activity - is
   *  dead whether or not it ever closes. A half-open link is what 2026-10-06's frozen
   *  terminal was: no output, keys going nowhere, new terminals waiting for ever. */
  private pulse(link: WebSocket, beat: ReturnType<typeof setInterval>): void {
    if (this.link !== link) {
      clearInterval(beat)
      return
    }
    if (Date.now() - this.heard > QUIET_FOR) {
      clearInterval(beat)
      void this.recover(true)
      return
    }
    this.tell('', { t: 'ping' })
  }

  /** Every session somebody is on, opened again and asked for what they need. */
  private reopen(): void {
    if (!this.link || this.restoring) return
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
        const { session, seq, cols, rows, data } = frame
        const screen = {
          seq,
          cols,
          rows,
          data,
          ...(frame.restored ? { restored: frame.restored } : {}),
        }
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
        const { session, name, title, mark } = frame
        const said = { t: 'program' as const, name, title, mark }
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
      case 'pong':
        return
      case 'browse':
        this.browse(frame.session, frame.url)
        return
      case 'called':
        this.called(frame.session, { t: 'called', url: frame.url, status: frame.status })
        return
    }
  }

  /** Output, to every socket on the session from where each of them is. */
  private out(session: string, seq: number, data: Uint8Array): void {
    const end = seq + data.length
    this.ends.set(session, Math.max(this.ends.get(session) ?? 0, end))
    // Output after `ended` is a new shell: the old code is no news to a joiner.
    const news = this.news.get(session)
    if (news?.ended) {
      const { program, size } = news
      this.news.set(session, { ...(program ? { program } : {}), ...(size ? { size } : {}) })
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
    // Unconfirmed: a confirmed write holds every frame the object sends until it is
    // durable, keystroke echoes included, and a report lost to a crash costs nothing.
    await this.ctx.storage.put(RECENT, recent, { allowUnconfirmed: true })
    // CPU as a share of the machine's vCPUs over the 30 s the report covers.
    this.pending.cpuS += one.cpu * SMALL.vcpu * 30
    this.pending.egressBytes += one.net
    this.pending.homeBytes = one.homeBytes
    if (one.disk) this.diskIs(one.disk)
  }

  /** The disk as `nibd` said it: kept for the row, and said under every screen once it
   *  is nearly full, and to every socket that joins while it is (4.15). */
  private diskIs(disk: Disk): void {
    this.disk = disk
    const full = diskFull(disk)
    if (full && !this.diskSaid) this.everybody({ t: 'note', note: 'disk' })
    this.diskSaid = full
  }

  /** The link went quiet (`silent`) or closed under an awake machine, or an object that
   *  restarted (every deploy restarts it) has none: made again, and where that fails,
   *  the machine restarted. Its sockets are told `starting` meanwhile, so a frozen
   *  terminal never looks alive, and `awake` once it is back. Once, however many ask. */
  private recover(silent = false): Promise<void> {
    this.recovering ??= this.recoverNow(silent).finally(() => {
      this.recovering = null
    })
    return this.recovering
  }

  private async recoverNow(silent: boolean): Promise<void> {
    // A sleep or a wake running here has the link in hand already.
    if (this.sleeping || this.waking) return
    const dead = this.link
    this.link = null
    try {
      dead?.close(4000, 'silent')
    } catch {
      // Gone already.
    }
    if ((await this.state()) !== 'awake') return
    const me = await this.me()
    if (!me) return

    this.everybody({ t: 'machine', state: 'starting' })
    try {
      await this.attachLink()
      // Put to sleep meanwhile: the sleep has the machine now.
      if ((await this.state()) !== 'awake') return
      await audit(this.env, me.id, 'relink')
      this.everybody({ t: 'machine', state: 'awake' })
      // Only a link that went quiet says anything about `nibd`: one that closed was the
      // way to it (the edge, the tunnel), and restarting `nibd` for that would end every
      // shell on the machine for nothing (issue 208).
      if (silent) await this.quietAgain(me)
      return
    } catch (error) {
      await this.failed(me, 'link', error)
    }
    await this.restart(me)
  }

  /** A `nibd` whose link went quiet again within minutes of the last one that did answers
   *  its link but not much else - a loop starved, a session wedged in it - so it is
   *  restarted: told down the fresh link, it saves every screen and its supervisor
   *  starts it again in a moment, and the link is made again after it (4.14). Only on a
   *  machine that is always on; a container is restarted whole instead. */
  private async quietAgain(me: Me): Promise<void> {
    const now = Date.now()
    const again = now - this.relinked < SILENT_AGAIN
    this.relinked = now
    if (!again || !(await this.host()).alwaysOn) return
    this.relinked = 0
    this.tell('', { t: 'restart' })
    await audit(this.env, me.id, 'restart', { detail: 'silent' })
  }

  /** The owner's Restart on a machine that is always on, which stops nothing else: `nibd`
   *  saves every screen and starts again, ending the shells, and the link is made again. */
  private async restartNibd(who: string | null): Promise<void> {
    const me = await this.me()
    if (!me || !this.link) return
    this.tell('', { t: 'restart' })
    await audit(this.env, me.id, 'restart', { who, detail: 'stopped' })
  }

  /** A machine whose `nibd` will not link. A container: what is on its disk snapshotted
   *  if it still runs (the home, and the screens `nibd` saved minutes ago), the instance
   *  stopped, and a wake from that snapshot. A server that is always on: waited for on
   *  the alarm while its supervisor starts `nibd` again, and power-cycled if it does not
   *  come back (`waitForNibd`). */
  private async restart(me: Me): Promise<void> {
    if ((await this.host()).alwaysOn) {
      await this.waitFor('recover', false)
      return
    }
    const restarting = (async () => {
      await this.setState('starting')
      await this.keep(me, 'awake', { screens: false, backup: false, limit: RESTART_SAVE_LIMIT })
      await audit(this.env, me.id, 'sleep', { detail: 'restart' })
      await this.waken()
    })()
    this.waking = restarting
    try {
      await restarting
    } finally {
      this.waking = null
    }
    // Refused a wake (the month's hours, the budget, a hold): asleep, and says so.
    if ((await this.ctx.storage.get<MachineState>(STATE)) === 'starting') {
      await this.setState('asleep', 'restart')
    }
  }

  /** An always-on machine waited for on the alarm, `starting` meanwhile: a server
   *  setting itself up (`boot`), or one whose `nibd` stopped answering (`recover`). */
  private async waitFor(why: Provision['why'], rebooted: boolean): Promise<void> {
    const now = Date.now()
    const waiting = { since: now, why, rebooted } satisfies Provision
    await this.ctx.storage.put(PROVISION, waiting)
    await this.setState('starting')
    await this.ctx.storage.setAlarm(now + nextLook(waiting, now))
  }

  /** One look for `nibd` on an always-on machine being waited for: linked, and awake;
   *  or, for one that stopped answering, power-cycled once it has been gone a few
   *  minutes - its supervisor starts a `nibd` that merely ended within seconds; or,
   *  past every limit, asleep with `restart`, which its terminals offer to try again. */
  private async waitForNibd(): Promise<void> {
    const me = await this.me()
    const waiting = await this.ctx.storage.get<Provision>(PROVISION)
    if (!me || !waiting) return
    const now = Date.now()
    try {
      await this.attachLink()
      await this.ctx.storage.delete(PROVISION)
      await this.awoke(me, now, waiting.why === 'boot' ? 'fresh' : 'restart')
      if (waiting.why === 'recover') await audit(this.env, me.id, 'relink')
      return
    } catch {
      // Not yet: said below, once it is late.
    }
    const waited = now - waiting.since
    if (waiting.why === 'recover' && !waiting.rebooted && waited >= REBOOT_AFTER) {
      await this.powerCycle(me)
      return
    }
    const limit = waiting.why === 'boot' ? FIRST_BOOT_LIMIT : REBOOT_LIMIT
    if (waited >= limit) {
      await this.failed(
        me,
        'link',
        new Error(`nibd did not answer in ${String(Math.round(waited / MINUTE))} minutes`),
      )
      await this.ctx.storage.delete(PROVISION)
      await this.setState('asleep', 'restart')
      return
    }
    // Still starting, said again: a terminal waiting on a first boot's few minutes hears
    // that it is not forgotten, and keeps waiting (lib/online/arrival.svelte.ts).
    this.everybody({ t: 'machine', state: 'starting' })
    const after = Date.now()
    await this.ctx.storage.setAlarm(after + nextLook(waiting, after))
  }

  /** The server power-cycled through its host's API, and waited for again. */
  private async powerCycle(me: Me): Promise<void> {
    const host = await this.host()
    try {
      if (!host.reboot) throw new Error('this host cannot reboot a machine')
      await capped(host.reboot(me.id), START_LIMIT, 'reboot')
      await audit(this.env, me.id, 'reboot')
    } catch (error) {
      await this.failed(me, 'start', error)
    }
    await this.waitFor('recover', true)
  }

  /** The admin's Reboot: an always-on machine power-cycled now, its link dropped, and
   *  waited for as it comes back. Nothing on a host that sleeps. */
  private async reboot(): Promise<void> {
    const me = await this.me()
    if (!me || !(await this.host()).alwaysOn) return
    const link = this.link
    this.link = null
    try {
      link?.close(1000, 'reboot')
    } catch {
      // Already closed.
    }
    this.everybody({ t: 'machine', state: 'starting' })
    await this.powerCycle(me)
  }

  /** The machine moved to another host (4.15): asleep on the one it was on first - a
   *  container saved one last time, its home backed up to R2 whatever the backup's age,
   *  where it stays to be fetched by hand - then its row and this object pointed at the
   *  other. Its owner's next terminal starts it there. */
  private async move(kind: HostKind): Promise<void> {
    const me = await this.me()
    if (!me) return
    this.backupNow = true
    try {
      await this.sleep('stopped')
    } finally {
      this.backupNow = false
    }
    await this.env.DB.prepare('update machines set host = ?2 where id = ?1').bind(me.id, kind).run()
    await this.ctx.storage.put(HOST, kind)
    await this.ctx.storage.delete(PROVISION)
    this.made = null
  }

  /** A host call that failed, written down with why (audit.ts's `failureOf`). */
  private async failed(me: Me, step: Step, error: unknown): Promise<void> {
    note(`machine ${me.id} ${step}`, error, null)
    await audit(this.env, me.id, 'failed', { detail: failureOf(step, error) })
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
      'select server_id, snapshot, snapshot_at, snapshot_image, backup from machines where id = ?',
    )
      .bind(me.id)
      .first<Booted>()

    const now = Date.now()
    const at: { step: Step } = { step: 'start' }
    const host = await this.host()
    let from: Detail
    try {
      from = await this.boot(me, row, now, at)
    } catch (error) {
      this.link = null
      if (error instanceof HostRefused) {
        this.everybody({ t: 'refused', error: error.refusal })
        await this.setState('asleep', error.refusal === 'budget' ? 'budget' : 'restart')
        return
      }
      // A server that is there and not answering yet is waited for, not given up on:
      // one just made sets itself up for minutes; one made before is power-cycled if
      // it does not answer soon.
      if (host.alwaysOn && at.step === 'link') {
        await this.waitFor(row?.server_id ? 'recover' : 'boot', false)
        return
      }
      await this.failed(me, at.step, error)
      if (!host.alwaysOn) await host.stop(me.id, 0).catch(() => undefined)
      await this.setState('asleep', 'restart')
      return
    }
    await this.awoke(me, now, from)
  }

  /** The machine linked: written down, and the minute's alarm set. */
  private async awoke(me: Me, now: number, from: Detail): Promise<void> {
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

  /** The machine up and linked, and how: the instance a sleep cut short left running,
   *  taken as it is; one booted from a good snapshot of this image, which brings
   *  everything back in one step; or a fresh one, whose home comes back from its backup
   *  behind the wake (4.3, `restoreHome`). `at` says which step a throw came from. */
  private async boot(me: Me, row: Booted | null, now: number, at: { step: Step }): Promise<Detail> {
    const host = await this.host()
    // Always on: whatever is missing made, the server powered on if it is off, and the
    // link to the `nibd` that has been running there all along.
    if (host.alwaysOn) {
      await capped(host.start(me.id, IMAGE, await this.bootEnv(me, host)), START_LIMIT, 'start')
      at.step = 'link'
      await this.attachLink()
      return 'running'
    }

    if (await host.running(me.id)) {
      try {
        at.step = 'link'
        await this.attachLink()
        return 'running'
      } catch (error) {
        await this.failed(me, 'link', error)
        await capped(host.stop(me.id, 0), STOP_GRACE, 'stop').catch(() => undefined)
      }
    }

    at.step = 'start'
    const env = await this.bootEnv(me, host)
    let from: Detail = 'fresh'
    const snapshot = row?.snapshot
    const good =
      snapshot &&
      row.snapshot_image === IMAGE &&
      row.snapshot_at !== null &&
      now - row.snapshot_at < SNAPSHOT_KEPT
    if (good) {
      try {
        await capped(host.restore(me.id, { snapshot }), RESTORE_LIMIT, 'snapshot restore')
        await capped(host.start(me.id, IMAGE, env), START_LIMIT, 'start')
        from = 'snapshot'
      } catch (error) {
        await this.failed(me, 'snapshot', error)
      }
    }
    if (from !== 'snapshot') {
      await capped(host.start(me.id, IMAGE, env), START_LIMIT, 'start')
      if (row?.backup) {
        from = 'backup'
        this.restoring = this.restoreHome(me, row.backup)
      }
    }
    at.step = 'link'
    await this.attachLink()
    return from
  }

  /** What a new instance starts with: a new link secret, and the machine's clock in its
   *  owner's zone (4.2) - the zone their newest device that said one is in, as push keeps
   *  it; UTC for an account none of whose devices did. A server that is always on keeps
   *  the secret it was made with, which is in its own files and nowhere else. */
  private async bootEnv(me: Me, host: MachineHost): Promise<Record<string, string>> {
    const kept = host.alwaysOn ? await this.ctx.storage.get<string>(SECRET) : undefined
    const secret = kept ?? randomToken()
    if (!kept) await this.ctx.storage.put(SECRET, secret)
    const zone = await this.env.DB.prepare(
      `select zone from push_targets where user_id = ? and zone is not null
        order by created_at desc limit 1`,
    )
      .bind(me.user)
      .first<{ zone: string }>()
    return { NIBD_SECRET: secret, TZ: zone?.zone ?? 'UTC' }
  }

  /** The home put back from its backup while the machine is already awake, so a slow or
   *  failed restore never holds a wake (2026-10-06: one held a machine `starting` for
   *  minutes). The sessions open once it is done either way, never in a home about to be
   *  replaced; a failed one is a line under each screen, and the fresh home stays. */
  private async restoreHome(me: Me, backup: string): Promise<void> {
    try {
      await capped((await this.host()).restore(me.id, { backup }), RESTORE_LIMIT, 'restore')
      await audit(this.env, me.id, 'restore', { detail: 'backup' })
    } catch (error) {
      await this.failed(me, 'restore', error)
      if (this.link) this.everybody({ t: 'note', note: 'restore' })
    } finally {
      this.restoring = null
      this.reopen()
    }
  }

  /** Why the machine may not wake now, or null; see gate.ts. */
  private async mayWake(): Promise<Refusal | null> {
    const me = await this.me()
    return me ? await whyNotWake(this.env, me.user, Date.now()) : 'gone'
  }

  /** The minute: count what was used, ask the rows again, and decide. Sooner while an
   *  always-on machine is waited for. */
  async alarm(): Promise<void> {
    const state = await this.state()
    if (state === 'starting' && (await this.ctx.storage.get<Provision>(PROVISION))) {
      await this.waitForNibd()
      return
    }
    if (state !== 'awake') return
    const me = await this.me()
    if (!me) return
    const now = Date.now()

    // An object that came back without its link (a deploy restarts it) makes it again,
    // or restarts the machine; see `recover`.
    if (!this.link) {
      await this.recover()
      if ((await this.state()) !== 'awake') return
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
    const row = await this.env.DB.prepare(
      `select u.online as online, m.held as held, m.keep_awake as keep
         from users u left join machines m on m.user_id = u.id where u.id = ?`,
    )
      .bind(me.user)
      .first<{ online: number; held: string | null; keep: number | null }>()
    if (row?.held) return row.held === 'flag' ? 'flag' : 'stopped'

    // The service or the account switched off is an allowance of nothing, which the
    // rule answers `off`.
    const on = service.on && row?.online === 1
    // Always on, and paid by the month: nothing but a kill switch puts it down.
    if ((await this.host()).alwaysOn) return on ? null : 'off'
    const recent = (await this.ctx.storage.get<Activity[]>(RECENT)) ?? []
    const answer = awake(
      now,
      this.watchers(now),
      recent,
      row?.keep === 1,
      await usedOf(this.env, me.user, now),
      on ? ALLOWANCE : OFF,
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
      return [
        { who: viewer.who, device: viewer.device, active: now - seen < ACTIVE_FOR, onScreen: true },
      ]
    })
  }

  /** Sleeps the machine, saving as it goes: screens, the home, the root filesystem. */
  async sleep(reason: DownReason): Promise<void> {
    const state = await this.state()
    const me = await this.me()
    if (!me || state === 'asleep' || state === 'stopping') return
    this.sleeping = true
    try {
      await this.sleepFrom(state, me, reason)
    } finally {
      this.sleeping = false
    }
  }

  private async sleepFrom(
    state: MachineState,
    me: NonNullable<Awaited<ReturnType<Machine['me']>>>,
    reason: DownReason,
  ): Promise<void> {
    await this.setState('stopping', reason)
    await this.keep(me, state, { screens: true, backup: true, limit: SAVE_LIMIT })
    await this.env.DB.prepare('update machines set slept_at = ?2 where id = ?1')
      .bind(me.id, Date.now())
      .run()
    await audit(this.env, me.id, 'sleep', { detail: reason })
    await this.ctx.storage.delete(RECENT)
    await this.ctx.storage.deleteAlarm()
    await this.setState('asleep', reason)
  }

  /** Everything of a machine going down that can be kept, kept, and its instance
   *  stopped: the screens (`nibd` asked, a bounded wait); the root filesystem's
   *  snapshot, first, because it is what the next wake boots from and a deploy can cut a
   *  sleep short at any moment (one did, twice: 2026-10-05 18:11 mid-snapshot and
   *  2026-10-06 06:51 mid-backup); the home's backup when one is due; the stop. Every
   *  step bounded, and every failure written down with its reason. */
  private async keep(
    me: Me,
    state: MachineState,
    how: { screens: boolean; backup: boolean; limit: number },
  ): Promise<void> {
    if (how.screens && this.link) {
      const saved = new Promise<void>((resolve) => {
        this.saved = resolve
        setTimeout(resolve, SAVE_WAIT)
      })
      this.tell('', { t: 'sleep' })
      await saved
      this.saved = null
    }

    const now = Date.now()
    const host = await this.host()
    // A disk of its own needs no snapshot or backup, and a server that is always on is
    // not stopped: put down by a kill switch, it is only unlinked.
    const keeps = state === 'awake' && !host.alwaysOn
    if (keeps) {
      try {
        const snapshot = await capped(host.snapshot(me.id), how.limit, 'snapshot')
        await this.env.DB.prepare(
          'update machines set snapshot = ?2, snapshot_at = ?3, snapshot_image = ?4 where id = ?1',
        )
          .bind(me.id, snapshot, now, IMAGE)
          .run()
        await audit(this.env, me.id, 'snapshot')
      } catch (error) {
        await this.failed(me, 'snapshot', error)
      }
    }

    const row = await this.env.DB.prepare('select backup_at, backup_key from machines where id = ?')
      .bind(me.id)
      .first<{ backup_at: number | null; backup_key: string | null }>()
    const due = this.backupNow || (row?.backup_at ?? 0) < now - BACKUP_EVERY
    if (how.backup && keeps && due) {
      try {
        const record = await capped(host.backup(me.id, HOME), how.limit, 'backup')
        const key = keyOf(record)
        await this.env.DB.prepare(
          'update machines set backup = ?2, backup_key = ?3, backup_at = ?4 where id = ?1',
        )
          .bind(me.id, record, key, now)
          .run()
        if (row?.backup_key && row.backup_key !== key) await this.env.HOMES?.delete(row.backup_key)
        await audit(this.env, me.id, 'backup')
      } catch (error) {
        await this.failed(me, 'backup', error)
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
      if (!host.alwaysOn) await capped(host.stop(me.id, STOP_GRACE), STOP_GRACE + 15_000, 'stop')
    } catch (error) {
      await this.failed(me, 'stop', error)
    }
    await this.meterNow()
  }

  /** What was used since the meter last counted, added to the month. */
  private async meterNow(): Promise<void> {
    const me = await this.me()
    if (!me) return
    const now = Date.now()
    const from = (await this.ctx.storage.get<number>(METERED)) ?? now
    const host = await this.host()
    const said = await host.usage(me.id, from).catch(() => ({ cpuS: 0, egressBytes: 0 }))
    const used = {
      awakeS: Math.max(0, (now - from) / 1000),
      cpuS: Math.max(said.cpuS, this.pending.cpuS),
      egressBytes: Math.max(said.egressBytes, this.pending.egressBytes),
    }
    const home = this.pending.homeBytes
    this.pending = { cpuS: 0, egressBytes: 0, homeBytes: -1 }
    // A server's month is its price, whatever it did (budget.ts); a container's is metered.
    if (!host.alwaysOn) await meter(this.env, me.user, now, used)
    await this.ctx.storage.put(METERED, now)
    if (this.disk) {
      await this.env.DB.prepare('update machines set disk_used = ?2, disk_total = ?3 where id = ?1')
        .bind(me.id, this.disk.used, this.disk.total)
        .run()
    }
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
    const sockets = this.ctx.getWebSockets().flatMap((socket) => {
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
      if (one?.session !== viewer.session) {
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

  /** The machine gone for good: its sockets, its link, its instance or its server with
   *  everything made for it, and the object's storage. A server that could not be deleted
   *  yet answers 503, and the account's leftovers ask again tomorrow. */
  private async erase(id: string | null): Promise<Response> {
    const me = await this.me()
    const machine = me?.id ?? id
    for (const socket of this.ctx.getWebSockets()) socket.close(1008, 'no longer a machine')
    try {
      this.link?.close(1000, 'erased')
    } catch {
      // Already closed.
    }
    this.link = null
    if (machine) {
      const host = await this.host()
      if (!host.alwaysOn) await host.stop(machine, 0).catch(() => undefined)
      try {
        if (host.remove) await host.remove(machine)
        // Whatever kind it was last known as, a server labelled with it is looked for
        // wherever Hetzner is set up: a machine that moved leaves nothing behind.
        else if (!this.given) await hostOf('hetzner', this.ctx, this.env).remove?.(machine)
      } catch (error) {
        note(`machine ${machine} erase`, error, null)
        return new Response('the server is still there', { status: 503 })
      }
    }
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.deleteAll()
    return new Response(null, { status: 204 })
  }

  /* ── State and saying things ──────────────────────────────────────────── */

  private async me(): Promise<Me | null> {
    return (await this.ctx.storage.get<Me>(ME)) ?? null
  }

  async state(): Promise<MachineState> {
    const kept = (await this.ctx.storage.get<MachineState>(STATE)) ?? 'asleep'
    // A deploy or eviction mid-sleep or mid-wake leaves `stopping` or `starting` behind
    // with nothing in this instance finishing it.
    // An always-on machine waited for on the alarm is starting with nothing running here.
    const orphan =
      (kept === 'stopping' && !this.sleeping) ||
      (kept === 'starting' && !this.waking && !(await this.ctx.storage.get(PROVISION)))
    if (orphan) {
      await this.ctx.storage.put(STATE, 'asleep')
      return 'asleep'
    }
    return kept
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
    await this.env.DB.prepare('update machines set state = ?2 where id = ?1')
      .bind(me.id, state)
      .run()
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

/** How long until an always-on machine being waited for is looked for again: a server
 *  setting itself up every `PROVISION_EVERY`, since its first boot takes minutes; one
 *  that stopped answering at half the time waited so far, from `FIRST_LOOK` up to the
 *  same, so a `nibd` that is back in seconds is linked in seconds. */
function nextLook(waiting: Provision, now: number): number {
  if (waiting.why === 'boot') return PROVISION_EVERY
  return Math.min(PROVISION_EVERY, Math.max(FIRST_LOOK, Math.round((now - waiting.since) / 2)))
}

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

/** Counts one more in this minute's `count`; false past `most`. */
function within(counted: { minute: number; count: number }, most: number): boolean {
  const minute = Math.floor(Date.now() / MINUTE)
  if (counted.minute !== minute) {
    counted.minute = minute
    counted.count = 0
  }
  counted.count += 1
  return counted.count <= most
}

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
