/** The socket a room is reached over, and getting it back when it goes.
 *
 *  Nothing here knows what the bytes mean. It opens, it hands over what arrives,
 *  it says when the connection came and went, and it keeps trying with a wait that
 *  doubles - because a note somebody is writing in should be back in its room
 *  before they have noticed it left.
 *
 *  The token goes in the subprotocol. A browser will not put a header on a
 *  WebSocket, and a token in the address is a token in a log; a subprotocol is a
 *  header the browser sets itself, and the server names it back. */

import { subprotocol } from '@nib/rooms'
import { roomDelay } from '../backoff'
import { BASE } from '../api'

/** What the socket does, in the words of whoever is listening. */
export interface Wire {
  /** The socket is open and nothing has been said over it yet. */
  opened: () => void
  heard: (message: Uint8Array) => void
  /** It has gone, and another will be along - with the code and the words it went
   *  with, because two of the codes mean another will not do: one says the room on
   *  the other end is not the room this document was talking to any more, and one
   *  says the room will take no more keystrokes and the words are why. Whoever is
   *  listening may call `stop` from in here, and nothing will be reconnected; see
   *  door.ts. */
  closed: (code: number, said: string) => void
}

/** Where a note's room lives. */
function roomUrl(noteId: string): string {
  return `${BASE.replace(/^http/, 'ws')}/rooms/${encodeURIComponent(noteId)}`
}

export class RoomSocket {
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private tries = 0
  private stopped = false

  constructor(
    private readonly noteId: string,
    private readonly token: string,
    private readonly wire: Wire,
  ) {}

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  start() {
    this.stopped = false
    this.connect()
  }

  /** Answers whether it went. A message that could not be sent is not a message
   *  to keep: whatever it said is in the document, and the whole document is what
   *  the next connection opens by comparing. */
  send(message: Uint8Array): boolean {
    if (!this.open) return false

    // A view onto a larger buffer would send the whole buffer.
    this.socket?.send(message.slice())
    return true
  }

  stop() {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null

    const socket = this.socket
    this.socket = null
    // The handlers go first: closing on purpose is not something to reconnect
    // after, and the browser fires `close` either way.
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
    }
  }

  private connect() {
    if (this.stopped) return

    // A URL the browser refuses, or a page with no WebSocket at all, must not
    // take the app down with it.
    let socket: WebSocket
    try {
      socket = new WebSocket(roomUrl(this.noteId), [subprotocol(this.token)])
    } catch {
      this.again()
      return
    }

    this.socket = socket
    socket.binaryType = 'arraybuffer'

    socket.onopen = () => {
      this.tries = 0
      this.wire.opened()
    }

    socket.onmessage = (event: MessageEvent<unknown>) => {
      // Everything a room says is bytes. Anything else is not this protocol.
      if (event.data instanceof ArrayBuffer) this.wire.heard(new Uint8Array(event.data))
    }

    socket.onclose = (event: CloseEvent) => {
      if (this.socket !== socket) return

      this.socket = null
      // Said first, so that a listener which decides this socket is not to come
      // back can stop it before the wait for the next one is set going. The reason
      // is the service's own sentence where it sent one; every code but two closes
      // with none, and those two are the ones a reader hears about.
      this.wire.closed(event.code, event.reason)
      this.again()
    }

    // A socket that failed to open reports an error and then a close, so there
    // is nothing to do here that the close does not already do.
    socket.onerror = () => undefined
  }

  private again() {
    if (this.stopped || this.timer) return

    this.tries++
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, roomDelay(this.tries))
  }
}
