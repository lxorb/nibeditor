import { describe, expect, test } from 'vitest'
import {
  clampedStart,
  endOf,
  gathered,
  holds,
  keptWidths,
  moved,
  near,
  nearestSlot,
  partsFor,
  placed,
  reorderSlack,
  separated,
  slotAt,
  WIDTH,
  widthsFor,
  worthKeeping,
} from './layout'

/** A strip written as letters: `a` an inactive tab, `A` the active one, `p` a
 *  pinned tab and `P` the active pinned one. */
function strip(shape: string) {
  return Array.from({ length: shape.length }, (_, at) => shape.charAt(at)).map((letter) => ({
    pinned: letter === 'p' || letter === 'P',
    active: letter === 'A' || letter === 'P',
  }))
}

const total = (widths: readonly number[]) => widths.reduce((all, one) => all + one, 0)

describe('how wide the tabs are', () => {
  test('with room to spare every tab is the standard width', () => {
    expect(widthsFor(strip('aAa'), 2000)).toEqual([238, 238, 238])
  })

  test('before the strip is measured, too', () => {
    expect(widthsFor(strip('aAap'), null)).toEqual([238, 238, 238, WIDTH.pinned])
  })

  test('short of room they share it out evenly and fill it exactly', () => {
    const widths = widthsFor(strip('aAaa'), 601)
    expect(total(widths)).toBe(601)
    // One apart at most: the rounding goes one pixel each to the first tabs.
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1)
    expect(widths[0]).toBeGreaterThanOrEqual(widths[3] ?? 0)
  })

  test('a pinned tab keeps its width whatever the room', () => {
    for (const room of [100, 400, 5000]) {
      expect(widthsFor(strip('pPaA'), room).slice(0, 2)).toEqual([WIDTH.pinned, WIDTH.pinned])
    }
  })

  test('the active tab stops at its least width, and only the others go on shrinking', () => {
    const tabs = strip('aaaaAaaaaa')
    const crossover = 10 * WIDTH.active
    const widths = widthsFor(tabs, crossover - 90)

    expect(widths[4]).toBe(WIDTH.active)
    for (const [at, width] of widths.entries()) {
      if (at !== 4) expect(width).toBeLessThan(WIDTH.active)
    }
    expect(total(widths)).toBe(crossover - 90)
  })

  test('and nothing gets narrower than the least widths, however little room', () => {
    const widths = widthsFor(strip('aAa'), 10)
    expect(widths).toEqual([WIDTH.inactive, WIDTH.active, WIDTH.inactive])
  })

  test('twenty tabs in a narrow window still fit', () => {
    const tabs = strip(`A${'a'.repeat(19)}`)
    const widths = widthsFor(tabs, 700)
    expect(total(widths)).toBe(700)
    expect(widths[0]).toBe(WIDTH.active)
    expect(Math.min(...widths)).toBeGreaterThan(WIDTH.inactive)
  })
})

describe('where the tabs are', () => {
  test('one after the other, and the plus after the last', () => {
    const bounds = placed([100, 50, 30])
    expect(bounds.map((one) => one.x)).toEqual([0, 100, 150])
    expect(endOf(bounds)).toBe(180)
    expect(endOf([])).toBe(0)
  })
})

describe('what fits in a tab', () => {
  const inactive = { pinned: false, active: false }
  const active = { pinned: false, active: true }

  test('a standard tab shows everything', () => {
    expect(partsFor(238, inactive)).toEqual({
      mark: true,
      close: true,
      title: true,
      centred: false,
    })
  })

  test('an inactive tab drops its close button first', () => {
    // 68 of contents is the line: 22 of it is the tab's own padding.
    expect(partsFor(90, inactive).close).toBe(true)
    expect(partsFor(89, inactive).close).toBe(false)
    expect(partsFor(89, inactive).mark).toBe(true)
  })

  test('and a finger needs a wider tab before the cross is safe to show', () => {
    expect(partsFor(110, inactive, true).close).toBe(false)
    expect(partsFor(122, inactive, true).close).toBe(true)
  })

  test('the active tab keeps its close button and drops its mark', () => {
    expect(partsFor(WIDTH.active, active)).toEqual({
      mark: false,
      close: true,
      title: false,
      centred: false,
    })
    expect(partsFor(WIDTH.active + 19, active).mark).toBe(false)
    expect(partsFor(WIDTH.active + 20, active).mark).toBe(true)
  })

  test('a sliver is its mark in the middle', () => {
    expect(partsFor(WIDTH.inactive + 4, inactive)).toEqual({
      mark: true,
      close: false,
      title: false,
      centred: true,
    })
  })

  test('a pinned tab is its mark and never a cross', () => {
    expect(partsFor(WIDTH.pinned, { pinned: true, active: true })).toEqual({
      mark: true,
      close: false,
      title: false,
      centred: true,
    })
  })

  test('a tab on its way in or out shows nothing', () => {
    expect(partsFor(6, active)).toEqual({ mark: false, close: false, title: false, centred: false })
  })
})

describe('where a drop from outside lands', () => {
  const bounds = placed([100, 100, 100])

  test('before the tab whose middle the pointer has not reached', () => {
    expect(slotAt(bounds, 10, 0)).toBe(0)
    expect(slotAt(bounds, 60, 0)).toBe(1)
    expect(slotAt(bounds, 149, 0)).toBe(1)
    expect(slotAt(bounds, 151, 0)).toBe(2)
    expect(slotAt(bounds, 1000, 0)).toBe(3)
  })

  test('after the pinned run, unless it is pinned itself', () => {
    expect(slotAt(bounds, 10, 2)).toBe(2)
    expect(slotAt(bounds, 1000, 2, true)).toBe(2)
  })
})

describe('where a dragged tab belongs', () => {
  const widths = [100, 100, 100, 100]

  test("where it is, until it has passed a neighbour's middle", () => {
    expect(nearestSlot(widths, 0, 0, 0, false)).toBe(0)
    expect(nearestSlot(widths, 0, 49, 0, false)).toBe(0)
    expect(nearestSlot(widths, 0, 51, 0, false)).toBe(1)
    expect(nearestSlot(widths, 0, 290, 0, false)).toBe(3)
  })

  test('and back the same way', () => {
    expect(nearestSlot(widths, 3, 251, 0, false)).toBe(3)
    expect(nearestSlot(widths, 3, 249, 0, false)).toBe(2)
    expect(nearestSlot(widths, 3, -40, 0, false)).toBe(0)
  })

  test('with tabs of different widths it measures the slot, not the tab', () => {
    // The narrow pinned-looking first tab: moving the wide one to the front puts
    // it at 0, and leaving it second puts it at 40.
    expect(nearestSlot([40, 200, 100], 1, 19, 0, false)).toBe(0)
    expect(nearestSlot([40, 200, 100], 1, 21, 0, false)).toBe(1)
  })

  test('a tie keeps the slot it has', () => {
    expect(nearestSlot(widths, 0, 50, 0, false)).toBe(0)
    expect(nearestSlot(widths, 0, 50, 0, false, 1)).toBe(1)
  })

  test('a pinned tab stays among the pinned, and the rest after them', () => {
    expect(nearestSlot([46, 46, 100, 100], 0, 500, 2, true)).toBe(1)
    expect(nearestSlot([46, 46, 100, 100], 3, -100, 2, false)).toBe(2)
  })

  test('a narrower tab needs less movement before the next reorder', () => {
    expect(reorderSlack(WIDTH.standard)).toBe(16)
    expect(reorderSlack(WIDTH.standard / 2)).toBe(8)
  })

  test('it cannot be dragged off either end of the strip', () => {
    expect(clampedStart(-50, 100, 800)).toBe(0)
    expect(clampedStart(900, 100, 800)).toBe(700)
    expect(clampedStart(300, 100, 800)).toBe(300)
    expect(clampedStart(300, 100, 50)).toBe(0)
  })

  test('the order it leaves behind', () => {
    expect(moved(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c'])
    expect(moved(['a', 'b'], 5, 0)).toEqual(['a', 'b'])
  })
})

describe('several tabs carried as one', () => {
  const tabs = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }))
  const widths = [100, 80, 100, 60, 100]

  test('stand as the dragged one, as wide as all of them', () => {
    const block = gathered(tabs, widths, ['b', 'd'], 'd')

    expect(block.order.map((one) => one.id)).toEqual(['a', 'c', 'd', 'e'])
    expect(block.widths).toEqual([100, 100, 140, 100])
    expect(block.from).toBe(2)
  })

  test('held from where the dragged one sits inside the block', () => {
    expect(gathered(tabs, widths, ['b', 'd'], 'd').before).toBe(80)
    expect(gathered(tabs, widths, ['b', 'd'], 'b').before).toBe(0)
  })

  test('and go along the strip by the rules one tab goes by', () => {
    const block = gathered(tabs, widths, ['b', 'd'], 'b')
    // Past the middle of the tab after it: the block is one slot on.
    expect(nearestSlot(block.widths, block.from, 160, 0, false)).toBe(2)
    expect(moved(block.order, block.from, 2).map((one) => one.id)).toEqual(['a', 'c', 'b', 'e'])
  })
})

describe('when a carried tab leaves the strip', () => {
  const rect = { left: 100, top: 0, right: 900, bottom: 38 }

  test('fifteen pixels above or below it, or past either end', () => {
    expect(holds(rect, 500, 38 + 15, 15)).toBe(true)
    expect(holds(rect, 500, 38 + 16, 15)).toBe(false)
    expect(holds(rect, 500, -16, 15)).toBe(false)
    expect(holds(rect, 99, 20, 15)).toBe(false)
    expect(holds(rect, 900, 20, 15)).toBe(false)
  })
})

describe('closing tabs with the pointer', () => {
  const rect = { left: 0, top: 0, right: 800, bottom: 38 }

  test('only holds the widths while the tabs are narrower than they would like', () => {
    expect(worthKeeping(strip('aAa'), 2000)).toBe(false)
    expect(worthKeeping(strip('aAa'), 600)).toBe(true)
    expect(worthKeeping(strip('aAa'), null)).toBe(false)
  })

  test('the tabs that are left keep the widths they had', () => {
    const kept = new Map([
      ['a', 120],
      ['b', 120],
      ['c', 120],
    ])
    const left = [
      { id: 'a', pinned: false, active: false },
      { id: 'c', pinned: false, active: true },
    ]
    expect(keptWidths(left, kept)).toEqual([120, 120])
  })

  test('a narrow tab that becomes active is let out to the active least width', () => {
    const kept = new Map([['a', 20]])
    expect(keptWidths([{ id: 'a', pinned: false, active: true }], kept)).toEqual([WIDTH.active])
  })

  test('and a tab that was not there ends it', () => {
    const kept = new Map([['a', 120]])
    expect(
      keptWidths(
        [
          { id: 'a', pinned: false, active: false },
          { id: 'new', pinned: false, active: true },
        ],
        kept,
      ),
    ).toBeNull()
  })

  test('until the pointer is forty below the strip or sixty past its end', () => {
    expect(near(rect, 400, 38 + 40, 1)).toBe(true)
    expect(near(rect, 400, 38 + 41, 1)).toBe(false)
    expect(near(rect, 860, 20, 1)).toBe(true)
    expect(near(rect, 861, 20, 1)).toBe(false)
    // Above the strip is the edge of the window: leaving that way leaves.
    expect(near(rect, 400, -1, 1)).toBe(false)
  })

  test('where the end is the left, the slop is on the left', () => {
    expect(near(rect, -60, 20, -1)).toBe(true)
    expect(near(rect, 860, 20, -1)).toBe(false)
  })
})

describe('the hairlines between tabs', () => {
  test('between two plain tabs, never beside a filled one or after the last', () => {
    const shown = separated(['a', 'b', 'c', 'd', 'e'], new Set(['c']))
    expect([...shown]).toEqual(['a', 'd'])
  })

  test('every plain pair has one', () => {
    expect([...separated(['a', 'b', 'c'], new Set())]).toEqual(['a', 'b'])
  })
})
