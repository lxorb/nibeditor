import { outFrame, text } from '@nib/online/wire'
import { describe, expect, test } from 'vitest'
import { type Heard, Link, type LinkWorld } from './link'

/** A world with sockets nobody opens until told, and a clock that runs when asked. */
function fakeWorld(token: string | null = 'tok') {
  const sockets: {
    url: string
    protocols: string[]
    sent: (string | Uint8Array)[]
    open: boolean
    closed: boolean
    events: { opened(): void; heard(data: string | ArrayBuffer): void; closed(code: number): void }
  }[] = []
  const timers: { ms: number; run: () => void; cancelled: boolean; ran: boolean }[] = []

  const world: LinkWorld = {
    base: 'https://nib.test',
    token: () => token,
    device: () => Promise.resolve('dev1'),
    socket: (url, protocols, events) => {
      const one = {
        url,
        protocols,
        sent: [] as (string | Uint8Array)[],
        open: false,
        closed: false,
        events,
      }
      sockets.push(one)
      return {
        get open() {
          return one.open
        },
        send: (data) => void one.sent.push(data),
        close: () => {
          one.closed = true
          one.open = false
        },
      }
    },
    after: (ms, run) => {
      const timer = {
        ms,
        run: () => {
          timer.ran = true
          run()
        },
        cancelled: false,
        ran: false,
      }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
  }

  return { world, sockets, timers }
}

const settle = () => new Promise((done) => setTimeout(done, 0))

/** The timers still to run: a reconnect's wait, or the next beat. */
function waiting(found: ReturnType<typeof fakeWorld>) {
  return found.timers.filter((one) => !one.cancelled && !one.ran)
}

function opened(found: ReturnType<typeof fakeWorld>, at = -1) {
  const socket = found.sockets.at(at)
  if (!socket) throw new Error('no socket')
  socket.open = true
  socket.events.opened()
  return socket
}

function bytes(data: string): ArrayBuffer {
  const frame = outFrame(0, new TextEncoder().encode(data))
  return new Uint8Array(frame).buffer
}

function at(seq: number, data: string): ArrayBuffer {
  const frame = outFrame(seq, new TextEncoder().encode(data))
  return new Uint8Array(frame).buffer
}

describe('the socket to an online session', () => {
  test('opens at the term, with the token and the device, and says hello at its size', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    const link = new Link('t1', found.world, (one) => heard.push(one), 100, 30)
    link.open()
    await settle()

    const socket = opened(found)
    expect(socket.url).toBe('wss://nib.test/v2/online/t1/socket')
    expect(socket.protocols).toEqual(['nib.token.tok', 'nib.device.dev1'])
    expect(socket.sent).toEqual([text({ t: 'hello', cols: 100, rows: 30 })])
    expect(heard).toEqual([{ t: 'open' }])
  })

  test('opens nothing signed out', async () => {
    const found = fakeWorld(null)
    new Link('t1', found.world, () => undefined, 80, 24).open()
    await settle()
    expect(found.sockets).toEqual([])
  })

  test('draws output once, and comes back after a drop asking only for what it missed', async () => {
    const found = fakeWorld()
    const drawn: string[] = []
    const heard: Heard[] = []
    const link = new Link(
      't1',
      found.world,
      (one) => {
        heard.push(one)
        if (one.t === 'out') drawn.push(new TextDecoder().decode(one.data))
      },
      80,
      24,
    )
    link.open()
    await settle()
    const first = opened(found)
    first.events.heard(bytes('hello '))
    first.events.heard(at(6, 'world'))

    first.events.closed(1006)
    expect(heard.at(-1)).toEqual({ t: 'dropped' })
    expect(waiting(found)).toHaveLength(1)
    waiting(found)[0]?.run()
    await settle()

    const second = opened(found)
    expect(second.sent).toEqual([text({ t: 'hello', cols: 80, rows: 24, since: 11 })])
    // Sent again from before what was drawn: only the new part is drawn.
    second.events.heard(at(6, 'world!'))
    expect(drawn).toEqual(['hello ', 'world', '!'])
  })

  test('a screen starts the count again at its own offset', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    const link = new Link('t1', found.world, (one) => heard.push(one), 80, 24)
    link.open()
    await settle()
    const socket = opened(found)
    socket.events.heard(text({ t: 'screen', seq: 500, cols: 80, rows: 24, data: 'x' }))
    socket.events.heard(at(400, 'old'))
    socket.events.heard(at(500, 'new'))

    expect(heard.filter((one) => one.t === 'out')).toHaveLength(1)
    socket.events.closed(1006)
    waiting(found)[0]?.run()
    await settle()
    expect(opened(found).sent[0]).toBe(text({ t: 'hello', cols: 80, rows: 24, since: 503 }))
  })

  test('waits for the reader after a refusal that asking again would get again', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)
    socket.events.heard(text({ t: 'refused', error: 'list' }))
    socket.events.closed(1008)
    expect(waiting(found)).toHaveLength(0)

    link.open()
    await settle()
    expect(found.sockets).toHaveLength(2)
  })

  /** 2026-10-07: a tab whose session was gone - its machine replaced - retried silently
   *  forever, since the door's 404 reached the page as a drop. The door says it now. */
  test('stops for good once its session is gone, and never says it dropped', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    const link = new Link('t1', found.world, (what) => heard.push(what), 80, 24)
    link.open()
    await settle()
    const socket = opened(found)
    socket.events.heard(text({ t: 'refused', error: 'gone' }))
    socket.events.closed(4404)
    await settle()

    expect(waiting(found)).toHaveLength(0)
    expect(found.sockets).toHaveLength(1)
    expect(heard.map((one) => one.t)).toEqual(['open', 'refused'])
    expect(link.live).toBe(false)
  })

  test('types, sizes, and nothing once closed', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    expect(link.say({ t: 'in', data: 'ls\r' })).toBe(true)
    link.resize(80, 24)
    link.resize(120, 40)
    expect(socket.sent.slice(1)).toEqual([
      text({ t: 'in', data: 'ls\r' }),
      text({ t: 'size', cols: 120, rows: 40 }),
    ])

    link.close()
    expect(socket.closed).toBe(true)
    expect(link.say({ t: 'in', data: 'x' })).toBe(false)
    socket.events.closed(1000)
    expect(waiting(found)).toHaveLength(0)
  })

  test('beats while it is open, and a socket that hears nothing for three beats is made again', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    const link = new Link('t1', found.world, (one) => heard.push(one), 80, 24)
    link.open()
    await settle()
    const first = opened(found)

    // Answered: it goes on beating.
    for (let beat = 0; beat < 5; beat++) {
      waiting(found)[0]?.run()
      first.events.heard('ok')
    }
    expect(first.sent.filter((one) => one === 'beat')).toHaveLength(5)
    expect(first.closed).toBe(false)

    // Nothing comes back: the third silent beat drops it and a new one is made.
    for (let beat = 0; beat < 3; beat++) waiting(found)[0]?.run()
    expect(first.closed).toBe(true)
    expect(heard.at(-1)).toEqual({ t: 'dropped' })
    waiting(found)[0]?.run()
    await settle()
    expect(found.sockets).toHaveLength(2)
    expect(link.live).toBe(false)
  })
})
