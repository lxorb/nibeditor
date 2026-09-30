/** The hub's sockets, and what each one is known by across a sleep.
 *
 *  The hub hibernates, so nothing about a socket lives in a field: what the door
 *  decided about it and what its device has said since are kept on the socket
 *  itself, and the runtime hands them back after a sleep. Tagged with the device's
 *  id, so the hub can find a device's socket without walking all of them.
 *
 *  Liveness is the one question here that is about time, and it is answered from
 *  the runtime's clock alone. A device beats every ten seconds with the bare frame
 *  `beat`, which the runtime answers `ok` without waking the hub and remembers the
 *  moment of; a device is alive while its socket is open and that moment is under
 *  thirty seconds old. Three missed beats, then. Nothing a device says about time
 *  is ever read, and before its first beat the moment the hub let it in stands in
 *  for one - also the hub's own clock. See docs/sync-v2.md section 6.2. */

import { type FromHub, say } from './frames'

/** How long after its last beat a device is still alive: three missed beats. */
const ALIVE_FOR = 30_000

/** What a hub socket carries. `who` is the account (or the guest) the hub is, as
 *  the door read it off the session; `session` is that session's id, which a
 *  device is bound to. `name` and `keyed` arrive with the device's `hello` and are
 *  empty and false until then. */
export interface Attached {
  device: string
  who: string
  session: string
  guest: boolean
  /** When the hub let this socket in, by the hub's clock. */
  since: number
  /** Whether somebody is using this device, as it last said. A device that has
   *  just connected is taken to be in use, because connecting is something a
   *  person did; one that is not says `idle` straight after `hello`. */
  active: boolean
  hello: boolean
  name: string
  /** Whether the account holds the web key wrapped to this device. */
  keyed: boolean
}

/** WebSocket.OPEN, which the runtime's type does not name as a constant. */
const OPEN = 1

export function attachedTo(socket: WebSocket): Attached | null {
  const held: unknown = socket.deserializeAttachment()
  if (typeof held !== 'object' || held === null) return null

  const one = held as Partial<Attached>
  if (typeof one.device !== 'string' || typeof one.who !== 'string') return null

  return {
    device: one.device,
    who: one.who,
    session: typeof one.session === 'string' ? one.session : '',
    guest: one.guest === true,
    since: typeof one.since === 'number' ? one.since : 0,
    active: one.active !== false,
    hello: one.hello === true,
    name: typeof one.name === 'string' ? one.name : '',
    keyed: one.keyed === true,
  }
}

export function attach(socket: WebSocket, attached: Attached): void {
  socket.serializeAttachment(attached)
}

/** The runtime's half of a hub, as much of it as liveness needs. */
export interface Runtime {
  getWebSockets(tag?: string): WebSocket[]
  getWebSocketAutoResponseTimestamp(socket: WebSocket): Date | null
}

/** The open sockets of one device, newest last. `except` is a socket that is
 *  closing and must not count, which a close handler is still holding. */
export function socketsOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket[] {
  return runtime
    .getWebSockets(device)
    .filter((one) => one !== except && one.readyState === OPEN && attachedTo(one) !== null)
}

/** The device's socket, if it has one open. A device has one socket: a second one
 *  replaces the first at the door. */
export function socketOf(runtime: Runtime, device: string, except?: WebSocket): WebSocket | null {
  return socketsOf(runtime, device, except).at(-1) ?? null
}

/** When the hub last heard from this socket: its last beat, or the moment it was
 *  let in if it has not beaten yet. */
function heardAt(runtime: Runtime, socket: WebSocket): number {
  const beat = runtime.getWebSocketAutoResponseTimestamp(socket)?.getTime() ?? 0
  return Math.max(beat, attachedTo(socket)?.since ?? 0)
}

/** Until when this device counts as alive, by the hub's clock: zero for a device
 *  with no socket open. */
export function aliveUntil(runtime: Runtime, device: string, except?: WebSocket): number {
  const socket = socketOf(runtime, device, except)
  return socket ? heardAt(runtime, socket) + ALIVE_FOR : 0
}

/** Says one thing to every open socket of one device. */
export function tellDevice(
  runtime: Runtime,
  device: string,
  frame: FromHub,
  except?: WebSocket,
): void {
  for (const socket of socketsOf(runtime, device, except)) say(socket, frame)
}

/** Every open socket, with what it carries. */
export function everySocket(
  runtime: Runtime,
  except?: WebSocket,
): { socket: WebSocket; attached: Attached }[] {
  return runtime.getWebSockets().flatMap((socket) => {
    const attached = attachedTo(socket)
    return socket !== except && socket.readyState === OPEN && attached ? [{ socket, attached }] : []
  })
}
