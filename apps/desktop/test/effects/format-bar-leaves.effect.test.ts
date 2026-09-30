import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EditorState, type EditorView } from '@nib/editor'
import FormatBar from '../../src/lib/FormatBar.svelte'
import { reactive } from './runes.svelte'

/** The bar over a selection leaves with the editor it stood over.
 *
 *  It is told where to stand by the selection moving, and an editor that has been
 *  taken apart never moves again: close the last tab in a pane with a line selected
 *  and the pane's editor goes, the window's editor is none, and the bar used to stay
 *  where it was over a pane that shows the new-tab buttons. Whatever it pressed then
 *  wrote into nothing.
 *
 *  In the jsdom project because it mounts a component. */

class NoLayout {
  observe() {
    // jsdom does no layout, so the bar's height is never measured here.
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
let close: (() => void) | undefined

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

/** An editor with its first word selected and the keyboard in it, as much of one as
 *  the bar reads to place itself. */
function selected(): EditorView {
  const note = document.createElement('div')
  return {
    state: EditorState.create({ doc: 'Kestrels hover.', selection: { anchor: 0, head: 8 } }),
    hasFocus: true,
    contentDOM: note,
    coordsAtPos: () => ({ left: 200, right: 260, top: 120, bottom: 140 }),
  } as unknown as EditorView
}

const standing = () => target.querySelector('.nib-bar-at') !== null

test('stands over a selection, and goes when the editor under it does', () => {
  const view = selected()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  const bar = mount(FormatBar, { target, props }) as { follow: (current: EditorView) => void }
  close = () => void unmount(bar, { outro: false })
  flushSync()

  bar.follow(view)
  flushSync()
  expect(standing()).toBe(true)

  props.view = undefined
  flushSync()
  expect(standing()).toBe(false)
})

test('and when the window moves on to another pane', () => {
  const view = selected()
  const props = reactive<{ view: EditorView | undefined }>({ view })
  const bar = mount(FormatBar, { target, props }) as { follow: (current: EditorView) => void }
  close = () => void unmount(bar, { outro: false })
  flushSync()

  bar.follow(view)
  flushSync()

  props.view = selected()
  flushSync()
  expect(standing()).toBe(false)
})
