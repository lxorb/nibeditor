import { EditorState } from '@nib/editor'
import { describe, expect, test } from 'vitest'
import { selectedWords } from './seed'

const selecting = (doc: string, from: number, to: number) =>
  EditorState.create({ doc, selection: { anchor: from, head: to } })

describe('the words a search of the space starts from', () => {
  test('are the few selected on one line', () => {
    expect(selectedWords(selecting('the quick brown fox', 4, 15))).toBe('quick brown')
  })

  test('are nothing for a bare caret', () => {
    expect(selectedWords(selecting('the quick brown fox', 4, 4))).toBeNull()
  })

  test('are nothing for a passage over several lines, or a long one', () => {
    expect(selectedWords(selecting('one\ntwo', 0, 7))).toBeNull()
    expect(selectedWords(selecting('x'.repeat(300), 0, 300))).toBeNull()
  })
})
