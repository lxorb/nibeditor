import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'

/** The sidebars a thumb pulls out. The arithmetic is in swipe.ts; what this
 *  covers is the part that needs a finger and a screen: which gestures a drawer
 *  takes, which of the two edges a gesture belongs to, and which it has to keep
 *  its hands off.
 *
 *  Nothing here is a phone. The host, the panels inside it and the element
 *  under the finger are the few members the handlers actually read. */

/** How far the drawer can travel, which the host is measured for. */
const WIDTH = 280

/** How near the left edge a tablet's drag has to start; the tokens' value. */
const EDGE = 32

/** What the finger is on. Set per gesture; the drag reads it once, at the
 *  start, through `elementFromPoint`. */
let touched: Element | null = null

/** A box as the walk over it reads a box. */
function box(overflowX: string, scrollWidth: number, touchAction = 'auto'): Element {
  // Cast because only the members the walk looks at are worth writing.
  return {
    overflowX,
    scrollWidth,
    clientWidth: 320,
    touchAction,
    parentElement: null,
  } as unknown as Element
}

/** Plain writing: nothing under it goes anywhere sideways. */
const prose = box('visible', 320)
/** A wide table, which owns any sideways drag over it. */
const table = box('auto', 900)
/** A canvas, which has said it takes every touch on it for its own ink. */
const canvas = box('hidden', 320, 'none')

vi.stubGlobal('getComputedStyle', (node: { overflowX?: string; touchAction?: string }) => ({
  overflowX: node.overflowX ?? 'visible',
  touchAction: node.touchAction ?? 'auto',
  getPropertyValue: () => `${EDGE}px`,
}))
vi.stubGlobal('document', { elementFromPoint: () => touched, documentElement: {} })
vi.stubGlobal('window', { innerWidth: 1280 })

/** The element both layers live in, and the handlers it was given. */
function stage() {
  const listeners = new Map<string, (event: never) => void>()
  const element = {
    querySelector: () => ({ getBoundingClientRect: () => ({ width: WIDTH }) }),
    addEventListener: (kind: string, run: (event: never) => void) => listeners.set(kind, run),
    removeEventListener: (kind: string) => listeners.delete(kind),
  }

  return { element: element as unknown as HTMLElement, listeners }
}

function moment(x: number, y: number, at: number): TouchEvent {
  return {
    touches: [{ clientX: x, clientY: y }],
    timeStamp: at,
    preventDefault: () => undefined,
  } as unknown as TouchEvent
}

/** A fresh drawer over a fresh workspace, since both remember the last
 *  gesture, on a device of the given kind.
 *
 *  `right` is what the other side of the window holds, which is empty for
 *  everybody until somebody moves a panel over: a side with nothing on it has no
 *  drawer to pull out, and that is what the drag asks before it takes a gesture
 *  going that way. */
async function opened(device: 'phone' | 'tablet' = 'phone', right: string[] = []) {
  vi.resetModules()
  const workspace = {
    panel: null as string | null,
    rightPanel: null as string | null,
    right,
    /** The panel the right side shows when something asks it to open: whatever
     *  was last open there, or the first one that was moved over. */
    get nextRight(): string | null {
      return this.rightPanel ?? this.right[0] ?? null
    },
    showPanel(next: string) {
      if (this.right.includes(next)) this.rightPanel = this.rightPanel === next ? null : next
      else this.panel = this.panel === next ? null : next
    },
    closePanel(side: 'left' | 'right' = 'left') {
      if (side === 'right') this.rightPanel = null
      else this.panel = null
    },
  }
  vi.doMock('./workspace.svelte', () => ({ workspace }))
  vi.doMock('./viewport.svelte', () => ({ viewport: { device } }))

  const { drawer, followDrawers, rightDrawer } = await import('./drawer.svelte')
  const host = stage()
  const stop = followDrawers(host.element)

  /** One finger - or one pen - down, across and up, over whatever `on` is. */
  const swipe = (on: Element, from: number, to: number, pointer = 'touch', y = 400) => {
    touched = on
    let at = 0
    host.listeners.get('pointerdown')?.({ pointerType: pointer } as never)
    host.listeners.get('touchstart')?.(moment(from, y, (at += 16)) as never)
    for (let x = from; Math.abs(x - to) > 20; x += Math.sign(to - from) * 20) {
      host.listeners.get('touchmove')?.(moment(x, y, (at += 16)) as never)
    }
    return {
      /** How far the drawer has been pulled out, before the finger lifts. */
      pulled: drawer.at,
      /** And the other side's, for a gesture that belongs to that edge. */
      pulledRight: rightDrawer.at,
      lift: () => host.listeners.get('touchend')?.(moment(to, y, (at += 16)) as never),
    }
  }

  return { drawer, followDrawers, rightDrawer, workspace, swipe, stop, host }
}

beforeAll(async () => {
  // Reading the store compiles its runes, which on a cold cache costs more than
  // a test is given.
  const first = await opened()
  first.stop()
})

afterEach(() => {
  vi.doUnmock('./workspace.svelte')
  vi.doUnmock('./viewport.svelte')
})

describe('the drag that opens the drawer', () => {
  test('a sideways pull over the writing opens it and follows the thumb', async () => {
    const { swipe, workspace, drawer } = await opened()

    const drag = swipe(prose, 30, 200)
    expect(workspace.panel).toBe('tree')
    expect(drag.pulled).toBeGreaterThan(0)
    // The layers are on the compositor while the finger is down, and off it
    // again the moment the finger lifts.
    expect(drawer.held).toBe(true)
    drag.lift()
    expect(drawer.held).toBe(false)
  })

  test('a scroll up the note is not a pull, however far it goes', async () => {
    const { drawer, followDrawers, workspace } = await opened()
    const host = stage()

    // Straight up the screen, which the drag gives up on at the first move.
    touched = prose
    followDrawers(host.element)
    host.listeners.get('touchstart')?.(moment(200, 600, 16) as never)
    host.listeners.get('touchmove')?.(moment(202, 500, 32) as never)
    host.listeners.get('touchmove')?.(moment(204, 380, 48) as never)

    expect(drawer.at).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a table takes its own sideways drag, and the drawer stays put', async () => {
    const { swipe, workspace } = await opened()

    expect(swipe(table, 300, 60).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('it still stays put on the drag straight after one that moved it', async () => {
    const { swipe, workspace } = await opened()

    // The drawer is open, so the gesture that would close it is a leftward one:
    // the same direction as scrolling a table onwards. What the drawer knew
    // about the first drag must not reach the second.
    swipe(prose, 30, 200).lift()
    expect(workspace.panel).toBe('tree')

    expect(swipe(table, 300, 60).pulled).toBe(null)
    expect(workspace.panel).toBe('tree')
  })

  test('a second finger is a pinch, and the drawer lets go of the gesture', async () => {
    const { drawer, followDrawers } = await opened()
    const host = stage()
    followDrawers(host.element)

    touched = prose
    host.listeners.get('touchstart')?.({
      touches: [
        { clientX: 30, clientY: 400 },
        { clientX: 200, clientY: 400 },
      ],
      timeStamp: 16,
      preventDefault: () => undefined,
    } as never)
    host.listeners.get('touchmove')?.(moment(200, 400, 32) as never)

    expect(drawer.at).toBe(null)
  })
})

/** The other side of the window, which is a drawer wherever the left one is -
 *  Discord's members panel, and swipeable the same way. One engine drives both:
 *  the same claim, the same clamp, the same settle, with a sign that says which
 *  edge the drawer comes out of. */
describe('the drag that opens the other side', () => {
  test('a pull the other way opens it and follows the thumb', async () => {
    const { swipe, workspace, rightDrawer } = await opened('phone', ['outline'])

    const drag = swipe(prose, 300, 60)
    expect(workspace.rightPanel).toBe('outline')
    expect(drag.pulledRight).toBeGreaterThan(0)
    expect(rightDrawer.held).toBe(true)
    drag.lift()
    expect(rightDrawer.held).toBe(false)
    expect(workspace.rightPanel).toBe('outline')
  })

  /** The left drawer is not disturbed by any of it: the same gesture used to be
   *  its own and meant nothing, and a rightward one still opens the file list. */
  test('and leaves the left one where it was', async () => {
    const { swipe, workspace, drawer } = await opened('phone', ['outline'])

    swipe(prose, 300, 60).lift()
    expect(workspace.panel).toBe(null)
    expect(drawer.at).toBe(null)
  })

  test('a pull along the line still opens the file list', async () => {
    const { swipe, workspace } = await opened('phone', ['outline'])

    const drag = swipe(prose, 30, 260)
    expect(workspace.panel).toBe('tree')
    expect(workspace.rightPanel).toBe(null)
    expect(drag.pulled).toBeGreaterThan(0)
    expect(drag.pulledRight).toBe(null)
  })

  /** A window nobody has arranged has no right side at all - not an empty one -
   *  so there is nothing there to pull out and the gesture means nothing, which
   *  is what it meant before this existed. */
  test('nothing happens where the right side holds nothing', async () => {
    const { swipe, workspace } = await opened('phone')

    const drag = swipe(prose, 300, 60)
    expect(drag.pulled).toBe(null)
    expect(drag.pulledRight).toBe(null)
    expect(workspace.rightPanel).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('open, a pull back the other way puts it away', async () => {
    const { swipe, workspace } = await opened('phone', ['outline'])

    swipe(prose, 300, 60).lift()
    expect(workspace.rightPanel).toBe('outline')

    const back = swipe(prose, 60, 300)
    expect(back.pulledRight).toBeLessThan(WIDTH)
    back.lift()
    expect(workspace.rightPanel).toBe(null)
  })

  /** The settle is the left drawer's own, to the millisecond: it is worked out
   *  from how far the drawer still has to go, and one engine works it out. The
   *  same distance mirrored is the same number - which is the whole reason for
   *  there being one engine rather than two. */
  test('settles over exactly the time the left one takes', async () => {
    const left = await opened('phone', ['outline'])
    left.swipe(prose, 30, 270).lift()
    expect(left.drawer.settle).toBeGreaterThan(0)
    expect(left.drawer.at).toBe(null)

    const right = await opened('phone', ['outline'])
    right.swipe(prose, 300, 60).lift()
    expect(right.rightDrawer.at).toBe(null)
    expect(right.rightDrawer.settle).toBe(left.drawer.settle)
  })

  test('a tablet opens it from its own edge and nowhere else', async () => {
    const near = await opened('tablet', ['outline'])
    // 1280 wide, so the trailing strip is the last 32 pixels of it.
    expect(near.swipe(prose, 1276, 1000).pulledRight).toBeGreaterThan(0)
    expect(near.workspace.rightPanel).toBe('outline')

    const middle = await opened('tablet', ['outline'])
    expect(middle.swipe(prose, 640, 300).pulledRight).toBe(null)
    expect(middle.workspace.rightPanel).toBe(null)
  })

  /** Both layers go on the compositor while it is still either drawer's gesture,
   *  and the one that turns out not to be moving comes straight off again. */
  test('the side that loses the gesture is not left promoted', async () => {
    const { swipe, drawer, rightDrawer } = await opened('phone', ['outline'])

    const drag = swipe(prose, 300, 60)
    expect(rightDrawer.held).toBe(true)
    expect(drawer.held).toBe(false)
    drag.lift()
  })

  test('a pen is drawing on that edge too', async () => {
    const { swipe, workspace } = await opened('tablet', ['outline'])

    expect(swipe(prose, 1276, 1000, 'pen').pulledRight).toBe(null)
    expect(workspace.rightPanel).toBe(null)
  })
})

describe('a pen is drawing, not swiping', () => {
  test('a stroke across the note leaves the drawer where it was', async () => {
    const { swipe, workspace, drawer } = await opened('tablet')

    expect(swipe(prose, 8, 400, 'pen').pulled).toBe(null)
    expect(workspace.panel).toBe(null)
    expect(drawer.held).toBe(false)
  })

  test('nor over the canvas, which is where the pen mostly is', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(canvas, 8, 400, 'pen').pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a finger after a pen is still a finger', async () => {
    const { swipe, workspace } = await opened('tablet')

    swipe(prose, 8, 400, 'pen')
    expect(workspace.panel).toBe(null)

    expect(swipe(prose, 8, 400).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })
})

describe('where a tablet lets the drag begin', () => {
  test('at the left edge, the way a tablet app has it', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(prose, EDGE - 8, 300).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })

  test('and nowhere else: a drag in the middle of the page belongs to the page', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(prose, 500, 900).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('a finger over the canvas belongs to the canvas wherever it starts', async () => {
    const { swipe, workspace } = await opened('tablet')

    expect(swipe(canvas, 4, 300).pulled).toBe(null)
    expect(workspace.panel).toBe(null)
  })

  test('open, it closes from anywhere: the drawer is under the finger', async () => {
    const { swipe, workspace } = await opened('tablet')

    swipe(prose, 8, 300).lift()
    expect(workspace.panel).toBe('tree')

    const back = swipe(prose, 260, 20)
    expect(back.pulled).toBeLessThan(WIDTH)
    back.lift()
    expect(workspace.panel).toBe(null)
  })

  test('a phone opens from the middle, where an edge would be a thin target', async () => {
    const { swipe, workspace } = await opened('phone')

    expect(swipe(prose, 500, 900).pulled).toBeGreaterThan(0)
    expect(workspace.panel).toBe('tree')
  })
})
