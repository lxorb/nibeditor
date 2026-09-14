import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A page note's own store: the column, the view held to it, the page a pull adds
 *  and the zoom a reader chose.
 *
 *  The same shape canvas/store.test.ts is written in, because it is the same store
 *  wearing pages. What it needs that a canvas does not is somewhere to write a view
 *  down - the zoom being the reader's own has to survive the app being started
 *  again - so the browser's storage is stood in for rather than stubbed away. */

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { PagesStore, PEEK } = await import('./store.svelte')
const { blankPages, GUTTER, pagesOf } = await import('@nib/markdown/pages')
const { readCanvas } = await import('../canvas/format')

/** A4 at 96 to the inch, which is what `PAPERS` says and what every sum below is
 *  against. */
const A4 = { width: 794, height: 1123 }

/** A page note open in a pane, measured and framed the way the surface does it:
 *  the pane's size, and the widest page fitted across it the first time there is
 *  anything to fit. See the two effects at the top of Pages.svelte. */
function opened(text = blankPages(), path = '/space/Lecture.pages') {
  const note = new NoteDoc(
    { kind: 'pages', path, name: 'Lecture.pages', text, dirty: false },
    () => undefined,
    () => true,
  )

  const store = new PagesStore(new Tab(note, 'pane'))
  store.measured(1180, 722)
  if (!store.framed) store.fitWidth(false)
  return { store, note }
}

/** A note of `count` pages, made the way the app makes them. */
function ofPages(count: number, path?: string) {
  const held = opened(blankPages(), path)
  for (let at = 1; at < count; at++) held.store.addPage()
  return held
}

beforeEach(() => {
  localStorage.clear()
})

describe('a page note', () => {
  test('opens on one page, fitted across the pane', () => {
    const { store } = opened()

    expect(store.count).toBe(1)
    expect(store.camera.scale).toBeCloseTo((1180 - 56) / A4.width, 6)
  })

  test('lays its column out with a gutter between the sheets', () => {
    const { store } = ofPages(3)
    const [first, second, third] = store.pages

    expect(first?.y).toBe(0)
    expect(second?.y).toBe(A4.height + GUTTER)
    expect(third?.y).toBe(2 * (A4.height + GUTTER))
    expect(store.tall).toBe(3 * A4.height + 2 * GUTTER)
  })
})

describe('a page added', () => {
  test('goes in at the end and says which page it is', () => {
    const { store } = opened()

    expect(store.addPage()).toBe(2)
    expect(store.count).toBe(2)
    expect(store.addPage()).toBe(3)
  })

  test('takes the size and the ruling of the one it follows', () => {
    const { store } = opened(blankPages('letter'))
    store.addPage()

    const [first, second] = store.pages
    expect(second?.paper).toBe(first?.paper)
    expect(second?.pattern).toBe(first?.pattern)
  })

  test('goes in after the page named, rather than at the end', () => {
    const { store } = ofPages(3)
    const second = store.pages[1]
    if (!second) throw new Error('no second page')

    expect(store.addPage(second.id)).toBe(3)
    expect(store.count).toBe(4)
  })

  /** The page the pull makes has to be one thing to take back, like every other
   *  gesture on this surface: one edit, one undo step. */
  test('is taken back whole by one undo', () => {
    const { store } = opened()
    store.addPage()
    expect(store.count).toBe(2)
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(store.count).toBe(1)
  })

  test('and put back again by redo', () => {
    const { store } = opened()
    store.addPage()
    store.undo()

    store.redo()
    expect(store.count).toBe(2)
  })

  test('reaches the file, so a page is a page after the note is closed', () => {
    const { store, note } = opened()
    store.addPage()
    store.part()

    expect(pagesOf(readCanvas(note.text))).toHaveLength(2)
  })

  test('and is refused outright in a space somebody shared to read', () => {
    const { store } = opened()
    store.readOnly = true

    expect(store.addPage()).toBe(0)
    expect(store.count).toBe(1)
  })
})

describe('where the next sheet would go', () => {
  test('is the box the page that is added lands in', () => {
    const { store } = ofPages(2)
    const slot = store.slot
    if (!slot) throw new Error('no slot')

    expect(store.addPage()).toBe(3)
    const made = store.pages[2]
    expect({ x: made?.x, y: made?.y, width: made?.width, height: made?.height }).toEqual(slot)
  })

  test('is nothing at all in a note nobody may write in', () => {
    const { store } = opened()
    store.readOnly = true

    expect(store.slot).toBeNull()
  })
})

describe('the view held to the column', () => {
  test('cannot be scrolled off the top', () => {
    const { store } = ofPages(3)
    store.camera = store.held({ ...store.camera, y: -10_000 })

    expect(store.top).toBeGreaterThan(-40)
    expect(store.top).toBeLessThan(0)
  })

  /** The end of a page note is where the next page comes from, so the scroll
   *  reaches far enough past the last sheet to show the silhouette of it. */
  test('reaches a band past the last page, for the sheet that is not there yet', () => {
    const { store } = ofPages(3)
    store.camera = store.held({ ...store.camera, y: 10_000 })

    const below = store.viewBottom - store.tall
    expect(below).toBeCloseTo(GUTTER + PEEK / store.camera.scale, 6)
    expect(store.camera.y).toBeCloseTo(store.bottom, 6)
  })

  test('and stops at the paper in a note nobody may write in', () => {
    const { store } = ofPages(3)
    store.readOnly = true
    store.camera = store.held({ ...store.camera, y: 10_000 })

    expect(store.viewBottom - store.tall).toBeLessThan(GUTTER)
  })

  test('sits sideways on nought while the paper is wider than the pane', () => {
    const { store } = ofPages(2)
    store.camera = store.held({ ...store.camera, x: 400 })

    expect(store.camera.x).toBeCloseTo(0, 6)
  })
})

describe('the two fits and the zoom in between', () => {
  test('fitting the width puts the widest page across the pane', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)
    store.fitAgain()

    expect(store.camera.scale).toBeCloseTo((1180 - 56) / A4.width, 6)
  })

  test('fitting the page puts the whole of it in the pane', () => {
    const { store } = ofPages(2)
    store.fitPage()

    expect(store.camera.scale).toBeCloseTo((722 - 56) / A4.height, 6)
  })

  test('and one to one is one to one', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)

    expect(store.camera.scale).toBe(1)
  })

  /** Until the reader has zoomed, the paper stays fitted across the pane: the
   *  sidebar opening must not push the page off the side of it. Once they have, the
   *  zoom is theirs and nothing takes it off them. */
  test('the paper stays fitted while nobody has chosen a zoom', () => {
    const { store } = ofPages(2)
    store.measured(800, 722)

    expect(store.camera.scale).toBeCloseTo((800 - 56) / A4.width, 6)
  })

  test('and a zoom the reader chose survives the pane being resized', () => {
    const { store } = ofPages(2)
    store.zoomTo(1)
    store.measured(800, 722)

    expect(store.camera.scale).toBe(1)
  })

  /** The one that was wrong: the camera came back after a restart and `chose` did
   *  not, so the first measurement fitted the paper across the pane again and threw
   *  the reader's zoom away. */
  test('and survives the app being started again', () => {
    const first = ofPages(2, '/space/Kept.pages')
    first.store.zoomTo(1)
    first.store.part()

    const again = opened(first.note.text, '/space/Kept.pages')
    expect(again.store.camera.scale).toBe(1)

    again.store.measured(900, 700)
    expect(again.store.camera.scale).toBe(1)
  })

  test('while a fitted one comes back fitted, and fits the new pane', () => {
    const first = ofPages(2, '/space/Fitted.pages')
    first.store.turnTo(2)
    first.store.part()

    const again = opened(first.note.text, '/space/Fitted.pages')
    again.store.measured(800, 722)

    expect(again.store.camera.scale).toBeCloseTo((800 - 56) / A4.width, 6)
  })
})

describe('turning to a page', () => {
  test('puts its top at the top of the pane', () => {
    const { store } = ofPages(4)
    store.turnTo(3)

    expect(store.showing).toBe(3)
    // The margin's worth of paper-coloured air above it, in plane units.
    expect(store.top).toBeCloseTo((store.pages[2]?.y ?? 0) - 28 / store.camera.scale, 0)
  })

  test('and never past the pages there are', () => {
    const { store } = ofPages(3)
    store.turnTo(99)

    expect(store.showing).toBe(3)
  })

  /** A sixty page note is the one that has to stay cheap: the boxes come out of the
   *  list on every read, so this is sixty sums rather than sixty objects kept in
   *  step. */
  test('works the same in a note of sixty pages', () => {
    const { store } = ofPages(60)
    expect(store.count).toBe(60)

    store.turnTo(60)
    expect(store.showing).toBe(60)
    expect(store.tall).toBe(60 * A4.height + 59 * GUTTER)
  })
})
