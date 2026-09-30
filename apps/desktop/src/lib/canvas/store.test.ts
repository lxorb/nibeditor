import { describe, expect, test, vi } from 'vitest'

/** The surface holds a document, and a document holds the shared text every pane
 *  is a view onto. Neither needs a browser, but the modules they come from read
 *  the browser's storage as they load, so it is stood in for first. */
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
  clear: () => undefined,
  key: () => null,
  length: 0,
})

const { NoteDoc, Tab } = await import('../workspace/documents.svelte')
const { CanvasStore } = await import('./store.svelte')
const { blankCanvas, readCanvas, writeCanvas } = await import('./format')
type Canvas = import('./format').Canvas
type CanvasNode = import('./format').CanvasNode
type Shared = import('./shared').SharedPlane

function card(id: string, x = 0): CanvasNode {
  return { id, type: 'text', x, y: 0, width: 250, height: 60, text: id }
}

/** A canvas tab, with the plane it opens on written into its document. In a space,
 *  so it keeps itself the way every plane somebody draws on does. */
function opened(text = blankCanvas()) {
  const note = new NoteDoc(
    { kind: 'canvas', path: '/space/Board.canvas', name: 'Board.canvas', text, dirty: false },
    () => undefined,
  )

  return { store: new CanvasStore(new Tab(note, 'pane')), note }
}

/** A room, recorded rather than run: what it was pushed, and what it was asked. */
function room(): Shared & { pushed: Canvas[]; undone: number } {
  return {
    pushed: [],
    undone: 0,
    push(_before: Canvas, after: Canvas) {
      this.pushed.push(after)
    },
    undo() {
      this.undone++
      return true
    },
    redo() {
      return false
    },
    hand() {
      return undefined
    },
  }
}

const ids = (canvas: Canvas) => canvas.nodes.map((node) => node.id)

describe('a plane in a space somebody shared to read', () => {
  test('takes no edit at all', () => {
    const { store, note } = opened()
    store.readOnly = true

    store.edit({ ...store.canvas, nodes: [card('a')] })

    expect(store.canvas.nodes).toEqual([])
    expect(readCanvas(note.text).nodes).toEqual([])
    expect(note.dirty).toBe(false)
  })

  test('while one nobody shared takes every edit', () => {
    const { store, note } = opened()

    store.edit({ ...store.canvas, nodes: [card('a')] })
    expect(ids(store.canvas)).toEqual(['a'])

    // The plane is right at once and the file catches up: serialising it is the size
    // of the plane, so it waits for the drawing to stop. See `edit`.
    store.part()
    expect(readCanvas(note.text).nodes).toHaveLength(1)
  })
})

/** The eraser is the one gesture that cannot wait for the pointer to come up: it
 *  has to answer under the nib. So it edits on every point of its drag, and the
 *  plane has to treat the drag as the one thing it is. */
describe('a gesture that edits as it goes', () => {
  test('is one step to take back, however many points the drag had', () => {
    const { store } = opened()
    store.edit({ ...store.canvas, nodes: [card('a'), card('b'), card('c')] })

    store.edit({ ...store.canvas, nodes: [card('a'), card('b')] }, 'rub:1')
    store.edit({ ...store.canvas, nodes: [card('a')] }, 'rub:1')

    store.undo()
    expect(ids(store.canvas)).toEqual(['a', 'b', 'c'])
    expect(store.canUndo).toBe(true)
  })

  test('and a second drag is a second step', () => {
    const { store } = opened()
    store.edit({ ...store.canvas, nodes: [card('a'), card('b')] }, 'rub:1')
    store.edit({ ...store.canvas, nodes: [card('a')] }, 'rub:2')

    store.undo()
    expect(ids(store.canvas)).toEqual(['a', 'b'])
  })

  test('writes the file when the drag has gone quiet rather than on every point', () => {
    vi.useFakeTimers()
    try {
      const { store, note } = opened()
      const before = note.text

      store.edit({ ...store.canvas, nodes: [card('a')] }, 'rub:1')
      expect(ids(store.canvas)).toEqual(['a'])
      expect(note.text).toBe(before)

      vi.advanceTimersByTime(1300)
      expect(ids(readCanvas(note.text))).toEqual(['a'])
    } finally {
      vi.useRealTimers()
    }
  })

  test('and writes it at once when the surface is being taken down', () => {
    vi.useFakeTimers()
    try {
      const { store, note } = opened()
      store.edit({ ...store.canvas, nodes: [card('a')] }, 'rub:1')

      store.part()
      expect(ids(readCanvas(note.text))).toEqual(['a'])
    } finally {
      vi.useRealTimers()
    }
  })

  /** What one stroke costs the pointer coming up.
   *
   *  It used to be the whole document: the plane written out, the previous text read
   *  back and both of them walked to find what changed - a hundred and fifty
   *  milliseconds on a plane of ten thousand strokes, on the tick the pen lifted,
   *  while the hand was already moving. Now the plane on screen is right at once and
   *  the file catches up when the drawing stops. Counted in writes rather than
   *  milliseconds, for the reason the rest of these give. */
  test('a stroke finished writes nothing until the drawing stops', () => {
    vi.useFakeTimers()
    try {
      const { store, note } = opened()
      let writes = 0
      const replace = note.replace.bind(note)
      note.replace = (text: string) => {
        writes += 1
        replace(text)
      }

      // Six strokes drawn one after another, as a hand draws them.
      for (let stroke = 0; stroke < 6; stroke++) {
        store.edit({ ...store.canvas, nodes: [...store.canvas.nodes, card(`s${stroke}`)] })
        vi.advanceTimersByTime(100)
      }

      expect(writes).toBe(0)
      expect(ids(store.canvas)).toHaveLength(6)

      // One write for the six, once the hand stops.
      vi.advanceTimersByTime(1300)
      expect(writes).toBe(1)
      expect(ids(readCanvas(note.text))).toHaveLength(6)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a plane that is in a room', () => {
  test('sends what it changed to the room rather than remembering it here', () => {
    const { store } = opened()
    const held = room()
    store.shared = held

    store.edit({ ...store.canvas, nodes: [card('a')] })

    expect(held.pushed).toHaveLength(1)
    expect(ids(held.pushed[0] ?? blank())).toEqual(['a'])

    // The room is the history now, so taking something back is asked of it, and
    // what the bar's arrows say is what the room last said rather than what this
    // device happens to remember.
    expect(store.canUndo).toBe(false)
    store.historyIs({ undo: true, redo: false })
    expect(store.canUndo).toBe(true)

    store.undo()
    expect(held.undone).toBe(1)
  })

  test('and still writes the file, so the plane is on this disk too', () => {
    const { store, note } = opened()
    store.shared = room()

    store.edit({ ...store.canvas, nodes: [card('a')] })
    store.part()

    expect(ids(readCanvas(note.text))).toEqual(['a'])
  })

  test('takes on what the room says, and writes it down a moment later', () => {
    vi.useFakeTimers()
    try {
      const { store, note } = opened()
      store.shared = room()
      const before = note.text

      store.arrived({ ...store.canvas, nodes: [card('theirs', 400)], at: { theirs: 1000 } })

      // On screen at once: a stroke somebody else drew appears as they draw it.
      expect(ids(store.canvas)).toEqual(['theirs'])
      // And not written per arrival, which would cost the plane every time rather
      // than costing what arrived.
      expect(note.text).toBe(before)

      vi.advanceTimersByTime(1300)
      expect(ids(readCanvas(note.text))).toEqual(['theirs'])
    } finally {
      vi.useRealTimers()
    }
  })

  test('writes nothing at all when what arrived is what the file already said', () => {
    vi.useFakeTimers()
    try {
      const { store, note } = opened()
      store.arrived(store.canvas)

      vi.advanceTimersByTime(1300)
      expect(note.dirty).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

function blank(): Canvas {
  return { nodes: [], edges: [], ink: [], at: {}, gone: {} }
}

describe('a plane written after it opens', () => {
  /** A plane of `count` strokes, as this app writes one. */
  function drawnPlane(count: number): string {
    const plane = blank()
    plane.ink = Array.from({ length: count }, (_, at) => ({
      id: `s${String(at).padStart(4, '0')}`,
      tool: 'pen' as const,
      color: 'ink' as const,
      size: 3,
      points: Array.from({ length: 10 }, (__, step) => ({
        x: at * 10 + step,
        y: step,
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        t: step * 12,
      })),
    }))
    plane.at = Object.fromEntries(plane.ink.map((stroke) => [stroke.id, 1]))
    return writeCanvas(plane)
  }

  /** Every turn the plane's printing ahead takes, taken. */
  async function warmed() {
    for (let turn = 0; turn < 20; turn++) await new Promise((go) => setTimeout(go, 0))
  }

  /** What the document's words were handed for each write: how many characters went
   *  in, and whether they came as the changes or as the whole file. */
  function watched(note: InstanceType<typeof NoteDoc>) {
    const handed: { inserted: number; known: boolean }[] = []
    const replace = note.live.replace.bind(note.live)
    note.live.replace = (text, recorded, changes) => {
      handed.push({
        inserted: changes ? changes.reduce((sum, one) => sum + one.insert.length, 0) : text.length,
        known: changes !== undefined,
      })
      replace(text, recorded, changes)
    }
    return handed
  }

  test('hands the document the stroke drawn, not the plane', async () => {
    const { store, note } = opened(drawnPlane(300))
    await warmed()
    const handed = watched(note)

    const stroke = { ...store.canvas.ink[0]!, id: 'new' }
    store.edit({ ...store.canvas, ink: [...store.canvas.ink, stroke] })
    store.part()

    expect(handed).toHaveLength(1)
    expect(handed[0]?.known).toBe(true)
    expect(handed[0]?.inserted).toBeLessThan(note.text.length / 50)
    expect(note.text).toBe(writeCanvas(store.canvas))
    expect(note.live.text.toString()).toBe(note.text)
  })

  test('and the stroke rubbed out, from the middle of it', async () => {
    const { store, note } = opened(drawnPlane(300))
    await warmed()
    const handed = watched(note)

    store.edit({ ...store.canvas, ink: store.canvas.ink.filter((_, at) => at !== 150) })
    store.part()

    expect(handed[0]?.known).toBe(true)
    expect(handed[0]?.inserted).toBeLessThan(note.text.length / 50)
    expect(note.text).toBe(writeCanvas(store.canvas))
    expect(note.live.text.toString()).toBe(note.text)
  })

  test('a plane some other program wrote is compared once, and then the same way', async () => {
    const { store, note } = opened(JSON.stringify(JSON.parse(drawnPlane(50))))
    await warmed()
    const handed = watched(note)

    for (const id of ['one', 'two']) {
      const stroke = { ...store.canvas.ink[0]!, id }
      store.edit({ ...store.canvas, ink: [...store.canvas.ink, stroke] })
      store.part()
    }

    expect(handed.map((one) => one.known)).toEqual([false, true])
    expect(note.text).toBe(writeCanvas(store.canvas))
    expect(note.live.text.toString()).toBe(note.text)
  })
})
