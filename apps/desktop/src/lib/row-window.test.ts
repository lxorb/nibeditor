import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import {
  autoScrollBy,
  heightOf,
  indexAt,
  listHeight,
  offsetOf,
  type Rows,
  windowFor,
} from './row-window'

/** A desktop row, and a panel twenty of them tall. Counted rather than timed: what
 *  a window is right or wrong about is how many rows exist and which, and both are
 *  numbers a test can state. */
const HEIGHT = 28
const ROOM = 20 * HEIGHT

const rows = (over: Partial<Rows> = {}): Rows => ({
  count: 3000,
  height: HEIGHT,
  top: 0,
  room: ROOM,
  overscan: 0,
  ...over,
})

/** How many rows a window puts in the page: the slice, less the part of a sliding
 *  band that is flat, plus the rows it is holding on to outside it. */
const mounted = (over: Partial<Rows> = {}): number => {
  const view = windowFor(rows(over))
  const flat = view.skip === null ? 0 : view.skip.to - view.skip.from + 1

  return view.last - view.first + 1 - flat + view.pinned.length
}

describe('the window over a long list', () => {
  test('mounts the rows in view and no others', () => {
    expect(mounted()).toBe(20)
    expect(windowFor(rows())).toMatchObject({ first: 0, last: 19 })
  })

  /** The whole point: three thousand notes, twenty rows and a few either side.
   *  At the top of the list there is nothing above to keep, so it is twenty-three. */
  test('so a space of three thousand notes is twenty-six buttons', () => {
    expect(mounted({ overscan: 3, top: 40 * HEIGHT })).toBe(26)
    expect(mounted({ overscan: 3 })).toBe(23)
  })

  test('and the height the rest of them would have taken stands above and below', () => {
    const view = windowFor(rows({ top: 10 * HEIGHT }))

    expect(view.above).toBe(10 * HEIGHT)
    expect(view.above + (view.last - view.first + 1) * HEIGHT + view.below).toBe(3000 * HEIGHT)
  })

  test('moves with the scroll, a row at a time', () => {
    expect(windowFor(rows({ top: 10 * HEIGHT }))).toMatchObject({ first: 10, last: 29 })
    expect(windowFor(rows({ top: 10 * HEIGHT + 1 }))).toMatchObject({ first: 10, last: 30 })
  })

  /** A scroll that lands exactly on a row's top edge shows twenty rows, not
   *  twenty-one: the row after the last is not in view by a pixel. */
  test('and takes no row it does not need', () => {
    expect(mounted({ top: 5 * HEIGHT })).toBe(20)
  })

  test('keeps a few rows beyond either edge, so a wheel click lands on rows', () => {
    expect(windowFor(rows({ top: 40 * HEIGHT, overscan: 6 }))).toMatchObject({
      first: 34,
      last: 65,
    })
  })

  test('and asks for none that are not there, at either end', () => {
    expect(windowFor(rows({ top: 0, overscan: 6 }))).toMatchObject({ first: 0, last: 25 })
    expect(windowFor(rows({ top: 2980 * HEIGHT, overscan: 6 }))).toMatchObject({
      first: 2974,
      last: 2999,
    })
  })

  test('and holds nothing at all for a space with nothing in it', () => {
    expect(windowFor(rows({ count: 0 }))).toEqual({
      first: 0,
      last: -1,
      skip: null,
      above: 0,
      below: 0,
      pinned: [],
    })
  })

  /** The list may sit below the bookmarks, in which case the scroller has not
   *  reached it yet and `top` is negative. */
  test('starts at the first row while there is still something above the list', () => {
    expect(windowFor(rows({ top: -120 }))).toMatchObject({ first: 0, above: 0 })
  })
})

/** Ten rows of ten pixels, three of which a twist is letting out under row 2. The
 *  numbers are small so the arithmetic can be read rather than trusted. */
const folding = (grown: number): Rows => ({
  count: 10,
  height: 10,
  top: 0,
  room: 100,
  overscan: 0,
  fold: { at: 2, rows: 3, grown },
})

describe('a twist sliding what it holds into place', () => {
  test('starts with the band flat and everything under it still up', () => {
    const shut = folding(0)

    expect([0, 1, 2].map((one) => offsetOf(one, shut))).toEqual([0, 10, 20])
    expect([3, 4, 5].map((one) => offsetOf(one, shut))).toEqual([30, 30, 30])
    expect([3, 4, 5].map((one) => heightOf(one, shut))).toEqual([0, 0, 0])
    expect(offsetOf(6, shut)).toBe(30)
    expect(listHeight(shut)).toBe(70)
  })

  test('half way out, one row and a half of the band is showing', () => {
    const half = folding(1.5)

    expect([3, 4, 5].map((one) => heightOf(one, half))).toEqual([10, 5, 0])
    expect([3, 4, 5].map((one) => offsetOf(one, half))).toEqual([30, 40, 45])
    expect(offsetOf(6, half)).toBe(45)
    expect(listHeight(half)).toBe(85)
  })

  test('and once it is out the list is the list again', () => {
    const out = folding(3)

    expect([3, 4, 5, 6].map((one) => offsetOf(one, out))).toEqual([30, 40, 50, 60])
    expect([3, 4, 5].map((one) => heightOf(one, out))).toEqual([10, 10, 10])
    expect(listHeight(out)).toBe(100)
  })

  /** The rows of the band that are still flat are not in the page: they are noughts
   *  high, stacked at the bottom of the band, and nobody can see them. */
  test('so a band coming out mounts only the part of it that is showing', () => {
    const view = windowFor({ ...folding(1.5), room: 45 })
    expect(view.last).toBe(4)
  })

  test('and the boxes above and below still add up to the list', () => {
    const half = folding(1.5)
    const view = windowFor({ ...half, room: 30, top: 20 })
    const drawn = [view.first, view.last].map((one) => offsetOf(one, half))

    expect(view.above).toBe(drawn[0])
    expect(view.above + view.below).toBeLessThan(listHeight(half))
  })

  /** A note holding four hundred notes is four hundred rows flat against the band's
   *  edge for the first frame of the slide, and every one of them would otherwise be
   *  mounted for nothing: they are inside the window, because everything under the
   *  band is. A row no pixels high adds no pixels to the flow, so they are left out. */
  test('and never mounts the part of the band that is still flat', () => {
    const shut = { ...folding(0), room: 100 }
    expect(windowFor(shut)).toMatchObject({ first: 0, last: 9, skip: { from: 3, to: 5 } })

    const half = { ...folding(1.5), room: 100 }
    // One row of the band is whole, one is part way out and one is still flat.
    expect(windowFor(half).skip).toEqual({ from: 5, to: 5 })

    expect(windowFor({ ...folding(3), room: 100 }).skip).toBeNull()
  })

  test('and the row a pixel is in is the row the arithmetic says', () => {
    const half = folding(1.5)
    const found = [0, 29, 30, 44, 45, 54, 55].map((one) => indexAt(one, half))

    expect(found).toEqual([0, 2, 3, 4, 6, 6, 7])
  })
})

/** A focus inside a row the window has taken away is a focus on nothing, and the
 *  arrows stop working. So a few rows are held wherever they are. */
describe('the rows the list holds on to', () => {
  test('are held although the scroll has left them far behind', () => {
    expect(windowFor(rows({ pinned: [2500] })).pinned).toEqual([2500])
    expect(mounted({ pinned: [2500] })).toBe(21)
  })

  test('and are not drawn twice when the window has them anyway', () => {
    expect(windowFor(rows({ pinned: [10] })).pinned).toEqual([])
    expect(mounted({ pinned: [10] })).toBe(20)
  })

  /** The keyboard, a name being typed and a row a key has asked for, which are
   *  usually one row named three times. */
  test('are named once each, in order, however often they are named', () => {
    expect(windowFor(rows({ pinned: [2500, 40, 2500] })).pinned).toEqual([40, 2500])
  })

  test('and never a row the list has not got', () => {
    expect(windowFor(rows({ pinned: [-1, 9999] })).pinned).toEqual([])
  })

  test('and nobody at all when nothing has the keyboard', () => {
    expect(windowFor(rows()).pinned).toEqual([])
  })

  /** A row in the flat part of a sliding band is inside the slice and still not
   *  drawn, so a pin there has to be held like any other. */
  test('including one inside the part of a band that is still flat', () => {
    const shut = { ...folding(0), room: 100, pinned: [4] }
    expect(windowFor(shut).pinned).toEqual([4])
  })
})

/** A drop can only land on a row that is there, and a space of three thousand has
 *  one row on screen in a hundred. So holding near an edge brings rows in. */
describe('a drag held near the edge of the list', () => {
  const near = (y: number) => autoScrollBy(y, ROOM, HEIGHT, HEIGHT / 2)

  test('scrolls nothing from the middle', () => {
    expect(near(ROOM / 2)).toBe(0)
  })

  test('scrolls up at the top and down at the bottom', () => {
    expect(near(0)).toBe(-HEIGHT / 2)
    expect(near(ROOM)).toBe(HEIGHT / 2)
  })

  test('faster the closer to the edge it is', () => {
    expect(near(HEIGHT / 2)).toBe(-HEIGHT / 4)
    expect(near(ROOM - HEIGHT / 2)).toBe(HEIGHT / 4)
  })

  test('and nothing at all over a list with no room to scroll', () => {
    expect(autoScrollBy(0, 0, HEIGHT, HEIGHT / 2)).toBe(0)
  })
})

/** The one thing a window has to be right about for the keyboard: the row next to
 *  the one it is on is in the page.
 *
 *  A roving walk moves the focus onto the next row's element, and an element that is
 *  not in the page cannot take a focus. Where a walk reaches a long way past the
 *  window the list puts the row there first - `reach` in Tree.svelte and
 *  HitList.svelte, the `LongList` protocol in roving.ts - but the ordinary step, the
 *  one that happens four hundred times to walk a space, must need none of that. It
 *  does not, as long as the window keeps rows beyond either edge: the overscan is
 *  what makes an arrow at the edge of the view land on a row that already exists.
 *
 *  Counted over every row of a long list rather than argued about: stand on each one
 *  in turn, put the view where a browser would have left it, and ask whether the row
 *  above and the row below are in the page. */
describe('walking a long list a row at a time', () => {
  const OVERSCAN = 6

  /** The window as it is once the row with the keyboard has been scrolled into view,
   *  which is what `scrollIntoView({ block: 'nearest' })` leaves behind: the row at
   *  the top edge of the view, or at the bottom of it. */
  const standing = (index: number, count: number, where: 'top' | 'bottom') => {
    const at = index * HEIGHT
    const top = where === 'top' ? at : Math.max(0, at - ROOM + HEIGHT)

    return rows({ count, top, overscan: OVERSCAN, pinned: [index] })
  }

  test('the row above and the row below are always already in the page', () => {
    const count = 1000
    const missing: string[] = []

    for (let index = 0; index < count; index++) {
      for (const edge of ['top', 'bottom'] as const) {
        const view = windowFor(standing(index, count, edge))
        const held = (one: number) =>
          one < 0 ||
          one >= count ||
          (one >= view.first && one <= view.last) ||
          view.pinned.includes(one)

        if (!held(index - 1)) missing.push(`${index} up at the ${edge}`)
        if (!held(index + 1)) missing.push(`${index} down at the ${edge}`)
      }
    }

    expect(missing).toEqual([])
  })

  test('and the row it is standing on, wherever the scroll has gone', () => {
    // The scroll somewhere else entirely, which is what a wheel does while the
    // keyboard stays where it was: the row is pinned, and is held for it.
    const away = rows({ count: 1000, top: 400 * HEIGHT, overscan: OVERSCAN, pinned: [7] })
    const view = windowFor(away)

    expect(view.first).toBeGreaterThan(7)
    expect(view.pinned).toEqual([7])
  })

  test('for the cost of the rows in view and the overscan, and no more', () => {
    // Which is the whole point of a window: a thousand rows, and the page holds the
    // twenty in view and a few either side. The Links panel drew all thousand.
    const count = 1000
    const drawn = mounted({ count, overscan: OVERSCAN, top: 100 * HEIGHT, pinned: [100] })

    expect(drawn).toBe(ROOM / HEIGHT + 2 * OVERSCAN)
    expect(drawn).toBeLessThan(count / 20)
  })
})

/** And which lists in the app actually go through it.
 *
 *  The arithmetic above has been right since the file list first used it; what was
 *  wrong was that the Links panel did not. A note a thousand others point at was a
 *  thousand buttons and three thousand spans, two hundred and fifteen milliseconds
 *  after a button press, and none of the tests above could tell - they are about the
 *  window, and that panel had no window to be about.
 *
 *  So this is read off the components' own source, the way
 *  packages/editor/test/metrics.test.ts reads modes.ts: a list that can be as long as
 *  its space is has to draw from a window rather than from the whole of what it
 *  holds. It is the shape of the thing rather than the pixels, which is exactly what
 *  is easy to lose again - a list added next year will have the same choice to make. */
describe('the lists that draw through it', () => {
  const source = (name: string) =>
    readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

  /** The two lists in the app whose length is the space's rather than a handful. */
  const LONG = ['Tree.svelte', 'HitList.svelte']

  for (const name of LONG) {
    test(`${name} draws a window rather than every row it holds`, () => {
      const text = source(name)

      expect(text).toContain('windowFor')
      // The two boxes that stand in for the rows that are not there. Without them a
      // window is a list that has lost most of its height.
      expect(text).toContain('view.above')
      expect(text).toContain('view.below')
      // And the protocol that lets the keyboard walk past the window's edge.
      expect(text).toContain('reach')
    })
  }

  test('and the Links panel draws its hit lists through one of them', () => {
    const text = source('Links.svelte')

    // Not an each over everything the index found, which is what it used to be:
    // `{#each rows as reference}` over a thousand backlinks.
    expect(text).toContain('HitList')
    expect(text).not.toMatch(/\{#each\s+rows\s+as/)
  })
})
