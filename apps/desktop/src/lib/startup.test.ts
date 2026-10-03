import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The order the app comes up in, as a queue. What is in the queue is covered by
 *  the stores that wait in it, and the launch as a whole by startup-order.test.ts;
 *  this is the mechanism: nothing moves before the first paint, the turns come in
 *  the stated order, and a turn that has passed is not a wait.
 *
 *  The frame and the idle callback are stood in for, because node has neither and
 *  because a test about ordering should be able to say when each of them happened. */

/** Every frame and idle callback that has run, in order, as a tally a test can
 *  read: `frame` twice per `painted`, `idle` once per stage. */
const ticks: string[] = []

vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
  setTimeout(() => {
    ticks.push('frame')
    run()
  }, 0)
  return 0
})

vi.stubGlobal('requestIdleCallback', (run: () => void) => {
  setTimeout(() => {
    ticks.push('idle')
    run()
  }, 0)
  return 0
})

const { startup } = await import('./startup.svelte')

/** Waits out the queue: a frame, then a turn per stage, each a macrotask apart. */
async function settle() {
  for (let round = 0; round < 12; round++) await new Promise((done) => setTimeout(done, 0))
}

beforeEach(() => {
  startup.reset()
  ticks.length = 0
})

describe('before the first paint', () => {
  test('nothing has had its turn', () => {
    expect(startup.reached('index')).toBe(false)
    expect(startup.reached('rooms')).toBe(false)
  })

  test('a stage asking for its turn waits', async () => {
    let taken = false
    void startup.turn('index').then(() => (taken = true))

    await settle()

    // Nothing said the screen was up, so nothing was let through - and no frame
    // and no idle callback were asked for either.
    expect(taken).toBe(false)
    expect(ticks).toEqual([])
  })
})

describe('once what is on screen is painted', () => {
  test('the frame comes before any turn does', async () => {
    const order: string[] = []
    void startup.turn('index').then(() => order.push('index'))

    await startup.shown()
    order.push('shown')
    await settle()

    expect(order).toEqual(['shown', 'index'])
    // Two frames for one paint: the first callback runs before the pixels, the
    // second after them.
    expect(ticks.slice(0, 2)).toEqual(['frame', 'frame'])
  })

  test('the turns come in the order the app says they do', async () => {
    const order: string[] = []
    for (const stage of ['right', 'left', 'doors', 'rooms', 'icons', 'search', 'index'] as const) {
      void startup.turn(stage).then(() => order.push(stage))
    }

    await startup.shown()
    await settle()

    // Asked for backwards, answered forwards: the order is the queue's, not the
    // asking's.
    expect(order).toEqual(['index', 'search', 'icons', 'rooms', 'doors', 'left', 'right'])
  })

  test('each turn waits for an idle callback of its own', async () => {
    await startup.shown()
    await settle()

    expect(ticks).toEqual(['frame', 'frame', ...Array<string>(7).fill('idle')])
  })

  test('a stage nobody waits for does not hold up the ones after it', async () => {
    let rooms = false
    void startup.turn('rooms').then(() => (rooms = true))

    await startup.shown()
    await settle()

    expect(rooms).toBe(true)
  })

  test('says which turns have come', async () => {
    await startup.shown()
    await settle()

    expect(startup.reached('index')).toBe(true)
    expect(startup.reached('rooms')).toBe(true)
  })
})

describe('long after the launch', () => {
  test('a turn that has passed waits for the next frame and no longer', async () => {
    await startup.shown()
    await settle()
    ticks.length = 0

    let taken = false
    await startup.turn('icons').then(() => (taken = true))

    // The frame, and no idle callback: there is no queue left to be behind, but
    // there is still whatever is on screen to be after - a second space opening is
    // a listing that goes up before its own scan starts.
    expect(taken).toBe(true)
    expect(ticks).toEqual(['frame', 'frame'])
  })

  test('a second paint does not run the queue again', async () => {
    await startup.shown()
    await settle()

    const after = ticks.length
    await startup.shown()
    await settle()

    // The frames it asked for, and not one more idle callback: seven turns, once.
    expect(ticks.filter((one) => one === 'idle')).toHaveLength(7)
    expect(ticks.length).toBe(after + 2)
  })
})
