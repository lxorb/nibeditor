/** Where each canvas was left on this device: the pan and the zoom.
 *
 *  Emil, 2026-09-13: *"when I switch to a different tab and then come back to a canvas
 *  tab then the scroll position will be lost. It should be saved locally (per device)
 *  for the canvas."* So the view is kept the way a web note's scroll is - per device,
 *  by path - and comes back on a switch, on a reopen, and after the app is started
 *  again. See place.ts, and the `!store.framed` guard in Canvas.svelte that keeps the
 *  opening fit off a view restored this way. */

import { beforeEach, expect, test, vi } from 'vitest'

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

const { viewOf, viewKept } = await import('./place')
const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { CanvasStore } = await import('./store.svelte')
const { blankCanvas } = await import('./format')

beforeEach(() => {
  localStorage.clear()
})

test('a canvas that was never open has no view', () => {
  expect(viewOf('/space/Board.canvas')).toBeNull()
  expect(viewOf(null)).toBeNull()
})

test('keeps the pan and the zoom against the path', () => {
  viewKept('/space/Board.canvas', { x: 120, y: -40, scale: 1.5 })
  expect(viewOf('/space/Board.canvas')).toEqual({ x: 120, y: -40, scale: 1.5 })
})

test('a canvas written twice keeps what was written last', () => {
  viewKept('/a.canvas', { x: 0, y: 0, scale: 1 })
  viewKept('/a.canvas', { x: 10, y: 20, scale: 2 })
  expect(viewOf('/a.canvas')).toEqual({ x: 10, y: 20, scale: 2 })
})

/** The list is this device's and it is bounded, the oldest the one that goes. */
test('keeps three hundred canvases and forgets the oldest', () => {
  for (let index = 0; index < 305; index += 1) {
    viewKept(`/plane-${index}.canvas`, { x: index, y: 0, scale: 1 })
  }

  expect(viewOf('/plane-0.canvas')).toBeNull()
  expect(viewOf('/plane-4.canvas')).toBeNull()
  expect(viewOf('/plane-5.canvas')?.x).toBe(5)
  expect(viewOf('/plane-304.canvas')?.x).toBe(304)
})

/** Storage is not a type system: what is under the key was written by some version of
 *  this app, and a row that is not a view is a canvas that opens fitted to its cards. */
test('reads nothing out of nonsense', () => {
  localStorage.setItem(
    'nib:canvas-views',
    JSON.stringify({
      '/good.canvas': { x: 1, y: 2, scale: 3 },
      '/no-scale.canvas': { x: 1, y: 2 },
      '/a-string.canvas': 'over here',
      '/scale-of-text.canvas': { x: 1, y: 2, scale: 'big' },
    }),
  )

  expect(viewOf('/good.canvas')).toEqual({ x: 1, y: 2, scale: 3 })
  expect(viewOf('/no-scale.canvas')).toBeNull()
  expect(viewOf('/a-string.canvas')).toBeNull()
  expect(viewOf('/scale-of-text.canvas')).toBeNull()
})

/** A canvas surface in a space, the way store.test.ts opens one. */
function canvasDoc(path: string) {
  return new NoteDoc(
    {
      kind: 'canvas',
      path,
      name: path.split('/').pop() ?? path,
      text: blankCanvas(),
      dirty: false,
    },
    () => undefined,
    () => true,
  )
}

/** The whole of Emil's report: a tab switched away from and come back to. The surface
 *  is torn down and built again on the same tab, and the view has to be exactly where
 *  it was - not the plane fitted afresh, which is what used to happen. */
test('a switch away and back restores the exact pan and zoom', () => {
  const tab = new Tab(canvasDoc('/space/Board.canvas'), 'pane')

  const first = new CanvasStore(tab)
  first.camera = { x: 300, y: 200, scale: 2 }
  first.part()

  const again = new CanvasStore(tab)
  expect(again.camera).toEqual({ x: 300, y: 200, scale: 2 })
  expect(again.framed).toBe(true)
})

/** And opening the canvas again - a brand-new tab, tomorrow or after a relaunch -
 *  comes back off this device rather than at the fit. */
test('and opening the canvas again restores it from this device', () => {
  const first = new CanvasStore(new Tab(canvasDoc('/space/Board.canvas'), 'pane'))
  first.camera = { x: 88, y: 12, scale: 0.5 }
  first.part()

  const reopened = new CanvasStore(new Tab(canvasDoc('/space/Board.canvas'), 'pane'))
  expect(reopened.camera).toEqual({ x: 88, y: 12, scale: 0.5 })
  expect(reopened.framed).toBe(true)
})

/** An empty plane nobody moved is left unframed, so it is not written down as the
 *  origin over a view it might get later. */
test('an untouched plane keeps no view', () => {
  const store = new CanvasStore(new Tab(canvasDoc('/space/Empty.canvas'), 'pane'))
  store.part()
  expect(viewOf('/space/Empty.canvas')).toBeNull()
})
