import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { marginAround, sameBox, watchScale, watchShifts, type Box } from './shifts'

describe('the root shrunk to the box', () => {
  test('is the box, in whole pixels, from every edge of the window', () => {
    const box = { left: 240, top: 76, width: 960, height: 684 }
    expect(marginAround(box, 1200, 800)).toBe('-76px 0px -40px -240px')
  })

  test('never cuts into a box between two pixels', () => {
    // 240.5 from the left: the root starts at 240, so the box is all inside it.
    const box = { left: 240.5, top: 76.25, width: 480.5, height: 600 }
    expect(marginAround(box, 1200, 800)).toBe('-76px -479px -123px -240px')
  })

  test('the same box is the same, and a pixel moved is not', () => {
    const box = { left: 10, top: 20, width: 30, height: 40 }
    expect(sameBox(box, { ...box })).toBe(true)
    expect(sameBox(box, { ...box, left: 11 })).toBe(false)
    expect(sameBox(box, { ...box, height: 41 })).toBe(false)
  })
})

/** An intersection observer that answers when the test says, with the ratio it says. */
class Watching {
  static all: Watching[] = []
  watched: Element | null = null
  gone = false

  constructor(
    readonly heard: (entries: IntersectionObserverEntry[]) => void,
    readonly options: IntersectionObserverInit,
  ) {
    Watching.all.push(this)
  }

  observe(node: Element) {
    this.watched = node
  }

  disconnect() {
    this.gone = true
  }

  say(ratio: number) {
    this.heard([{ intersectionRatio: ratio } as IntersectionObserverEntry])
  }
}

/** A resize observer the test makes speak, for the element and the window both. */
class Sizing {
  static all: Sizing[] = []
  watched: Element | null = null
  gone = false

  constructor(readonly heard: () => void) {
    Sizing.all.push(this)
  }

  observe(node: Element) {
    this.watched = node
  }

  disconnect() {
    this.gone = true
  }
}

/** The one observer still watching. */
function live(): Watching {
  const left = Watching.all.filter((one) => !one.gone)
  expect(left).toHaveLength(1)
  const [one] = left
  if (!one) throw new Error('nothing is watching')
  return one
}

describe('a hole that moves', () => {
  let box: Box

  const hole = {
    getBoundingClientRect: () => ({ ...box, x: box.left, y: box.top }),
  } as unknown as Element

  /** The window's own resize listeners, by the test's hand. */
  const listening = new Set<() => void>()
  const viewport = { clientWidth: 1200, clientHeight: 800 }

  beforeEach(() => {
    box = { left: 240, top: 76, width: 960, height: 684 }
    viewport.clientWidth = 1200
    Watching.all = []
    Sizing.all = []
    listening.clear()
    vi.stubGlobal('IntersectionObserver', Watching)
    vi.stubGlobal('ResizeObserver', Sizing)
    vi.stubGlobal('document', { documentElement: viewport })
    vi.stubGlobal('window', {
      addEventListener: (_: string, heard: () => void) => listening.add(heard),
      removeEventListener: (_: string, heard: () => void) => listening.delete(heard),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('is watched through a root of exactly its box', () => {
    const stop = watchShifts(hole, () => undefined)
    expect(live().options.rootMargin).toBe('-76px 0px -40px -240px')
    expect(live().options.threshold).toBe(1)
    stop()
    expect(Watching.all.every((one) => one.gone)).toBe(true)
    expect(Sizing.all.every((one) => one.gone)).toBe(true)
    expect(listening.size).toBe(0)
  })

  /** The sidebar opened, which shrinks the box inside the root it was armed with and
   *  says nothing to an intersection observer; then the sidebar moved to the other side,
   *  a move inside that old root, which said nothing either. */
  test('a box that shrank inside its root is watched where it is now', () => {
    box = { left: 0, top: 76, width: 1200, height: 684 }
    watchShifts(hole, () => undefined)
    live().say(1)

    box = { left: 240, top: 76, width: 960, height: 684 }
    Sizing.all[0]?.heard()
    expect(live().options.rootMargin).toBe('-76px 0px -40px -240px')
  })

  test('a window that grew round the box is watched at its new size', () => {
    watchShifts(hole, () => undefined)
    live().say(1)

    viewport.clientWidth = 1400
    for (const heard of listening) heard()
    expect(live().options.rootMargin).toBe('-76px -200px -40px -240px')
  })

  test('says nothing while it sits still', () => {
    const shifted = vi.fn()
    watchShifts(hole, shifted)
    live().say(1)
    expect(shifted).not.toHaveBeenCalled()
  })

  test('says so the moment it moves, and is watched where it went', () => {
    const shifted = vi.fn()
    watchShifts(hole, shifted)
    live().say(1)

    // The file list went to the other side: the panes moved left, the same size.
    box = { ...box, left: 0 }
    live().say(0.75)
    expect(shifted).toHaveBeenCalledTimes(1)
    expect(live().options.rootMargin).toBe('-76px -240px -40px 0px')
  })

  test('a first ratio a hair under one is the rounding, and becomes the line', () => {
    const shifted = vi.fn()
    watchShifts(hole, shifted)
    live().say(0.9995)
    expect(live().options.threshold).toBe(0.9995)
  })

  test('seen whole but somewhere else is a move as well', () => {
    const shifted = vi.fn()
    watchShifts(hole, shifted)
    live().say(1)
    box = { ...box, top: 100 }
    live().say(1)
    expect(shifted).toHaveBeenCalledTimes(1)
  })

  test('a hole with no room is not watched until it has some', () => {
    box = { ...box, width: 0 }
    watchShifts(hole, () => undefined)
    expect(Watching.all).toHaveLength(0)
  })
})

describe('the screen under the window', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('another scale is said, and the next one is listened for', () => {
    const queries: { media: string; heard: (() => void) | null }[] = []
    vi.stubGlobal('devicePixelRatio', 1.5)
    vi.stubGlobal('matchMedia', (media: string) => {
      const one = { media, heard: null as (() => void) | null }
      queries.push(one)
      return {
        addEventListener: (_: string, heard: () => void) => (one.heard = heard),
        removeEventListener: () => (one.heard = null),
      }
    })

    const changed = vi.fn()
    const stop = watchScale(changed)
    expect(queries.map((one) => one.media)).toEqual(['(resolution: 1.5dppx)'])

    vi.stubGlobal('devicePixelRatio', 2)
    queries[0]?.heard?.()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(queries.map((one) => one.media)).toEqual([
      '(resolution: 1.5dppx)',
      '(resolution: 2dppx)',
    ])
    expect(queries[0]?.heard).toBeNull()

    stop()
    expect(queries[1]?.heard).toBeNull()
  })
})
