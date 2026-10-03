import { describe, expect, test } from 'vitest'
import { type Canvas, readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { pushPlane, readPlane } from '@nib/rooms/plane'
import { hash32, seedPlane } from '@nib/sync-core/seed'
import * as Y from 'yjs'
import type { PlaneSurface } from '../canvas/shared'
import { attachPlane } from './binding'
import { Engine } from './engine'
import { MemoryDisk } from './memory-disk'
import { MemoryStore } from './memory-store'
import { numbersRow, wantedRow } from './records'
import { put } from './store'
import type { World } from './world'

/** A canvas under sync v2 (docs/sync-v2.md 5.6): joined to its document the way a note
 *  is, so what is drawn goes into the document as this device's pending edits, room or
 *  no room, and what arrives in the document reaches the plane on screen as the objects
 *  it touched. */

const ROOT = '/device/space'
const SPACE = 'space'
const ID = 'c1'

function card(id: string, text: string, x = 0): Canvas['nodes'][number] {
  return { id, type: 'text', text, x, y: 0, width: 200, height: 80 }
}

function plane(...nodes: Canvas['nodes']): Canvas {
  return readCanvas(writeCanvas({ nodes, edges: [], ink: [], at: {}, gone: {} }))
}

async function device(on: Canvas) {
  const store = new MemoryStore('d0')
  const seeding = store.open()
  const confirmed = seedPlane(ID, 1, on)
  await seeding.write([
    put('spaces', { space_id: SPACE, root: ROOT, cursor: 1, role: 'owner', store: null }),
    put('meta', wantedRow(SPACE, new Map())),
    put('entries', {
      id: ID,
      space_id: SPACE,
      kind: 'canvas',
      parent: null,
      name: 'Board.canvas',
      local_path: 'Board.canvas',
      file_key: null,
      written_hash: null,
      mtime: null,
      size: null,
      seq: 1,
      deleted: false,
    }),
    put('docs', {
      id: ID,
      epoch: 1,
      client_id: hash32('d0', ID),
      confirmed,
      confirmed_sv: Y.encodeStateVectorFromUpdateV2(confirmed),
      pending: null,
      pending_at: null,
    }),
    put('meta', numbersRow(ID, { seq: 1, pulled: 1, pending: false, flight: null })),
    put('written', { id: ID, text: writeCanvas(on) }),
  ])
  await seeding.cleanExit(true)
  const disk = new MemoryDisk()
  await disk.write(`${ROOT}/Board.canvas`, writeCanvas(on))
  const world: World = {
    disk,
    account: { ask: () => Promise.resolve(null) },
    name: 'd0',
    now: () => 1000,
    random: Math.random,
    digest: (text) => Promise.resolve(String(hash32('a', text))),
    join: (root, path) => `${root}/${path}`,
    foldsCase: true,
    platform: 'other',
  }
  return { store, engine: await Engine.start(world, store.open(), { freshens: false }) }
}

function surface(canvas: Canvas): PlaneSurface & { heard: Canvas[] } {
  const made = {
    canvas,
    shared: null,
    heard: [] as Canvas[],
    arrived(next: Canvas) {
      made.canvas = next
      made.heard.push(next)
    },
    handsAre: () => undefined,
    historyIs: () => undefined,
  }
  return made
}

const ids = (canvas: Canvas) => canvas.nodes.map((one) => one.id).sort()

describe('a canvas under v2', () => {
  test('what the plane had that the document did not goes in as this device’s, and nothing else is written', async () => {
    const { engine } = await device(plane(card('a', 'One')))
    const board = surface(plane(card('a', 'One'), card('b', 'Two', 300)))

    const join = await attachPlane(engine, ID, board, () => true)
    const doc = engine.core.docs.get(ID)

    expect(join).not.toBeNull()
    expect(board.shared).not.toBeNull()
    expect(ids(readPlane(doc?.live ?? new Y.Doc()))).toEqual(['a', 'b'])
    doc?.flush()
    expect(doc?.hasPending).toBe(true)
    join?.part()
  })

  test('a plane that says what the document says joins without an edit', async () => {
    const { engine } = await device(plane(card('a', 'One')))
    const board = surface(plane(card('a', 'One')))

    await attachPlane(engine, ID, board, () => true)
    const doc = engine.core.docs.get(ID)
    expect(doc?.flush()).toBe(false)
  })

  test('drawing goes into the document, and writes nothing until the pause', async () => {
    const { engine, store } = await device(plane(card('a', 'One')))
    const board = surface(plane(card('a', 'One')))
    await attachPlane(engine, ID, board, () => true)
    const writes = store.writes

    const before = board.canvas
    const after = plane(card('a', 'One'), card('c', 'Drawn here', 600))
    board.shared?.push(before, after)

    const doc = engine.core.docs.get(ID)
    expect(ids(readPlane(doc?.live ?? new Y.Doc()))).toEqual(['a', 'c'])
    expect(store.writes).toBe(writes)
    await engine.saved(`${ROOT}/Board.canvas`, writeCanvas(after))
    expect(store.writes).toBe(writes + 1)
  })

  test('another device’s card reaches the plane on screen', async () => {
    const { engine } = await device(plane(card('a', 'One')))
    const board = surface(plane(card('a', 'One')))
    await attachPlane(engine, ID, board, () => true)
    const live = engine.core.docs.get(ID)?.live
    if (!live) throw new Error('no document')

    const there = new Y.Doc()
    Y.applyUpdate(there, Y.encodeStateAsUpdate(live))
    pushPlane(there, readPlane(there), plane(card('a', 'One'), card('d', 'From there', 900)))
    Y.applyUpdate(live, Y.encodeStateAsUpdate(there, Y.encodeStateVector(live)), 'pulled')

    expect(ids(board.canvas)).toEqual(['a', 'd'])
  })
})
