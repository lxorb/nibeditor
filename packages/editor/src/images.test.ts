import { EditorSelection, EditorState, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { imageHandling, type ImageSink, receiveImages } from './images'

/** A picture the sink is handed. Its contents are never read. */
const PICTURE = [new File([new Uint8Array([1])], 'a.png', { type: 'image/png' })]

/** A view built out of a state and a dispatch, which is all `receiveImages`
 *  reads. No DOM: what is under test is where the markdown lands, not the
 *  pointer that started it. */
function surface(doc: string, caret: number, readOnly = false) {
  let state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [imageHandling(() => Promise.resolve(null)), EditorState.readOnly.of(readOnly)],
  })

  const dispatch = (spec: TransactionSpec) => {
    state = state.update(spec).state
  }

  return {
    get doc() {
      return state.doc.toString()
    },
    dispatch,
    view: {
      get state() {
        return state
      },
      dispatch,
    } as unknown as EditorView,
  }
}

/** A sink that hands nothing back until the test says so, which is the gap a
 *  real one leaves while it writes the file into the note's folder. */
function heldSink(): { sink: ImageSink; settle: (path: string) => void } {
  let settle: (path: string) => void = () => undefined
  const sink: ImageSink = () => new Promise((resolve) => (settle = resolve))
  return { sink, settle: (path) => settle(path) }
}

/** Two turns of the microtask queue, which is what the sink's promise and the
 *  loop awaiting it need to finish. */
const settled = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('a dropped picture', () => {
  test('lands where it was dropped', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('one ![](assets/a.png)two three\n')
  })

  test('lands where the drop point ended up after an edit above it', async () => {
    // Writing the file is a round trip to the host, and the reader keeps typing
    // through it. An offset taken at the drop is an offset into a document that
    // has moved on, so it is handed to the editor and mapped like any other.
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    editor.dispatch({ changes: { from: 0, insert: 'PREFIX ' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('PREFIX one ![](assets/a.png)two three\n')
  })

  test('lands inside what is left when the note shrank under it', async () => {
    // An undo or a restored version can take the drop point away entirely. The
    // remembered offset was then out of range, and the insertion threw.
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0)

    const writing = receiveImages(editor.view, PICTURE, sink, 12)
    editor.dispatch({ changes: { from: 0, to: 14, insert: 'x' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('x![](assets/a.png)')
  })

  test('a paste goes to the selection, wherever it has got to', async () => {
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 4)

    const writing = receiveImages(editor.view, PICTURE, sink, null)
    editor.dispatch({ changes: { from: 0, insert: 'PREFIX ' } })
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('PREFIX one ![](assets/a.png)two three\n')
  })

  test('is not written at all once the note refuses changes', async () => {
    // Reading mode would drop the insertion and let the selection through, and
    // the selection was computed against a document that never took the text.
    const { sink, settle } = heldSink()
    const editor = surface('one two three\n', 0, true)

    const writing = receiveImages(editor.view, PICTURE, sink, 4)
    settle('assets/a.png')
    await writing
    await settled()

    expect(editor.doc).toBe('one two three\n')
  })

  test('writes nothing when the host stored nothing', async () => {
    const editor = surface('one\n', 0)
    await receiveImages(editor.view, PICTURE, () => Promise.resolve(null), 2)
    expect(editor.doc).toBe('one\n')
  })

  test('ignores files the note cannot show', async () => {
    const editor = surface('one\n', 0)
    const other = [
      new File([new Uint8Array([1])], 'a.txt', { type: 'text/plain' }),
      new File([new Uint8Array([1])], 'a.zip', { type: 'application/zip' }),
    ]
    await receiveImages(editor.view, other, () => Promise.resolve('assets/a.png'), 2)
    expect(editor.doc).toBe('one\n')
  })
})

describe('a dropped file that is not a picture', () => {
  const file = (name: string, type: string) => new File([new Uint8Array([1])], name, { type })

  test('is embedded by its name, the way Obsidian writes a dropped file', async () => {
    const editor = surface('one two\n', 0)
    const dropped = [
      file('paper one.pdf', 'application/pdf'),
      file('talk.mp3', 'audio/mpeg'),
      file('demo.mp4', 'video/mp4'),
    ]

    await receiveImages(editor.view, dropped, (one) => Promise.resolve(`assets/${one.name}`), 4)

    expect(editor.doc).toBe('one ![[paper one.pdf]]\n![[talk.mp3]]\n![[demo.mp4]]two\n')
  })

  test('sits beside the pictures dropped with it, in the order they came', async () => {
    const editor = surface('', 0)
    const dropped = [file('a.png', 'image/png'), file('b.pdf', '')]

    await receiveImages(editor.view, dropped, (one) => Promise.resolve(`../assets/${one.name}`), 0)

    expect(editor.doc).toBe('![](../assets/a.png)\n![[b.pdf]]')
  })
})
