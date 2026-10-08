/** The socket from one online terminal to its session (docs/online-terminal.md 4.6): the
 *  account's `Machine` at `/v2/online/:term/socket`, which checks the space's role and
 *  passes the session's output on.
 *
 *  - **Opening** says `hello` with the screen's size and, after a drop, the offset of the
 *    first byte not yet drawn, so a reconnect is sent only what it missed - or the whole
 *    screen, where that is no longer kept.
 *  - **Output** is a binary frame, its offset and its bytes. A frame from before the
 *    offset (sent again across a reconnect) loses what was drawn; a screen starts the
 *    count again at its own.
 *  - **Dropping** brings it back by itself, sooner first and then less often: a laptop
 *    that slept, a train in a tunnel. Not after a refusal that waiting cannot change - no
 *    role, not on the list, the month's hours used - which waits for the reader instead.
 *  - **A heartbeat** every ten seconds, which the `Machine` answers without waking: a
 *    socket that has heard nothing for three of them is dead whether or not the browser
 *    ever says so - a laptop's Wi-Fi on a plane, a network that changed under it - and
 *    is dropped and made again, so a terminal never looks live on a dead socket.
 *  - **A quick look** where three beats would be felt (issue 208): the network coming
 *    back, the window looked at again, a computer waking from sleep (a beat that fires
 *    far later than it was set for), and keys typed. A beat goes at once, and a socket
 *    that answers nothing within `PROBE_WITHIN` is dropped and made again. A wait
 *    between tries is cut short then, and a socket still being made on the network that
 *    was is made again; one that never opens is given up after `OPEN_WITHIN` rather than
 *    left to the browser, which can wait minutes on a network that went.
 *
 *  Pure of the page: the socket, the clock and the token are the world's, so the tests
 *  drive it with a fake (link.test.ts). */

import {
  type ClientFrame,
  outOf,
  type Refusal,
  type ServerFrame,
  serverFrameOf,
  socketPath,
  text,
} from '@nib/online/wire'
import { BEAT } from '@nib/sync-core/wire'
import { BEAT_EVERY, linkDelay } from '../backoff'

/** What a socket looks like from here; the browser's, or the tests'. */
export interface LinkSocket {
  readonly open: boolean
  /** Bytes sent and not yet on the network. */
  readonly buffered: number
  send(data: string | Uint8Array): void
  close(): void
}

export interface LinkWorld {
  /** The service's address, `https://...`. */
  base: string
  token(): string | null
  device(): Promise<string>
  socket(
    url: string,
    protocols: string[],
    events: {
      opened(): void
      heard(data: string | ArrayBuffer): void
      closed(code: number): void
    },
  ): LinkSocket
  /** Calls `run` after `ms`; answers what cancels it. */
  after(ms: number, run: () => void): () => void
  /** The time, in ms. */
  now(): number
  /** Whether the window is out of sight. */
  hidden(): boolean
  /** Calls `back` when the network comes back or the window is looked at again;
   *  answers what stops that. */
  watch(back: () => void): () => void
}

/** What the link tells the terminal. */
export type Heard =
  | { t: 'out'; data: Uint8Array }
  | ServerFrame
  /** The socket is open and said hello. */
  | { t: 'open' }
  /** The socket dropped and is coming back by itself. */
  | { t: 'dropped' }

/** Beats with nothing heard after which a socket is counted dead. */
const SILENT_BEATS = 3

/** How long a quick look waits for anything at all: the `Machine`'s runtime answers a
 *  beat at once, so a second or two is the network's own slowness, and more is a socket
 *  that is gone. */
export const PROBE_WITHIN = 3_000

/** How long a socket may take to open: the door's checks and the `Machine`'s welcome
 *  take well under a second, so this is a network that went while it was being made. */
export const OPEN_WITHIN = 10_000

/** A beat this much later than it was set for is a computer that slept in between: the
 *  socket it had is most likely gone. */
const SLEPT = BEAT_EVERY

/** Refusals that the same socket, asked again later, would get again. */
const FINAL: readonly Refusal[] = ['gone', 'list', 'allowance', 'budget', 'off', 'flag']

export class Link {
  /** The offset of the first byte not drawn, once anything has been. */
  private since: number | null = null
  private socket: LinkSocket | null = null
  private retry: (() => void) | null = null
  private tries = 0
  private closed = false
  /** Why the last refusal that waits for the reader was given, if one was. */
  private stopped: Refusal | null = null
  private size: { cols: number; rows: number }
  /** Beats since anything was heard, and what stops the next one. */
  private quiet = 0
  private stopBeat: (() => void) | null = null
  /** What gives up on a quick look, while one waits for an answer. */
  private probing: (() => void) | null = null
  /** What gives up on a socket that has not opened yet, and when it was begun. */
  private opening: (() => void) | null = null
  private madeAt = 0
  /** What stops listening for the network and the window. */
  private unwatch: (() => void) | null = null

  constructor(
    private readonly term: string,
    private readonly world: LinkWorld,
    private readonly heard: (what: Heard) => void,
    cols: number,
    rows: number,
  ) {
    this.size = { cols, rows }
  }

  /** Opens it; and again, after a refusal that waited for the reader. */
  open(): void {
    this.closed = false
    this.stopped = null
    this.retry?.()
    this.retry = null
    this.unwatch ??= this.world.watch(() => {
      this.back()
    })
    this.connect()
  }

  /** The network came back or the window is looked at again: an open socket is looked
   *  at, a socket still being made on the network that was is made again, and a wait
   *  between tries is cut short. Nothing after a refusal, or once closed. */
  private back(): void {
    if (this.closed || this.stopped) return
    const socket = this.socket
    if (socket?.open) {
      this.probe()
      return
    }
    if (socket) {
      // One begun a moment ago is left to finish: a click on the window is no news.
      if (this.world.now() - this.madeAt < PROBE_WITHIN) return
      this.tries = 0
      this.drop(socket, true)
      return
    }
    if (!this.retry) return
    this.tries = 0
    this.retry()
    this.retry = null
    this.connect()
  }

  private connect(): void {
    const token = this.world.token()
    if (this.closed || this.socket || !token) return

    void this.world.device().then(
      (device) => {
        if (this.closed || this.socket) return
        const url = `${this.world.base.replace(/^http/, 'ws')}${socketPath(this.term)}`
        let socket: LinkSocket | null = null
        try {
          socket = this.world.socket(url, [`nib.token.${token}`, `nib.device.${device}`], {
            opened: () => {
              if (this.socket !== socket || !socket) return
              this.opening?.()
              this.opening = null
              this.tries = 0
              this.quiet = 0
              this.beat(socket)
              this.say({
                t: 'hello',
                ...this.size,
                ...(this.since === null ? {} : { since: this.since }),
              })
              this.heard({ t: 'open' })
            },
            heard: (data) => {
              if (this.socket !== socket) return
              this.quiet = 0
              this.probing?.()
              this.probing = null
              this.hear(data)
            },
            closed: () => {
              if (this.socket !== socket) return
              this.socket = null
              this.again()
            },
          })
        } catch {
          // An address the page will not open a socket to: tried again, as a drop is.
          this.again()
          return
        }
        this.socket = socket
        const made = socket
        this.madeAt = this.world.now()
        this.opening = this.world.after(OPEN_WITHIN, () => {
          this.opening = null
          if (this.socket === made && !made.open) this.drop(made)
        })
      },
      () => {
        this.again()
      },
    )
  }

  /** The next beat, and a socket silent for `SILENT_BEATS` of them dropped and made
   *  again. Anything heard is an answer: the `ok` to a beat, output, a frame. */
  private beat(socket: LinkSocket): void {
    this.stopBeat?.()
    const set = this.world.now()
    this.stopBeat = this.world.after(BEAT_EVERY, () => {
      this.stopBeat = null
      if (this.socket !== socket) return
      this.beat(socket)
      // Asleep in between: whatever the count says, the socket is asked now.
      if (this.world.now() - set > BEAT_EVERY + SLEPT) {
        this.probe()
        return
      }
      this.quiet += 1
      if (this.quiet >= SILENT_BEATS) {
        this.drop(socket)
        return
      }
      this.send(socket, BEAT)
    })
  }

  /** A beat now, and the socket dropped and made again if nothing at all comes back
   *  within `PROBE_WITHIN`; one look at a time, and only at a socket that is open. */
  private probe(): void {
    const socket = this.socket
    if (!socket?.open || this.probing) return
    this.send(socket, BEAT)
    this.answer(socket)
  }

  /** The look's deadline. A socket still sending - a long paste on a slow uplink, the
   *  beat behind it - is given another while it does; one that is gone is still caught
   *  by its silent beats. */
  private answer(socket: LinkSocket): void {
    this.probing = this.world.after(PROBE_WITHIN, () => {
      this.probing = null
      if (this.socket !== socket) return
      if (socket.buffered > 0) this.answer(socket)
      else this.drop(socket)
    })
  }

  /** A socket given up on: closed, and made again - at once with `now`. */
  private drop(socket: LinkSocket, now = false): void {
    this.socket = null
    socket.close()
    this.again(now)
  }

  /** Back after a wait that grows with each try - or at once with `now` - unless it was
   *  closed or refused. */
  private again(now = false): void {
    this.stopBeat?.()
    this.stopBeat = null
    this.probing?.()
    this.probing = null
    this.opening?.()
    this.opening = null
    if (this.closed || this.stopped || this.retry) return
    this.heard({ t: 'dropped' })
    if (now) {
      this.connect()
      return
    }
    this.tries += 1
    this.retry = this.world.after(linkDelay(this.tries, this.world.hidden()), () => {
      this.retry = null
      this.connect()
    })
  }

  /** A frame up, where the socket still takes one. */
  private send(socket: LinkSocket, data: string | Uint8Array): void {
    try {
      socket.send(data)
    } catch {
      // Closing under us: its close brings the next one.
    }
  }

  private hear(data: string | ArrayBuffer): void {
    if (typeof data !== 'string') {
      const out = outOf(new Uint8Array(data))
      if (!out) return
      const end = out.seq + out.data.length
      // Drawn already, all or some of it: what a reconnect sends again.
      if (this.since !== null && end <= this.since) return
      const skip = this.since === null ? 0 : Math.max(0, this.since - out.seq)
      this.since = end
      this.heard({ t: 'out', data: out.data.subarray(skip) })
      return
    }

    const frame = serverFrameOf(data)
    if (!frame) return
    if (frame.t === 'screen') this.since = frame.seq
    if (frame.t === 'refused' && FINAL.includes(frame.error)) this.stopped = frame.error
    this.heard(frame)
  }

  /** A frame up, if the socket is open; nothing waits for one that is not, since what
   *  the reader typed into a dropped terminal is not what they would type into the
   *  screen they will see when it is back. */
  say(frame: ClientFrame): boolean {
    if (!this.socket?.open) return false
    this.send(this.socket, text(frame))
    // Keys going into a socket that is gone would be felt at once: looked at now.
    if (frame.t === 'in') this.probe()
    return true
  }

  /** Bytes up, as they were made: a key xterm.js encoded itself. */
  sayBytes(bytes: Uint8Array): boolean {
    if (!this.socket?.open) return false
    this.send(this.socket, bytes)
    this.probe()
    return true
  }

  /** The screen's size here, said now and with every hello after. */
  resize(cols: number, rows: number): void {
    if (cols === this.size.cols && rows === this.size.rows) return
    this.size = { cols, rows }
    this.say({ t: 'size', cols, rows })
  }

  /** Whether it is open now. */
  get live(): boolean {
    return this.socket?.open === true
  }

  close(): void {
    this.closed = true
    this.stopBeat?.()
    this.stopBeat = null
    this.probing?.()
    this.probing = null
    this.opening?.()
    this.opening = null
    this.retry?.()
    this.retry = null
    this.unwatch?.()
    this.unwatch = null
    const socket = this.socket
    this.socket = null
    socket?.close()
  }
}

/** The page's world: the browser's socket and clock. */
export function pageWorld(
  base: string,
  token: () => string | null,
  device: () => Promise<string>,
): LinkWorld {
  return {
    base,
    token,
    device,
    socket: (url, protocols, events) => {
      const socket = new WebSocket(url, protocols)
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        events.opened()
      }
      socket.onmessage = (event: MessageEvent<unknown>) => {
        const { data } = event
        if (typeof data === 'string' || data instanceof ArrayBuffer) events.heard(data)
      }
      socket.onclose = (event) => {
        events.closed(event.code)
      }
      // A socket that failed reports an error and then a close; the close brings it back.
      socket.onerror = () => undefined
      return {
        get open() {
          return socket.readyState === WebSocket.OPEN
        },
        get buffered() {
          return socket.bufferedAmount
        },
        send: (data) => {
          socket.send(data)
        },
        close: () => {
          socket.onopen = null
          socket.onmessage = null
          socket.onclose = null
          socket.close()
        },
      }
    },
    after: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => clearTimeout(timer)
    },
    now: () => Date.now(),
    hidden: () => document.visibilityState === 'hidden',
    watch: (back) => {
      const looked = () => {
        if (document.visibilityState !== 'hidden') back()
      }
      addEventListener('online', back)
      addEventListener('focus', looked)
      document.addEventListener('visibilitychange', looked)
      return () => {
        removeEventListener('online', back)
        removeEventListener('focus', looked)
        document.removeEventListener('visibilitychange', looked)
      }
    },
  }
}
