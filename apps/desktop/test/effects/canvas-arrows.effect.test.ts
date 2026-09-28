/** The bar's two arrows, following a plane that is in no room.
 *
 *  What src/lib/canvas/store.test.ts cannot ask: that test reads `canUndo` by hand
 *  and gets the right answer every time, because a getter answers whatever it is
 *  asked. The bar does not ask. It is handed `canundo={store.canUndo}` and redraws
 *  when something it read has changed, and the snapshot stack is plain arrays, so an
 *  edit changed nothing the bar could see: the Undo arrow stayed dark over a plane
 *  with a card on it while Ctrl+Z took the card away. In a room the arrows were
 *  always right, because what the room says is held as state; see `historyIs`.
 *
 *  So the bar is mounted here the way Canvas.svelte and Pages.svelte mount it, with
 *  its two props read through the store as the page reads them, and the store is
 *  driven the way a gesture drives it.
 *
 *  In the jsdom project because it mounts a component. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import CanvasBar from '../../src/lib/CanvasBar.svelte'
import { blankCanvas, type CanvasNode } from '../../src/lib/canvas/format'
import { CanvasStore } from '../../src/lib/canvas/store.svelte'
import { NoteDoc, Tab } from '../../src/lib/workspace/documents.svelte'

function card(id: string): CanvasNode {
  return { id, type: 'text', x: 0, y: 0, width: 250, height: 60, text: id }
}

let host: HTMLElement
let shown: ReturnType<typeof mount>
let store: CanvasStore
let note: NoteDoc

beforeEach(() => {
  note = new NoteDoc(
    {
      kind: 'canvas',
      path: '/space/Board.canvas',
      name: 'Board.canvas',
      text: blankCanvas(),
      dirty: false,
    },
    () => undefined,
    () => true,
  )
  store = new CanvasStore(new Tab(note, 'pane'))

  host = document.createElement('div')
  document.body.append(host)
  const held = store
  shown = mount(CanvasBar, {
    target: host,
    // Getters, which is what a parent's `canundo={store.canUndo}` compiles to: the
    // bar reads through them, so whatever the store reads is what it follows.
    props: {
      get canundo() {
        return held.canUndo
      },
      get canredo() {
        return held.canRedo
      },
      zoom: 1,
      onundo: () => held.undo(),
      onredo: () => held.redo(),
      onerase: () => undefined,
      onzoom: () => undefined,
      onfit: () => undefined,
    },
  })
  flushSync()
})

afterEach(() => {
  void unmount(shown)
  host.remove()
})

/** Whether the arrow with this name can be pressed. */
function lit(name: 'Undo' | 'Redo'): boolean {
  const button = host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
  if (!button) throw new Error(`no ${name} on the bar`)
  return !button.disabled
}

test('a plane nobody has drawn on has nothing to take back', () => {
  expect(lit('Undo')).toBe(false)
  expect(lit('Redo')).toBe(false)
})

test('an edit lights Undo', () => {
  store.edit({ ...store.canvas, nodes: [card('a')] })
  flushSync()

  expect(lit('Undo')).toBe(true)
  expect(lit('Redo')).toBe(false)
})

test('taking it back lights Redo and puts Undo out, and putting it forward turns them round', () => {
  store.edit({ ...store.canvas, nodes: [card('a')] })
  flushSync()

  store.undo()
  flushSync()
  expect(lit('Undo')).toBe(false)
  expect(lit('Redo')).toBe(true)

  store.redo()
  flushSync()
  expect(lit('Undo')).toBe(true)
  expect(lit('Redo')).toBe(false)
})

test('a new edit after an undo puts Redo out', () => {
  store.edit({ ...store.canvas, nodes: [card('a')] })
  store.undo()
  flushSync()
  expect(lit('Redo')).toBe(true)

  store.edit({ ...store.canvas, nodes: [card('b')] })
  flushSync()
  expect(lit('Undo')).toBe(true)
  expect(lit('Redo')).toBe(false)
})

test('words that changed under the plane put both out', () => {
  store.edit({ ...store.canvas, nodes: [card('a')] })
  store.edit({ ...store.canvas, nodes: [card('a'), card('b')] })
  store.undo()
  flushSync()
  expect(lit('Undo')).toBe(true)
  expect(lit('Redo')).toBe(true)

  // A version restored, or a copy a sync brought over: what can be taken back is
  // forgotten. See `follow`.
  note.replace(blankCanvas())
  store.follow()
  flushSync()
  expect(lit('Undo')).toBe(false)
  expect(lit('Redo')).toBe(false)
})
