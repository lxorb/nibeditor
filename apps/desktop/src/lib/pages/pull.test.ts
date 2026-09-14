import { describe, expect, test } from 'vitest'
import {
  armed,
  began,
  dragged,
  FALL,
  fallen,
  LEAST_REACH,
  lifted,
  MOST_REACH,
  noPull,
  reachFor,
  riseOf,
  risen,
  SETTLE,
  startedNearEnd,
  wheeled,
} from './pull'

/** Pulling a new page into being past the end of a page note.
 *
 *  The gesture has to feel like reaching for something, has to be the same
 *  gesture with a thumb and with a wheel, and above all must never make a page
 *  somebody did not ask for: the two guards - where the scroll began, and one page
 *  per scroll - are what the last half of this file is about. */

describe('how far the pull has to come', () => {
  test('is a third of the page on screen', () => {
    expect(reachFor(360)).toBe(120)
    expect(reachFor(450)).toBe(150)
  })

  test('with a floor, so a page seen from far away is not a flick', () => {
    expect(reachFor(60)).toBe(LEAST_REACH)
    expect(reachFor(0)).toBe(LEAST_REACH)
  })

  /** A page zoomed in is taller than the window, and a third of it is a
   *  threshold nobody can reach: the gesture would simply not work. */
  test('and a ceiling, so it is always reachable', () => {
    expect(reachFor(1600)).toBe(MOST_REACH)
    expect(reachFor(99999)).toBe(MOST_REACH)
  })
})

describe('how far the silhouette rises', () => {
  test('nothing at all for a pull of nothing, or upwards', () => {
    expect(risen(0, 120)).toBe(0)
    expect(risen(-40, 120)).toBe(0)
  })

  test('the reader’s own pixels to begin with', () => {
    // Within a couple of per cent of one for one over the first few pixels,
    // which is what makes the silhouette feel attached to the hand.
    expect(risen(4, 120)).toBeGreaterThan(3.8)
    expect(risen(4, 120)).toBeLessThanOrEqual(4)
  })

  test('and less and less the further it goes', () => {
    const steps = [40, 80, 120, 160, 200, 240].map((raw) => risen(raw, 120))
    const gains = steps.slice(1).map((one, at) => one - (steps[at] ?? 0))

    for (const [at, gain] of gains.entries()) {
      if (at === 0) continue
      expect(gain).toBeLessThan(gains[at - 1] ?? 0)
    }
  })

  test('never past three times the threshold, however hard it is pulled', () => {
    expect(risen(100_000, 120)).toBeLessThanOrEqual(360)
    expect(risen(100_000, 120)).toBeGreaterThan(355)
  })

  /** The number the report quotes: the threshold sits at half again the distance
   *  the hand has moved, so a pull of 240 has risen 160. */
  test('reaches the threshold at half again the hand’s travel', () => {
    expect(risen(240, 160)).toBeCloseTo(160, 6)
    expect(armed(risen(240, 160), 160)).toBe(true)
    expect(armed(risen(239, 160), 160)).toBe(false)
  })

  test('and follows the hand exactly for a reader who asked for no movement', () => {
    expect(risen(40, 120, true)).toBe(40)
    expect(risen(200, 120, true)).toBe(200)
    // The cap is still a cap: nothing travels forever.
    expect(risen(10_000, 120, true)).toBe(360)
  })
})

describe('a wheel that has stopped', () => {
  test('keeps the whole pull for the instant it stopped', () => {
    expect(fallen(200, 0)).toBe(200)
  })

  test('lets it go, fast then slow', () => {
    const early = 200 - fallen(200, FALL * 0.25)
    const late = fallen(200, FALL * 0.75) - fallen(200, FALL)

    expect(early).toBeGreaterThan(late)
  })

  test('and is back to nothing by the end of the fall', () => {
    expect(fallen(200, FALL)).toBe(0)
    expect(fallen(200, FALL * 2)).toBe(0)
  })

  test('at once for a reader who asked for no movement', () => {
    expect(fallen(200, 1, true)).toBe(0)
  })
})

describe('where a scroll has to start', () => {
  const last = { y: 2326, height: 1123 }

  test('the lower half of the last page, which is where somebody at the end is', () => {
    expect(startedNearEnd(2326 + 600, last)).toBe(true)
    expect(startedNearEnd(2326 + 1123, last)).toBe(true)
    expect(startedNearEnd(9999, last)).toBe(true)
  })

  /** The rule that stops a fling: a hard flick from the top of a sixty page note
   *  passes the end of the column with hundreds of pixels of wheel left over. */
  test('and never its upper half, so a fling from the top cannot reach it', () => {
    expect(startedNearEnd(2326 + 561, last)).toBe(false)
    expect(startedNearEnd(0, last)).toBe(false)
  })

  test('nor a note with no pages at all', () => {
    expect(startedNearEnd(9999, null)).toBe(false)
  })
})

describe('a finger', () => {
  const reach = 120

  test('does nothing where the gesture did not begin near the end', () => {
    const pull = began(noPull(), false, 1000)
    const { pull: after, makes } = dragged(pull, { raw: 400, reach, now: 1010 })

    expect(makes).toBe(false)
    expect(riseOf(after, reach, 1010)).toBe(0)
  })

  test('carries the silhouette up while it is down', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: after } = dragged(pull, { raw: 90, reach, now: 1010 })

    expect(riseOf(after, reach, 1010)).toBeGreaterThan(60)
    // Held where it is, however long the finger stays: only a wheel falls back.
    expect(riseOf(after, reach, 1010 + FALL * 4)).toBe(riseOf(after, reach, 1010))
  })

  test('gives the pull back when it is dragged up again', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: out } = dragged(pull, { raw: 300, reach, now: 1010 })
    const { pull: back } = dragged(out, { raw: 20, reach, now: 1020 })

    expect(riseOf(back, reach, 1020)).toBeLessThan(riseOf(out, reach, 1010))
  })

  test('makes a page when it lifts past the threshold', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: out } = dragged(pull, { raw: 400, reach, now: 1010 })
    expect(armed(riseOf(out, reach, 1010), reach)).toBe(true)

    const { pull: after, makes } = lifted(out, { reach, now: 1020 })
    expect(makes).toBe(true)
    expect(riseOf(after, reach, 1020)).toBe(0)
  })

  test('and springs back when it lifts short of it', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: out } = dragged(pull, { raw: 100, reach, now: 1010 })

    const { pull: after, makes } = lifted(out, { reach, now: 1020 })
    expect(makes).toBe(false)
    expect(riseOf(after, reach, 1020)).toBeGreaterThan(0)
    expect(riseOf(after, reach, 1020 + FALL)).toBe(0)
  })

  test('makes nothing at all when nothing was being pulled', () => {
    expect(lifted(noPull(), { reach, now: 1000 }).makes).toBe(false)
  })

  /** No rubber to spring and nothing to wait for: the page is made the moment the
   *  threshold is crossed. */
  test('makes the page at the threshold for a reader who asked for no movement', () => {
    const pull = began(noPull(), true, 1000)
    const short = dragged(pull, { raw: reach - 1, reach, now: 1010, still: true })
    expect(short.makes).toBe(false)

    const far = dragged(short.pull, { raw: reach, reach, now: 1020, still: true })
    expect(far.makes).toBe(true)
  })
})

describe('a wheel', () => {
  const reach = 120

  test('adds its notches up until they cross the threshold', () => {
    let pull = began(noPull(), true, 1000)
    const made: boolean[] = []

    for (let step = 0; step < 4; step++) {
      const answer = wheeled(pull, { delta: 100, reach, now: 1000 + step * 40 })
      pull = answer.pull
      made.push(answer.makes)
    }

    // 100, 200, 300 rise to 80, 109 and 120: the third notch is the page.
    expect(made).toEqual([false, false, true, false])
  })

  test('and makes exactly one page out of one long scroll', () => {
    let pull = began(noPull(), true, 1000)
    let pages = 0

    // A trackpad flick: forty events over a third of a second.
    for (let step = 0; step < 40; step++) {
      const answer = wheeled(pull, { delta: 60, reach, now: 1000 + step * 8 })
      pull = answer.pull
      if (answer.makes) pages++
    }

    expect(pages).toBe(1)
  })

  test('and another page once the quiet is over and the gesture begins again', () => {
    let pull = began(noPull(), true, 1000)
    let pages = 0

    for (let step = 0; step < 4; step++) {
      const answer = wheeled(pull, { delta: 200, reach, now: 1000 + step * 30 })
      pull = answer.pull
      if (answer.makes) pages++
    }
    expect(pages).toBe(1)

    // The reader stops, and starts again.
    pull = began(pull, true, 1000 + SETTLE + 100)
    const again = wheeled(pull, { delta: 300, reach, now: 1000 + SETTLE + 110 })
    expect(again.makes).toBe(true)
  })

  test('does nothing where the scroll did not begin near the end', () => {
    let pull = began(noPull(), false, 1000)
    for (let step = 0; step < 20; step++) {
      const answer = wheeled(pull, { delta: 300, reach, now: 1000 + step * 8 })
      pull = answer.pull
      expect(answer.makes).toBe(false)
    }

    expect(riseOf(pull, reach, 1200)).toBe(0)
  })

  test('lets the pull fall back when the wheel stops short of the threshold', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: after, makes } = wheeled(pull, { delta: 60, reach, now: 1010 })

    expect(makes).toBe(false)
    expect(riseOf(after, reach, 1010)).toBeGreaterThan(0)
    expect(riseOf(after, reach, 1010 + FALL)).toBe(0)
  })

  test('and starts again from nothing after a pause, rather than from where it was', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: first } = wheeled(pull, { delta: 100, reach, now: 1000 })
    const { pull: second, makes } = wheeled(first, { delta: 100, reach, now: 1000 + FALL + 10 })

    expect(makes).toBe(false)
    expect(riseOf(second, reach, 1000 + FALL + 10)).toBeCloseTo(risen(100, reach), 6)
  })

  test('ignores a wheel going the other way', () => {
    const pull = began(noPull(), true, 1000)
    const { pull: after, makes } = wheeled(pull, { delta: -300, reach, now: 1010 })

    expect(makes).toBe(false)
    expect(after.raw).toBe(0)
  })
})
