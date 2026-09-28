import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, test } from 'vitest'
import { refuseControlCharacters, unprintable } from './control'

/** Whether any input handler claims the typing, which is what keeps it out. */
function refused(typed: string): boolean {
  const state = EditorState.create({ extensions: [refuseControlCharacters()] })
  const view = { state } as unknown as EditorView
  return state
    .facet(EditorView.inputHandler)
    .some((handler) => handler(view, 0, 0, typed, () => state.update({})))
}

describe('a control character typed', () => {
  test('is not text: Ctrl+Q, Ctrl+R and Ctrl+^ on a Mac type nothing', () => {
    expect(refused('\u0011')).toBe(true)
    expect(refused('\u0012')).toBe(true)
    expect(refused('\u001e')).toBe(true)
    expect(refused('\u007f')).toBe(true)
  })

  test('but tab and the line breaks are', () => {
    expect(refused('\t')).toBe(false)
    expect(refused('\n')).toBe(false)
    expect(refused('\r\n')).toBe(false)
  })

  test('and so is anything with a printable character in it', () => {
    expect(refused('a')).toBe(false)
    expect(refused('´')).toBe(false)
    expect(refused('\u0011a')).toBe(false)
    expect(refused(' ')).toBe(false)
  })

  test('and nothing at all is not typing', () => {
    expect(unprintable('')).toBe(false)
  })
})
