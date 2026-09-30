import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test } from 'vitest'
import type { EditorView } from '@nib/editor'
import Editor from '../../src/lib/Editor.svelte'
import { type Tab, workspace } from '../../src/lib/workspace.svelte'
import { reactive } from './runes.svelte'

/** A note swapped into a pane's editor is a selection that moved.
 *
 *  The pane keeps one view and swaps each tab's state into it, and a state swapped in
 *  is not an update: CodeMirror calls no listener for `setState`. So whatever follows
 *  the selection - the bar over it, the count of selected words at the foot, the
 *  passage the Ask panel quotes - went on following the note that had left. Select a
 *  line and press Ctrl+W, and the bar stood over the next note's heading with nothing
 *  under it, and a press on it wrote marks into that note.
 *
 *  In the jsdom project because it mounts the pane's editor. Nothing here asks about
 *  layout. */

// jsdom has no observer for a box changing size; the pane's scrollbar asks for one.
class NoLayout {
  observe() {
    // Said above.
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
  workspace.tabs = []
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  workspace.tabs = []
})

function twoNotes(): [Tab, Tab] {
  workspace.openBlank('One', 'The first note, with words selected in it.')
  workspace.openBlank('Two', 'The second note.')
  const [one, two] = workspace.tabs
  if (!one || !two) throw new Error('two tabs were asked for')

  return [one, two]
}

test('the pane says so when another note is swapped into its editor', () => {
  const [one, two] = twoNotes()
  const heard: string[] = []
  const props = reactive({
    tab: one,
    kept: [one, two],
    onselection: (view: EditorView) => heard.push(view.state.doc.toString()),
  })

  const shown = mount(Editor, { target, props })
  close = () => void unmount(shown, { outro: false })
  flushSync()

  heard.length = 0
  props.tab = two
  flushSync()

  expect(heard.at(-1)).toBe('The second note.')
})
