import { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { expect, test } from 'vitest'
import { completing } from './completing'

/** Ctrl+Space is the space switcher (Emil, 2026-10-04). The library's own popup key
 *  spent it in every note, so the window never heard it; the popup's other keys stay. */
test('the popup leaves Ctrl+Space to the app and keeps its own keys', () => {
  for (const pairs of [false, true]) {
    const bound = EditorState.create({ extensions: completing(pairs) })
      .facet(keymap)
      .flat()

    expect(bound.some((binding) => binding.key === 'Ctrl-Space')).toBe(false)
    for (const key of ['Escape', 'ArrowDown', 'ArrowUp', 'Enter']) {
      expect(
        bound.some((binding) => binding.key === key),
        key,
      ).toBe(true)
    }
  }
})
