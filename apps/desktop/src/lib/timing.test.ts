import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { afterQuiet, onceAFrame, waited } from './timing'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('a wait', () => {
  test('settles after the time asked for and not before', async () => {
    let landed = false
    const waiting = waited(50).then(() => (landed = true))

    await vi.advanceTimersByTimeAsync(49)
    expect(landed).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(landed).toBe(true)
  })

  test('with no time asked for is a turn of the loop', async () => {
    let landed = false
    const waiting = waited().then(() => (landed = true))

    expect(landed).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    await waiting
    expect(landed).toBe(true)
  })
})

describe('a call that waits for quiet', () => {
  test('happens once after the last of a burst', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100)

    soon()
    vi.advanceTimersByTime(60)
    soon()
    vi.advanceTimersByTime(60)
    expect(ran).toBe(0)

    vi.advanceTimersByTime(40)
    expect(ran).toBe(1)
  })

  test('happens again for the next burst', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100)

    soon()
    vi.advanceTimersByTime(100)
    soon()
    vi.advanceTimersByTime(100)

    expect(ran).toBe(2)
  })

  test('drops a waiting one when it is cancelled', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100)

    soon()
    soon.cancel()
    vi.advanceTimersByTime(1000)

    expect(ran).toBe(0)
  })

  test('runs a waiting one at once when it is flushed', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100)

    soon()
    soon.flush()
    expect(ran).toBe(1)

    // And the timer it was waiting on does not fire a second time.
    vi.advanceTimersByTime(1000)
    expect(ran).toBe(1)
  })

  test('flushing with nothing waiting does nothing', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100)

    soon.flush()
    soon()
    vi.advanceTimersByTime(100)
    soon.flush()

    expect(ran).toBe(1)
  })

  test('reads a delay that is worked out at each call', () => {
    let ran = 0
    let wait = 100
    const soon = afterQuiet(
      () => ran++,
      () => wait,
    )

    soon()
    vi.advanceTimersByTime(100)
    expect(ran).toBe(1)

    wait = 0
    soon()
    vi.advanceTimersByTime(0)
    expect(ran).toBe(2)
  })

  /** A burst that never stops still runs: a note typed into without a pause for a
   *  minute is written every couple of seconds all the same. */
  test('runs no later than its ceiling after the first call, however the calls go on', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100, 250)

    for (let at = 0; at < 4; at++) {
      soon()
      vi.advanceTimersByTime(60)
    }
    expect(ran).toBe(0)

    soon()
    vi.advanceTimersByTime(10)
    expect(ran).toBe(1)
  })

  test('and counts the ceiling afresh for the next burst', () => {
    let ran = 0
    const soon = afterQuiet(() => ran++, 100, 250)

    soon()
    vi.advanceTimersByTime(100)
    expect(ran).toBe(1)

    soon()
    vi.advanceTimersByTime(90)
    soon()
    vi.advanceTimersByTime(90)
    expect(ran).toBe(1)

    vi.advanceTimersByTime(10)
    expect(ran).toBe(2)
  })
})

describe('a call that happens once a frame', () => {
  /** The frames a browser would hand out, handed out on demand instead. */
  function frames() {
    let next = 1
    const waiting = new Map<number, () => void>()

    vi.stubGlobal('requestAnimationFrame', (run: () => void) => {
      const id = next++
      waiting.set(id, run)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => waiting.delete(id))

    return {
      /** How many frames were asked for and not yet drawn or dropped. */
      get asked() {
        return waiting.size
      },
      draw() {
        const held = [...waiting.values()]
        waiting.clear()
        for (const run of held) run()
      },
    }
  }

  test('runs once however many times it was asked for before the frame', () => {
    const screen = frames()
    let ran = 0
    const soon = onceAFrame(() => ran++)

    soon()
    soon()
    soon()
    expect(screen.asked).toBe(1)
    expect(ran).toBe(0)

    screen.draw()
    expect(ran).toBe(1)
  })

  test('asks for another frame once the last one has been drawn', () => {
    const screen = frames()
    let ran = 0
    const soon = onceAFrame(() => ran++)

    soon()
    screen.draw()
    soon()
    screen.draw()

    expect(ran).toBe(2)
  })

  test('drops the frame it was waiting on when it is cancelled', () => {
    const screen = frames()
    let ran = 0
    const soon = onceAFrame(() => ran++)

    soon()
    soon.cancel()
    expect(screen.asked).toBe(0)

    screen.draw()
    expect(ran).toBe(0)
  })

  test('is a turn of the loop where there are no frames', () => {
    let ran = 0
    const soon = onceAFrame(() => ran++)

    soon()
    soon()
    expect(ran).toBe(0)

    vi.advanceTimersByTime(0)
    expect(ran).toBe(1)
  })
})
