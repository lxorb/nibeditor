/** An open chat's socket to its `ChatLog` (docs/chats.md 4.4).
 *
 *  Held while a chat is open and by nothing else: every other chat hears through the
 *  account's hub. It says `hello` with the place the device holds, and the log answers
 *  with every event after it, or `behind` when the device is too far back for that, then
 *  who is here; from then on it hears events as they are placed, typing, read places and
 *  profile changes. It sends typing and read places. A post never goes this way: the
 *  outbox posts over HTTP and waits for each answer in turn, as Slack's clients post
 *  through its API and listen on its socket, so the order of one device's events never
 *  depends on two ends of a socket agreeing about it.
 *
 *  Comes back on its own after a drop, saying `hello` again with whatever place the
 *  device holds by then. A close the log made on purpose (the reader was taken out of
 *  the space, or the chat is gone) is not reconnected after. */

import type { Logged, Who } from '@nib/chats'
import { serverFrameOf, socketPath, text, type ClientFrame } from '@nib/chats/wire'
import { subprotocol } from '@nib/rooms'
import { BEAT, DEVICE_PROTOCOL } from '@nib/sync-core/wire'
import { BASE } from '../api'
import { BEAT_EVERY, roomDelay } from '../backoff'

/** The log closed the socket on purpose: access ended, or the chat did. */
const ENDED = 1008

/** What a socket hears, handed to whoever opened it. */
export interface Heard {
  events(events: Logged[]): void
  behind(seq: number): void
  typing(who: Who, parent: string | undefined): void
  read(who: Who, seq: number): void
  here(who: Who[]): void
  profile(who: Who): void
  /** Open and greeted, or gone. */
  state(open: boolean): void
  /** Closed for good by the log. */
  ended(): void
}

/** A socket, as much of it as this uses, so a test hands in its own. */
export interface Wire {
  send(text: string): void
  close(): void
}

export type Dial = (
  url: string,
  protocols: string[],
  on: { opened(): void; heard(text: string): void; closed(code: number): void },
) => Wire

/** The browser's own WebSocket. */
const dialWebSocket: Dial = (url, protocols, on) => {
  const socket = new WebSocket(url, protocols)
  socket.onopen = () => on.opened()
  socket.onmessage = (event: MessageEvent<unknown>) => {
    if (typeof event.data === 'string') on.heard(event.data)
  }
  socket.onclose = (event) => on.closed(event.code)
  socket.onerror = () => undefined
  return {
    send: (said) => socket.send(said),
    close: () => {
      socket.onclose = null
      socket.onmessage = null
      socket.close()
    },
  }
}

export class ChatSocket {
  private wire: Wire | null = null
  private greeted = false
  private stopped = false
  private tries = 0
  private retry: ReturnType<typeof setTimeout> | undefined
  private beat: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly chat: string,
    private readonly token: string,
    private readonly device: string | null,
    /** The place the device holds now, said with every `hello`. */
    private readonly since: () => number,
    private readonly heard: Heard,
    private readonly dial: Dial = dialWebSocket,
  ) {
    this.connect()
  }

  get open(): boolean {
    return this.greeted
  }

  /** The composer's words changed. The log relays at most one every three seconds, so
   *  this sends no more than that either. */
  typing(parent?: string): boolean {
    return this.say(parent ? { t: 'typing', parent } : { t: 'typing' })
  }

  read(seq: number): boolean {
    return this.say({ t: 'read', seq })
  }

  close(): void {
    this.stopped = true
    clearTimeout(this.retry)
    this.drop()
  }

  private say(frame: ClientFrame): boolean {
    if (!this.greeted || !this.wire) return false
    try {
      this.wire.send(text(frame))
      return true
    } catch {
      return false
    }
  }

  private connect(): void {
    if (this.stopped) return
    const url = `${BASE.replace(/^http/, 'ws')}${socketPath(this.chat)}`
    const protocols = [
      subprotocol(this.token),
      ...(this.device ? [`${DEVICE_PROTOCOL}${this.device}`] : []),
    ]
    let wire: Wire | null = null
    try {
      wire = this.dial(url, protocols, {
        opened: () => {
          if (this.wire !== wire || !wire) return
          this.tries = 0
          wire.send(text({ t: 'hello', since: this.since() }))
          this.greeted = true
          this.heard.state(true)
          clearInterval(this.beat)
          this.beat = setInterval(() => {
            try {
              wire?.send(BEAT)
            } catch {
              // Closing; its close brings the next.
            }
          }, BEAT_EVERY)
        },
        heard: (said) => {
          if (this.wire === wire) this.hear(said)
        },
        closed: (code) => {
          if (this.wire !== wire) return
          this.drop()
          if (code === ENDED) {
            this.stopped = true
            this.heard.ended()
            return
          }
          this.again()
        },
      })
    } catch {
      this.again()
      return
    }
    this.wire = wire
  }

  private hear(said: string): void {
    const frame = serverFrameOf(said)
    if (!frame) return
    switch (frame.t) {
      case 'events':
        this.heard.events(frame.events)
        break
      case 'behind':
        this.heard.behind(frame.seq)
        break
      case 'typing':
        this.heard.typing(frame.who, frame.parent)
        break
      case 'read':
        this.heard.read(frame.who, frame.seq)
        break
      case 'here':
        this.heard.here(frame.who)
        break
      case 'profile':
        this.heard.profile(frame.who)
        break
      case 'placed':
      case 'refused':
        // The outbox posts over HTTP and reads its answers there.
        break
    }
  }

  private drop(): void {
    clearInterval(this.beat)
    this.beat = undefined
    const wire = this.wire
    this.wire = null
    if (this.greeted) {
      this.greeted = false
      this.heard.state(false)
    }
    wire?.close()
  }

  private again(): void {
    if (this.stopped || this.retry) return
    this.tries += 1
    this.retry = setTimeout(() => {
      this.retry = undefined
      this.connect()
    }, roomDelay(this.tries))
  }
}
