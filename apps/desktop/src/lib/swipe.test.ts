import { describe, expect, test, vi } from 'vitest'
import {
  claimsGesture,
  fromEdge,
  isFinger,
  opensDrawer,
  ownsEveryTouch,
  ownsGesture,
  settleOpen,
} from './swipe'

const WIDTH = 300

// The walk reads two numbers and two declared values off each box it passes.
vi.stubGlobal('getComputedStyle', (node: { overflowX: string; touchAction: string }) => ({
  overflowX: node.overflowX,
  touchAction: node.touchAction,
}))

/** A screen, for the two rules that measure from an edge of one. */
const SCREEN = 1280
vi.stubGlobal('window', { innerWidth: SCREEN })

/** A box the walk can read. Cast because only the members it looks at are worth
 *  writing, and a whole Element would say nothing more. */
function box(overflowX: string, scrollWidth: number, clientWidth = 320, touchAction = 'auto') {
  return {
    overflowX,
    scrollWidth,
    clientWidth,
    touchAction,
    parentElement: null,
  } as unknown as Element
}

/** A surface that draws: the canvas says so with `touch-action: none`. */
function drawing(): Element {
  return box('hidden', 320, 320, 'none')
}

/** Puts each box inside the one before it, and answers the innermost, which is
 *  where a finger lands. */
function nest(outermost: Element, ...inside: Element[]): Element {
  let around = outermost
  for (const one of inside) {
    Object.assign(one, { parentElement: around })
    around = one
  }

  return around
}

/** Somewhere above everything, which is where the walk stops. */
const host = box('visible', 320)

describe('what owns the gesture under the finger', () => {
  test('a table wider than its box, which is a box that scrolls', () => {
    expect(ownsGesture(nest(host, box('auto', 900)), host)).toBe(true)
  })

  test('a cell inside one: the walk goes up to find it', () => {
    const cell = nest(host, box('auto', 900), box('visible', 120, 120))
    expect(ownsGesture(cell, host)).toBe(true)
  })

  test('not the writing surface, which is wider than its box but clips', () => {
    expect(ownsGesture(nest(host, box('hidden', 900)), host)).toBe(false)
  })

  test('not a box that scrolls but has nothing to scroll to', () => {
    expect(ownsGesture(nest(host, box('auto', 320)), host)).toBe(false)
  })

  test('a canvas, which has said it takes every touch on it', () => {
    expect(ownsGesture(nest(host, drawing()), host)).toBe(true)
  })

  test('and the ink layer inside one, wherever the stroke landed', () => {
    expect(ownsGesture(nest(host, drawing(), box('visible', 320)), host)).toBe(true)
  })

  test('not the note, which leaves the sideways drag to whoever wants it', () => {
    const note = box('hidden', 320, 320, 'pan-y pinch-zoom')
    expect(ownsGesture(nest(host, note), host)).toBe(false)
  })

  test('nothing above the element the gesture belongs to is looked at', () => {
    const above = box('auto', 900)
    const stop = box('visible', 320)
    const line = nest(above, stop, box('visible', 320))
    expect(ownsGesture(line, stop)).toBe(false)
  })

  test('a touch on nothing is not a touch on a scroller', () => {
    expect(ownsGesture(null, host)).toBe(false)
  })
})

describe('what a touch-action value says', () => {
  test('none and pinch-zoom take every touch', () => {
    expect(ownsEveryTouch('none')).toBe(true)
    expect(ownsEveryTouch('pinch-zoom')).toBe(true)
  })

  test('anything that names a direction leaves the others alone', () => {
    expect(ownsEveryTouch('auto')).toBe(false)
    expect(ownsEveryTouch('manipulation')).toBe(false)
    expect(ownsEveryTouch('pan-y pinch-zoom')).toBe(false)
    expect(ownsEveryTouch('pan-x')).toBe(false)
  })
})

describe('whose hand is on the screen', () => {
  test('a finger drags the drawer', () => {
    expect(isFinger('touch')).toBe(true)
  })

  test('a pen never does: it is drawing', () => {
    expect(isFinger('pen')).toBe(false)
  })

  test('and a mouse is a finger as far as this is concerned', () => {
    expect(isFinger('mouse')).toBe(true)
    expect(isFinger('')).toBe(true)
  })
})

describe('where a drag may start', () => {
  test('on a tablet, within the edge strip and nowhere else', () => {
    expect(opensDrawer(8, 32, false)).toBe(true)
    expect(opensDrawer(32, 32, false)).toBe(true)
    expect(opensDrawer(400, 32, false)).toBe(false)
  })

  test('on a phone, anywhere: the screen is the width of a thumb', () => {
    expect(opensDrawer(400, 32, true)).toBe(true)
    expect(opensDrawer(8, 32, true)).toBe(true)
  })
})

/** The one number that lets the rules above serve both drawers: a distance
 *  measured from the edge the drawer in question comes out of, so no rule has to
 *  mention a side or a direction. `sign` is 1 for the drawer on the side the lines
 *  start at and -1 for the other side's. */
describe('how far a touch is from a drawer’s own edge', () => {
  test('reading one way: the near drawer counts from the left, the far one from the right', () => {
    expect(fromEdge(40, 1, 1)).toBe(40)
    expect(fromEdge(40, 1, -1)).toBe(SCREEN - 40)
  })

  test('and the other way round, both edges swap with the reading', () => {
    expect(fromEdge(40, -1, 1)).toBe(SCREEN - 40)
    expect(fromEdge(40, -1, -1)).toBe(40)
  })

  /** Which is the whole of what the edge rule needs: a tablet's trailing strip is
   *  as near its own edge as the leading one is to the other. */
  test('so one edge rule covers both sides of a tablet', () => {
    expect(opensDrawer(fromEdge(SCREEN - 8, 1, -1), 32, false)).toBe(true)
    expect(opensDrawer(fromEdge(SCREEN / 2, 1, -1), 32, false)).toBe(false)
  })
})

describe('claiming a swipe', () => {
  test('ignores a movement too small to mean anything', () => {
    expect(claimsGesture(4, 1)).toBe(false)
  })

  test('ignores a scroll, however far it goes', () => {
    expect(claimsGesture(6, 90)).toBe(false)
  })

  test('takes a clearly sideways drag', () => {
    expect(claimsGesture(40, 8)).toBe(true)
  })

  test('takes one going the other way, which is how it closes', () => {
    expect(claimsGesture(-40, 8)).toBe(true)
  })

  test('leaves a diagonal to the scroller', () => {
    expect(claimsGesture(30, 40)).toBe(false)
  })
})

describe('where the drawer lands when the finger lifts', () => {
  test('opens once it is dragged past halfway', () => {
    expect(settleOpen(WIDTH / 2 + 1, WIDTH, 0)).toBe(true)
  })

  test('falls back when it is not', () => {
    expect(settleOpen(WIDTH / 2 - 1, WIDTH, 0)).toBe(false)
  })

  test('a flick opens it from barely anywhere', () => {
    // The whole point: a short fast swipe should not need to cross the middle.
    expect(settleOpen(30, WIDTH, 1.2)).toBe(true)
  })

  test('a flick back closes it from almost fully open', () => {
    expect(settleOpen(WIDTH - 20, WIDTH, -1.2)).toBe(false)
  })

  test('a slow drag past halfway still opens, flick or no flick', () => {
    expect(settleOpen(WIDTH - 10, WIDTH, -0.05)).toBe(true)
  })

  test('nothing dragged and nothing thrown stays shut', () => {
    expect(settleOpen(0, WIDTH, 0)).toBe(false)
  })
})
