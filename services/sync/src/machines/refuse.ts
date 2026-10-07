/** A socket the door turns away for good, let in only to be told why (docs/online-terminal.md
 *  4.6). A page never sees the status a refused upgrade answers with: a 404 reaches it as
 *  a socket that closed, the same as a network that dropped, and the app tries a dropped
 *  socket again by itself. So a terminal whose session is gone - its machine replaced, the
 *  session ended, the file no longer shared - answers with a socket that says `refused`
 *  and closes, which the app reads as final and stops trying (2026-10-07: a tab like that
 *  retried silently forever). */

import { type Refusal, text } from '@nib/online/wire'

/** What a refused socket closes with: a policy's end, not a drop. */
export const REFUSED_CLOSE = 4404

/** The server's half: the refusal said, and the socket closed after it. */
export function refuse(server: WebSocket, error: Refusal): void {
  server.accept()
  server.send(text({ t: 'refused', error }))
  server.close(REFUSED_CLOSE, error)
}

/** The answer to the upgrade. `protocol` is the one subprotocol named back, without which
 *  a browser fails a handshake that offered any. */
export function refusedSocket(error: Refusal, protocol: string): Response {
  const pair = new WebSocketPair()
  refuse(pair[1], error)
  return new Response(null, {
    status: 101,
    webSocket: pair[0],
    headers: { 'sec-websocket-protocol': protocol },
  })
}
