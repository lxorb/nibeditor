import type { AddressInfo } from 'node:net'
import { afterEach, expect, test } from 'vitest'
import { WebSocket } from 'ws'
import { linkFrame, nibdFrameOf, type MachineFrame, type NibdFrame } from '@nib/online/wire'
import type { Nibd } from './nibd'
import { serve } from './server'

const SECRET = 'a-secret-for-this-boot'

/** A `nibd` that only records what the link did to it. */
function fake() {
  const received: MachineFrame[] = []
  let send: ((frame: NibdFrame) => void) | null = null
  const nibd = {
    attach: (to: typeof send) => {
      send = to
    },
    receive: (frame: MachineFrame) => {
      received.push(frame)
      return Promise.resolve()
    },
    pause: () => undefined,
  }
  return { nibd: nibd as unknown as Nibd, received, say: (frame: NibdFrame) => send?.(frame) }
}

const servers: { close: () => void }[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.close()
})

async function started(secret = SECRET) {
  const machine = fake()
  const server = serve(machine.nibd, secret)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { ...machine, url: `ws://127.0.0.1:${String(port)}`, port }
}

function linked(url: string, secret: string | null): Promise<WebSocket> {
  const socket = new WebSocket(`${url}/link`, {
    headers: secret === null ? {} : { authorization: `Bearer ${secret}` },
  })
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

function next(socket: WebSocket): Promise<NibdFrame | null> {
  return new Promise((resolve) => {
    socket.once('message', (data: Buffer) => resolve(nibdFrameOf(new Uint8Array(data))))
  })
}

test('health answers anybody, and says nothing', async () => {
  const { port } = await started()
  const response = await fetch(`http://127.0.0.1:${String(port)}/health`)
  expect(response.status).toBe(200)
  expect(await response.text()).toBe('ok')
})

test('the link is refused without the secret, with a wrong one, and when none was set', async () => {
  const { url } = await started()
  await expect(linked(url, null)).rejects.toThrow(/401/)
  await expect(linked(url, 'guess')).rejects.toThrow(/401/)
  const unset = await started('')
  await expect(linked(unset.url, '')).rejects.toThrow(/401/)
})

test('with the secret, frames cross both ways as envelopes', async () => {
  const { url, received, say } = await started()
  const socket = await linked(url, SECRET)
  socket.send(linkFrame({ t: 'open', session: 's_1', cols: 80, rows: 24 }))
  socket.send(linkFrame({ t: 'in', session: 's_1', data: new Uint8Array([104, 105]) }))
  await expect.poll(() => received.length).toBe(2)
  expect(received[0]).toEqual({ t: 'open', session: 's_1', cols: 80, rows: 24 })
  expect(received[1]).toEqual({ t: 'in', session: 's_1', data: new Uint8Array([104, 105]) })

  const arriving = next(socket)
  say({ t: 'out', session: 's_1', seq: 7, data: new Uint8Array([1, 2, 3]) })
  expect(await arriving).toEqual({
    t: 'out',
    session: 's_1',
    seq: 7,
    data: new Uint8Array([1, 2, 3]),
  })
  socket.close()
})

test('a frame that does not check is dropped, not passed on', async () => {
  const { url, received } = await started()
  const socket = await linked(url, SECRET)
  socket.send(new Uint8Array([1, 2, 3]))
  socket.send('{"t":"sleep"}')
  socket.send(linkFrame({ t: 'sleep' }))
  await expect.poll(() => received.length).toBe(1)
  expect(received).toEqual([{ t: 'sleep' }])
  socket.close()
})

test('a second link replaces the first: Machine back after its own restart', async () => {
  const { url, say } = await started()
  const first = await linked(url, SECRET)
  const closed = new Promise<number>((resolve) => first.once('close', resolve))
  const second = await linked(url, SECRET)
  expect(await closed).toBe(4000)
  const arriving = next(second)
  say({ t: 'saved' })
  expect(await arriving).toEqual({ t: 'saved' })
  second.close()
})

test('a ping is answered at once, before anything else is done with it', async () => {
  const { url, received } = await started()
  const socket = await linked(url, SECRET)
  const arriving = next(socket)
  socket.send(linkFrame({ t: 'ping' }))
  expect(await arriving).toEqual({ t: 'pong' })
  expect(received).toEqual([])
  socket.close()
})

test('a link that pinged and then fell silent is dropped and let go of', async () => {
  const attached: unknown[] = []
  const { nibd } = fake()
  ;(nibd as unknown as { attach: (to: unknown) => void }).attach = (to) => attached.push(to)
  const server = serve(nibd, SECRET, { silentFor: 300 })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const socket = await linked(`ws://127.0.0.1:${String(port)}`, SECRET)
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()))

  socket.send(linkFrame({ t: 'ping' }))
  await closed
  // Attached on the link, then let go of when it was dropped.
  await expect.poll(() => attached.at(-1)).toBeNull()
})

test('a link that never pinged is never judged by its silence', async () => {
  const machine = fake()
  const server = serve(machine.nibd, SECRET, { silentFor: 100 })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const socket = await linked(`ws://127.0.0.1:${String(port)}`, SECRET)
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(socket.readyState).toBe(WebSocket.OPEN)
  socket.close()
})
