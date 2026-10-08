import { outFrame, text } from '@nib/online/wire'
import { describe, expect, test } from 'vitest'
import { BEAT_EVERY } from '../backoff'
import { type Heard, Link, type LinkWorld, OPEN_WITHIN, PROBE_WITHIN } from './link'

/** A world with sockets nobody opens until told, and a clock that runs when asked: a
 *  timer runs by hand, or with the time it was set for by `pass`. */
function fakeWorld(token: string | null = 'tok') {
  const sockets: {
    url: string
    protocols: string[]
    sent: (string | Uint8Array)[]
    open: boolean
    closed: boolean
    buffered: number
    events: { opened(): void; heard(data: string | ArrayBuffer): void; closed(code: number): void }
  }[] = []
  const timers: { ms: number; at: number; run: () => void; cancelled: boolean; ran: boolean }[] = []
  const clock = { now: 0, hidden: false }
  const backs: (() => void)[] = []

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
        buffered: 0,
        events,
      }
      sockets.push(one)
      return {
        get open() {
          return one.open
        },
        get buffered() {
          return one.buffered
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
        at: clock.now + ms,
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
    now: () => clock.now,
    hidden: () => clock.hidden,
    watch: (back) => {
      backs.push(back)
      return () => backs.splice(backs.indexOf(back), 1)
    },
  }

  /** The network back, or the window looked at again. */
  const back = () => {
    for (const one of [...backs]) one()
  }

  return { world, sockets, timers, clock, back, backs }
}

/** The clock moved on by `ms`, every timer that falls due on the way run at its time. */
function pass(found: ReturnType<typeof fakeWorld>, ms: number) {
  const until = found.clock.now + ms
  for (;;) {
    const next = waiting(found)
      .filter((one) => one.at <= until)
      .sort((a, b) => a.at - b.at)[0]
    if (!next) break
    found.clock.now = Math.max(found.clock.now, next.at)
    next.run()
  }
  found.clock.now = until
}

const beats = (socket: { sent: (string | Uint8Array)[] }) =>
  socket.sent.filter((one) => one === 'beat').length

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
      // The look a key brings, that the socket still answers.
      'beat',
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

  /** Issue 208: a laptop back on the network waited out a backoff of up to twenty
   *  seconds while every website loaded at once. */
  test('tries at once when the network comes back, rather than waiting out its wait', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    // Six failures in a row: the wait is at its longest.
    for (let tried = 0; tried < 6; tried++) {
      found.sockets.at(-1)?.events.closed(1006)
      waiting(found)
        .find((one) => one.ms <= 6_500)
        ?.run()
      await settle()
    }
    found.sockets.at(-1)?.events.closed(1006)
    const before = found.sockets.length
    expect(waiting(found).map((one) => one.ms)).toEqual([expect.any(Number)])

    found.back()
    await settle()
    expect(found.sockets).toHaveLength(before + 1)
    // No wait left over: only the new socket's own limit to open.
    expect(waiting(found).map((one) => one.ms)).toEqual([OPEN_WITHIN])
    opened(found)
    expect(link.live).toBe(true)
  })

  test('waits five seconds at most between tries while on screen', async () => {
    const found = fakeWorld()
    new Link('t1', found.world, () => undefined, 80, 24).open()
    await settle()
    const waits: number[] = []
    for (let tried = 0; tried < 10; tried++) {
      found.sockets.at(-1)?.events.closed(1006)
      const retry = waiting(found).find((one) => one.ms !== OPEN_WITHIN)
      if (!retry) throw new Error('no retry')
      waits.push(retry.ms)
      retry.run()
      await settle()
    }
    expect(waits[0]).toBeLessThan(400)
    expect(Math.max(...waits)).toBeLessThanOrEqual(6_500)
  })

  test('gives up on a socket that never opens and makes another', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    new Link('t1', found.world, (one) => heard.push(one), 80, 24).open()
    await settle()
    const stuck = found.sockets[0]
    pass(found, OPEN_WITHIN - 1)
    expect(stuck?.closed).toBe(false)

    pass(found, 1)
    expect(stuck?.closed).toBe(true)
    expect(heard).toEqual([{ t: 'dropped' }])
    pass(found, 1_000)
    await settle()
    expect(found.sockets).toHaveLength(2)
  })

  test('a socket being made on the network that went is made again when it comes back', async () => {
    const found = fakeWorld()
    new Link('t1', found.world, () => undefined, 80, 24).open()
    await settle()

    // A moment after it was begun, a look at the window leaves it be.
    pass(found, 500)
    found.back()
    expect(found.sockets[0]?.closed).toBe(false)

    pass(found, PROBE_WITHIN)
    found.back()
    await settle()
    expect(found.sockets[0]?.closed).toBe(true)
    expect(found.sockets).toHaveLength(2)
  })

  test('looks at an open socket when the window comes back, and keeps one that answers', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    found.back()
    expect(beats(socket)).toBe(1)
    // One look at a time.
    found.back()
    expect(beats(socket)).toBe(1)
    pass(found, 200)
    socket.events.heard('ok')
    pass(found, PROBE_WITHIN)
    expect(socket.closed).toBe(false)
    expect(link.live).toBe(true)
  })

  test('drops a socket that does not answer a look, and is back at once', async () => {
    const found = fakeWorld()
    const heard: Heard[] = []
    const link = new Link('t1', found.world, (one) => heard.push(one), 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    found.back()
    pass(found, PROBE_WITHIN - 1)
    expect(socket.closed).toBe(false)
    pass(found, 1)
    expect(socket.closed).toBe(true)
    expect(heard.at(-1)).toEqual({ t: 'dropped' })

    // Seconds, not the half a minute three silent beats take.
    pass(found, 400)
    await settle()
    expect(found.sockets).toHaveLength(2)
    expect(link.live).toBe(false)
  })

  test('keys typed into a socket that is gone bring it back within seconds', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    link.say({ t: 'in', data: 'l' })
    link.sayBytes(new Uint8Array([115]))
    expect(beats(socket)).toBe(1)
    // The echo is an answer.
    socket.events.heard(at(0, 'ls'))
    pass(found, PROBE_WITHIN)
    expect(socket.closed).toBe(false)

    // The next keys go nowhere.
    link.say({ t: 'in', data: '\r' })
    pass(found, PROBE_WITHIN)
    expect(socket.closed).toBe(true)
  })

  test('gives a socket still sending a long paste longer to answer', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    socket.buffered = 64 * 1024
    link.say({ t: 'in', data: 'x'.repeat(1000) })
    pass(found, PROBE_WITHIN * 2)
    expect(socket.closed).toBe(false)
    socket.buffered = 0
    pass(found, PROBE_WITHIN)
    expect(socket.closed).toBe(true)
  })

  test('a computer back from sleep looks at its socket at once', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)

    // Asleep for an hour: the beat set before it runs as the computer wakes.
    found.clock.now += 60 * 60_000
    const beat = waiting(found).find((one) => one.ms === BEAT_EVERY)
    beat?.run()
    expect(beats(socket)).toBe(1)
    pass(found, PROBE_WITHIN)
    expect(socket.closed).toBe(true)
    expect(link.live).toBe(false)
  })

  test('stops listening for the network once closed, and a refusal is not undone by it', async () => {
    const found = fakeWorld()
    const link = new Link('t1', found.world, () => undefined, 80, 24)
    link.open()
    await settle()
    const socket = opened(found)
    socket.events.heard(text({ t: 'refused', error: 'list' }))
    socket.events.closed(1008)

    found.back()
    await settle()
    expect(found.sockets).toHaveLength(1)

    link.close()
    expect(found.backs).toHaveLength(0)
  })
})
