/** The one door into `nibd`: an HTTP server on the machine's port that `Machine` reaches
 *  through the host (the Sandbox SDK's `containerFetch`), upgraded to the link.
 *
 *  The link is taken only with the secret `Machine` handed the machine at boot, as
 *  `Authorization: Bearer <secret>`, compared in constant time; without a secret set,
 *  no link is taken at all. One link at a time: a second one with the secret is
 *  `Machine` coming back after its own restart, so it replaces the first. `/health`
 *  answers anybody, says nothing, and is what the host waits on before it links. */

import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { linkFrame, machineFrameOf } from '@nib/online/wire'
import type { Nibd } from './nibd'

/** Past this much unsent on the link the ptys stop being read; under the lower mark
 *  they are read again. */
const BEHIND = 8 * 1024 * 1024
const CAUGHT_UP = 1024 * 1024

const LINK_PATH = '/link'

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

/** Whether a request carries the link's secret. */
function allowed(request: IncomingMessage, secret: string): boolean {
  if (!secret) return false
  const given = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]
  return given !== undefined && timingSafeEqual(digest(given), digest(secret))
}

export function serve(nibd: Nibd, secret: string): Server {
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 })
  let current: WebSocket | null = null
  let paused = false

  const watch = setInterval(() => {
    const behind = current?.bufferedAmount ?? 0
    if (!paused && behind > BEHIND) nibd.pause((paused = true))
    else if (paused && behind < CAUGHT_UP) nibd.pause((paused = false))
  }, 50)
  watch.unref()

  sockets.on('connection', (socket) => {
    current?.close(4000, 'replaced')
    current = socket
    nibd.attach((frame) => {
      if (socket.readyState === socket.OPEN) socket.send(linkFrame(frame))
    })
    socket.on('message', (data, binary) => {
      if (!binary || !(data instanceof Buffer)) return
      const frame = machineFrameOf(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      if (frame) void nibd.receive(frame)
    })
    socket.on('close', () => {
      if (current !== socket) return
      current = null
      nibd.attach(null)
      if (paused) nibd.pause((paused = false))
    })
  })

  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('ok')
      return
    }
    response.writeHead(404).end()
  })

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (request.url !== LINK_PATH || !allowed(request, secret)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      return
    }
    sockets.handleUpgrade(request, socket, head, (ws) => {
      sockets.emit('connection', ws, request)
    })
  })

  server.on('close', () => {
    clearInterval(watch)
  })
  return server
}
