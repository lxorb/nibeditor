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
import { BEAT_EVERY, roomDelay } from '../backoff'

/** What a socket looks like from here; the browser's, or the tests'. */
export interface LinkSocket {
  readonly open: boolean
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
    this.stopBeat = this.world.after(BEAT_EVERY, () => {
      this.stopBeat = null
      if (this.socket !== socket) return
      this.quiet += 1
      if (this.quiet >= SILENT_BEATS) {
        this.socket = null
        socket.close()
        this.again()
        return
      }
      socket.send(BEAT)
      this.beat(socket)
    })
  }

  /** Back after a wait that grows with each try, unless it was closed or refused. */
  private again(): void {
    this.stopBeat?.()
    this.stopBeat = null
    if (this.closed || this.stopped || this.retry) return
    this.heard({ t: 'dropped' })
    this.tries += 1
    this.retry = this.world.after(roomDelay(this.tries), () => {
      this.retry = null
      this.connect()
    })
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
    this.socket.send(text(frame))
    return true
  }

  /** Bytes up, as they were made: a key xterm.js encoded itself. */
  sayBytes(bytes: Uint8Array): boolean {
    if (!this.socket?.open) return false
    this.socket.send(bytes)
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
    this.retry?.()
    this.retry = null
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
  }
}
