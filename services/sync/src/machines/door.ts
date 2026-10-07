/** The door to an online terminal: `GET /v2/online/:term/socket` (docs/online-terminal.md,
 *  4.6).
 *
 *  A socket carries no `Authorization` header, so it names its session token and its
 *  device in the subprotocols, as the hub's does, and is let in ahead of the session
 *  guard. Who reaches the session, and as what, is one query (reach.ts); the object is
 *  told the answer and never looks anybody up. The machine's owner's socket may wake
 *  the machine; everybody else watches it as it is.
 *
 *  While the service is off, or wherever the `MACHINES` binding is absent,
 *  this answers 404 like a route that does not exist. A terminal it reaches no session of
 *  is refused on a socket instead, which the app can read (refuse.ts). */

import { Hono } from 'hono'
import { tokenOf } from '@nib/rooms'
import { now, sha256 } from '../crypto'
import { note } from '../failed'
import { SIGN_IN } from '../refused'
import type { Env } from '../types'
import { askMachine } from './ask'
import { whyNotWake } from './gate'
import { DOOR, reachedOf, type Row, WHO } from './reach'
import { refusedSocket } from './refuse'
import { serviceOf } from './service'

const DEVICE_PROTOCOL = 'nib.device.'
const DEVICE = /^[A-Za-z0-9_-]{8,64}$/

export const NOT_FOUND = 'not found'
const AWAY = 'the machine is not answering - try again'

function deviceProtocol(header: string | undefined): string | null {
  const offered = (header ?? '').split(',').map((one) => one.trim())
  const id = offered.find((one) => one.startsWith(DEVICE_PROTOCOL))?.slice(DEVICE_PROTOCOL.length)
  return id && DEVICE.test(id) ? id : null
}

export const onlineDoor = new Hono<{ Bindings: Env }>()

onlineDoor.get('/:term/socket', async (context) => {
  const env = context.env
  if (!(await serviceOf(env)).on) return context.json({ error: NOT_FOUND }, 404)
  if (context.req.header('upgrade')?.toLowerCase() !== 'websocket') {
    return context.json({ error: 'an online terminal is a websocket' }, 426)
  }

  const offered = context.req.header('sec-websocket-protocol')
  const hash = await sha256(tokenOf(offered) ?? '')
  const at = now()
  const term = context.req.param('term')

  const row = await env.DB.prepare(DOOR).bind(hash, at, term, '').first<Row>()
  // Told apart: no session is a sign-in.
  if (!row && !(await env.DB.prepare(WHO).bind(hash, at).first<{ who: string }>())) {
    return context.json({ error: SIGN_IN }, 401)
  }

  const device = deviceProtocol(offered)
  if (!device) return context.json({ error: 'an online terminal socket names its device' }, 400)

  // No live session for the file, or a file this person does not reach: one answer for
  // both, on a socket the app can read it from (refuse.ts).
  const reached = row ? reachedOf(row) : null
  if (!reached) return refusedSocket('gone', `${DEVICE_PROTOCOL}${device}`)

  const wake = reached.owns ? ((await whyNotWake(env, reached.owner, at)) ?? 'yes') : 'no'
  const answer = await askMachine(env, reached.machine, 'join', {
    upgrade: 'websocket',
    'x-nib-user': reached.owner,
    'x-nib-who': reached.who,
    'x-nib-device': device,
    'x-nib-term': reached.term,
    'x-nib-session': reached.session,
    'x-nib-guest': reached.guest ? 'yes' : 'no',
    'x-nib-role': reached.role ?? '',
    'x-nib-owns': reached.owns ? 'yes' : 'no',
    'x-nib-typing': reached.typing,
    'x-nib-wake': wake,
  })

  if (!answer || (answer.status === 101 && !answer.webSocket)) {
    note(`machine ${reached.machine}`, new Error('the machine did not take the socket'), null)
    return context.json({ error: AWAY }, 503, { 'retry-after': '1' })
  }

  // The device's protocol named back, so the token is not written into a response.
  const headers = new Headers(answer.headers)
  headers.set('sec-websocket-protocol', `${DEVICE_PROTOCOL}${device}`)
  return new Response(answer.body, {
    status: answer.status,
    statusText: answer.statusText,
    headers,
    webSocket: answer.webSocket,
  })
})
