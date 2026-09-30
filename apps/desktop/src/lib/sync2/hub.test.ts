/** The one socket a device keeps to its account's hub, against a socket, a channel and
 *  a clock that are stood in for: what it says as it opens, the beat, what it hands to
 *  whoever listens, coming back after a drop and not after an ending, and one socket for
 *  every window, the others speaking through it. */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { BEAT_EVERY } from '../backoff'
import { Hub, type HubWorld, type SocketEvents } from './hub.svelte'

interface Opened {
  url: string
  protocols: string[]
  events: SocketEvents
  said: string[]
  open: boolean
  closed: boolean
}

let sockets: Opened[]
let ticks: (() => void)[]
/** What every window's channel hears, in the order it was said. */
let bus: ((message: unknown) => void)[]
/** Who is waiting for the lock, first first. */
let line: (() => void)[]

function world(overrides: Partial<HubWorld> = {}): HubWorld {
  return {
    socket: (url, protocols, events) => {
      const one: Opened = { url, protocols, events, said: [], open: false, closed: false }
      sockets.push(one)
      return {
        get open() {
          return one.open && !one.closed
        },
        send: (text) => one.said.push(text),
        close: () => {
          one.closed = true
        },
      }
    },
    device: () => Promise.resolve('device-0001'),
    name: () => Promise.resolve('Laptop'),
    channel: () => null,
    elect: (lead) => {
      lead()
    },
    every: (_ms, tick) => {
      ticks.push(tick)
      return () => {
        ticks = ticks.filter((one) => one !== tick)
      }
    },
    ...overrides,
  }
}

/** Opens the last socket asked for and lets `hello` go. */
async function open(): Promise<Opened> {
  await vi.advanceTimersByTimeAsync(0)
  const socket = sockets.at(-1)
  if (!socket) throw new Error('no socket was opened')
  socket.open = true
  socket.events.opened()
  await vi.advanceTimersByTimeAsync(0)
  return socket
}

beforeEach(() => {
  vi.useFakeTimers()
  sockets = []
  ticks = []
  bus = []
  line = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a device’s hub socket', () => {
  test('opens with the session and the device, and says hello with what the device is', async () => {
    const hub = new Hub(world())
    hub.introduce(() => Promise.resolve({ pub: 'cHVibGlj' }))
    hub.follow('token-1')
    const socket = await open()

    expect(socket.url).toMatch(/^wss?:\/\/.+\/v2\/hub$/)
    expect(socket.protocols).toEqual(['nib.token.token-1', 'nib.device.device-0001'])
    expect(JSON.parse(socket.said[0] ?? '')).toMatchObject({
      t: 'hello',
      device: 'device-0001',
      name: 'Laptop',
      app: 'under test',
      pub: 'cHVibGlj',
    })
    expect(hub.state).toBe('open')
    expect(hub.device).toBe('device-0001')
  })

  test('beats while it is open, on a clock of its own', async () => {
    const hub = new Hub(world())
    hub.follow('token-1')
    const socket = await open()

    for (const tick of ticks) tick()
    expect(socket.said.at(-1)).toBe('beat')
    expect(ticks).toHaveLength(1)
    // What the interval is, beside it: three may be missed before the hub gives up.
    expect(BEAT_EVERY * 3).toBeLessThanOrEqual(30_000)
  })

  test('hands each frame to whoever listens for its kind, and to nobody else', async () => {
    const hub = new Hub(world())
    const pokes: unknown[] = []
    const frees: unknown[] = []
    hub.on('poke', (frame) => pokes.push(frame))
    hub.on('free', (frame) => frees.push(frame))
    hub.follow('token-1')
    const socket = await open()

    socket.events.heard(JSON.stringify({ t: 'poke', space: 's1', seq: 4 }))
    socket.events.heard('ok')
    socket.events.heard('{"t":"poke"}')

    expect(pokes).toEqual([{ t: 'poke', space: 's1', seq: 4 }])
    expect(frees).toEqual([])
  })

  test('sends only while open, and says so', async () => {
    const hub = new Hub(world())
    expect(hub.send({ t: 'active' })).toBe(false)

    hub.follow('token-1')
    const socket = await open()
    expect(hub.send({ t: 'idle' })).toBe(true)
    expect(socket.said.at(-1)).toBe('{"t":"idle"}')
  })

  test('comes back after a drop, and tells whoever holds something to say it again', async () => {
    const hub = new Hub(world())
    const again = vi.fn()
    hub.opened(again)
    hub.follow('token-1')
    const first = await open()
    expect(again).toHaveBeenCalledTimes(1)

    first.events.closed(1006)
    expect(hub.state).toBe('off')
    await vi.advanceTimersByTimeAsync(30_000)
    await open()

    expect(sockets).toHaveLength(2)
    expect(again).toHaveBeenCalledTimes(2)
  })

  test('does not come back after the account ended the session', async () => {
    const hub = new Hub(world())
    hub.follow('token-1')
    const socket = await open()

    socket.events.closed(1008)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sockets).toHaveLength(1)

    // A new session is what brings it back.
    hub.follow('token-2')
    await open()
    expect(sockets).toHaveLength(2)
  })

  test('goes with the session', async () => {
    const hub = new Hub(world())
    hub.follow('token-1')
    const socket = await open()

    hub.follow(null)
    expect(socket.closed).toBe(true)
    expect(hub.state).toBe('off')
    expect(ticks).toHaveLength(0)
  })
})

describe('two windows', () => {
  /** A channel every window shares, and a lock only the first of them gets. */
  function windowed(): HubWorld {
    return world({
      channel: (heard) => {
        bus.push(heard)
        return {
          post: (message) => {
            for (const one of bus) if (one !== heard) one(structuredClone(message))
          },
        }
      },
      elect: (lead) => {
        line.push(lead)
        if (line.length === 1) lead()
      },
    })
  }

  test('keep one socket, and the second speaks and hears through the first', async () => {
    const first = new Hub(windowed())
    const second = new Hub(windowed())
    const frees: unknown[] = []
    second.on('free', (frame) => frees.push(frame))

    first.follow('token-1')
    second.follow('token-1')
    const socket = await open()

    expect(sockets).toHaveLength(1)
    expect(second.state).toBe('open')

    expect(second.send({ t: 'acquire', key: 'k'.repeat(16), take: false })).toBe(true)
    expect(socket.said.at(-1)).toBe(
      JSON.stringify({ t: 'acquire', key: 'k'.repeat(16), take: false }),
    )

    socket.events.heard(JSON.stringify({ t: 'free', key: 'k'.repeat(16) }))
    expect(frees).toEqual([{ t: 'free', key: 'k'.repeat(16) }])
  })

  test('the second opens its own the moment the first goes', async () => {
    const first = new Hub(windowed())
    const second = new Hub(windowed())
    first.follow('token-1')
    second.follow('token-1')
    await open()

    // The first window closed: the lock is the next one's.
    line[1]?.()
    await open()
    expect(sockets).toHaveLength(2)
    expect(second.state).toBe('open')
  })
})
