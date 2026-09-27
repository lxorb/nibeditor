import { describe, expect, test } from 'vitest'
import { TabDrag, THRESHOLD } from './drag.svelte'

/** Four tabs of a hundred each in a strip with room for eight hundred. */
const frame = { widths: [100, 100, 100, 100], room: 800, pinnedRun: 0 }

/** A press on the tab at `from`, thirty pixels into it, on a strip that starts at
 *  the left of the glass and runs along the top of it. */
function pressed(from: number, finger = false) {
  const drag = new TabDrag()
  const along = from * 100 + 30
  drag.down({ tabId: `t${from}`, from, pinned: false, along, x: along, y: 20, grab: 30, finger })
  return drag
}

/** The pointer moved to `along` on the strip's own line. */
const to = (drag: TabDrag, along: number, inside = true, y = 20) =>
  drag.move(along, along, y, inside, frame)

describe('a press on a tab', () => {
  test('is a click until it has gone ten pixels', () => {
    const drag = pressed(0)
    expect(to(drag, 30 + THRESHOLD)).toBe(false)
    expect(drag.on).toBe(false)
    expect(drag.release()).toEqual({ kind: 'click' })
  })

  test('then lifts, and the tab is fixed to the pointer where it was grabbed', () => {
    const drag = pressed(1)
    expect(to(drag, 130 + THRESHOLD + 1)).toBe(true)
    expect(drag.on).toBe(true)
    expect(drag.x).toBe(100 + THRESHOLD + 1)
  })

  test('diagonally too: the distance is the straight line', () => {
    const drag = pressed(0)
    drag.move(30 + 8, 30 + 8, 20 + 8, true, frame)
    expect(drag.on).toBe(true)
  })
})

describe('a tab carried along the strip', () => {
  test("takes the next slot once past the neighbour's middle", () => {
    const drag = pressed(0)
    to(drag, 70)
    expect(drag.slot).toBe(0)
    to(drag, 30 + 51)
    expect(drag.slot).toBe(1)
    to(drag, 30 + 251)
    expect(drag.slot).toBe(3)
    expect(drag.release()).toEqual({ kind: 'moved', tabId: 't0', from: 0, to: 3 })
  })

  test('does not flick back on a pixel: the pointer has to come sixteen back first', () => {
    // Standard-width tabs, where the slack is the whole sixteen pixels.
    const wide = { widths: [238, 238, 238], room: 1000, pinnedRun: 0 }
    const drag = new TabDrag()
    drag.down({
      tabId: 't0',
      from: 0,
      pinned: false,
      along: 30,
      x: 30,
      y: 20,
      grab: 30,
      finger: false,
    })
    const at = (along: number) => drag.move(along, along, 20, true, wide)

    at(30 + 130)
    expect(drag.slot).toBe(1)
    // Back across the line by a hair, but only twelve pixels from the reorder.
    at(30 + 118)
    expect(drag.slot).toBe(1)
    at(30 + 110)
    expect(drag.slot).toBe(0)
  })

  test('stops at the ends of the strip', () => {
    const drag = pressed(1)
    to(drag, -400)
    expect(drag.x).toBe(0)
    to(drag, 5000)
    expect(drag.x).toBe(700)
    expect(drag.slot).toBe(3)
  })

  test('let go where it started, it moved nothing', () => {
    const drag = pressed(2)
    to(drag, 230 + 20)
    to(drag, 230)
    expect(drag.release()).toEqual({ kind: 'moved', tabId: 't2', from: 2, to: 2 })
  })

  test('Escape puts it back', () => {
    const drag = pressed(0)
    to(drag, 30 + 251)
    drag.cancel()
    expect(drag.on).toBe(false)
    expect(drag.release()).toEqual({ kind: 'click' })
  })
})

describe('a tab carried out of the strip', () => {
  test('is out, and says so when it is let go', () => {
    const drag = pressed(0)
    to(drag, 30 + 20)
    to(drag, 30 + 20, false, 200)
    expect(drag.out).toBe(true)
    expect(drag.pointer).toEqual({ x: 50, y: 200 })
    expect(drag.release()).toEqual({ kind: 'out', tabId: 't0' })
  })

  test('and back in takes the slot nearest it straight away', () => {
    const drag = pressed(0)
    to(drag, 30 + 20)
    to(drag, 30 + 20, false, 200)
    to(drag, 30 + 205)
    expect(drag.out).toBe(false)
    expect(drag.slot).toBe(2)
  })
})
