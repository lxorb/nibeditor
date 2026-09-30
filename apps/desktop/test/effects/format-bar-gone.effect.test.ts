import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EditorState, type EditorView } from '@nib/editor'
import FormatBar from '../../src/lib/FormatBar.svelte'
import { reactive } from './runes.svelte'

/** The callout over a selection goes with the editor it was over.
 *
 *  A tab turned into its reading view takes its editor down, and an editor taken
 *  down reports no last selection - so the bar, which only ever heard from the
 *  editor, stayed where it was over the rendered page (batches #93, 2026-09-12). The
 *  pane forgets the view as it goes, which is what the bar is given, and a bar with
 *  no view has nothing to format.
 *
 *  In the jsdom project because it mounts a component. */

class NoLayout {
  observe() {
    // jsdom does no layout; the bar's size is never asked for here.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver = NoLayout

let target: HTMLElement
let shown: (ReturnType<typeof mount> & { follow(view: EditorView): void }) | undefined

/** An editor with words selected and the keyboard, as much of one as the bar reads. */
function writing(): EditorView {
  const note = document.createElement('div')
  document.body.append(note)

  const state = EditorState.create({
    doc: 'Words to format',
    selection: { anchor: 0, head: 5 },
  })

  // The fields the bar reads to place itself, which is all an editor is to it.
  return {
    contentDOM: note,
    hasFocus: true,
    state,
    coordsAtPos: () => ({ left: 200, right: 240, top: 100, bottom: 120 }),
  } as unknown as EditorView
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(async () => {
  if (shown) await unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})

const callout = () => target.querySelector('.nib-bar-at') !== null

test('stands over a selection, and goes when the editor under it does', () => {
  const view = writing()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  shown = mount(FormatBar, { target, props }) as typeof shown
  flushSync()

  shown?.follow(view)
  flushSync()
  expect(callout()).toBe(true)

  // The tab turned into its reading view: the pane forgets its editor.
  props.view = undefined
  flushSync()
  expect(callout()).toBe(false)
})

// And one the window's keyboard has left: the last tab of a pane closed with a line
// selected puts the keyboard in the pane beside it, whose editor is another one. The
// editor that went reports nothing on its way, so the bar has to see it is not the one
// the window holds now.
test('and when the window holds another editor than the one it stood over', () => {
  const view = writing()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  shown = mount(FormatBar, { target, props }) as typeof shown
  flushSync()

  shown?.follow(view)
  flushSync()

  props.view = writing()
  flushSync()
  expect(callout()).toBe(false)
})
