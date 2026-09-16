import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EditorView } from '@nib/editor'
import CanvasNode from '../../src/lib/CanvasNode.svelte'
import { flushCardEdits } from '../../src/lib/canvas/writing'

/** What a press does while a canvas card is being written in.
 *
 *  The card's own handler runs in the capture phase, on the box the editor is
 *  mounted inside, which means it runs before anything else sees the press at all -
 *  including the editor in the card. It used to stop every press that was not
 *  Escape, and that one line took three things away at once: the editor never got
 *  Enter, so a card answered the key with the browser's own line break and put in two;
 *  it never got Ctrl+B or Ctrl+Z either; and no app shortcut worked while the caret
 *  was in a card, because the press never left it. See `onKey` in CanvasNode.svelte.
 *
 *  So this is about propagation and nothing else: a press that is not Escape reaches
 *  what is above the card, and Escape is the one the card answers itself.
 *
 *  In the jsdom project because it mounts a component and dispatches a real event. */

/** jsdom implements neither, and a mounted editor asks for both. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined

/** Every press that got past the card, as whatever is above it would see them. */
let heard: string[]
/** Whether the card asked to be left. */
let left: number
/** Every set of words the card handed to the plane. */
let given: string[]

beforeEach(() => {
  heard = []
  left = 0
  given = []
  target = document.createElement('div')
  target.addEventListener('keydown', (event) => heard.push(event.key))
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

/** One text card, open and being written in. */
function card() {
  const component = mount(CanvasNode, {
    target,
    props: {
      node: { id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 80, text: 'one' },
      canvasPath: '/space/Board.canvas',
      trusted: false,
      root: '/space',
      picked: true,
      editing: true,
      offset: { x: 0, y: 0 },
      ontext: (text: string) => {
        given.push(text)
      },
      onleave: () => {
        left += 1
      },
    },
  })
  close = () => void unmount(component, { outro: false })
  flushSync()

  const box = target.querySelector('.editor')
  if (!box) throw new Error('the card put no editor up')

  return box
}

/** A press on the editor inside the card, as a keyboard makes one. */
function press(box: Element, key: string, held: { ctrlKey?: boolean } = {}) {
  const inside = box.querySelector('.cm-content') ?? box
  inside.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }),
  )
}

test('a press that is not Escape reaches what is above the card', () => {
  const box = card()

  press(box, 'Enter')
  press(box, 'b', { ctrlKey: true })
  press(box, 'p', { ctrlKey: true })

  expect(heard).toEqual(['Enter', 'b', 'p'])
})

/** The other half of the same card. What is typed in one reaches the plane when the
 *  caret leaves, so everything that reads the plane in between reads a card that is
 *  still empty: saving on purpose wrote a blank card over the file, and a window shut
 *  mid-word wrote the plane without the word in it. See canvas/writing.ts. */
test('the words in a card can be asked for before the caret has left it', () => {
  const box = card()
  const view = EditorView.findFromDOM(box as HTMLElement)
  if (!view) throw new Error('the card put no editor up')

  view.dispatch({ changes: { from: view.state.doc.length, insert: ' and more' } })
  expect(given).toEqual([])

  flushCardEdits()
  expect(given).toEqual(['one and more'])

  // Asked twice is one edit: the flush and the teardown that follows it both say it.
  flushCardEdits()
  expect(given).toEqual(['one and more'])
})

test('and Escape is the card leaving, which goes no further', () => {
  const box = card()

  press(box, 'Escape')

  expect(left).toBe(1)
  expect(heard).toEqual([])
})
