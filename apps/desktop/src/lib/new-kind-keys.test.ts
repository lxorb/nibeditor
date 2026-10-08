import { describe, expect, test } from 'vitest'
import { kindOfLetter } from './new-kind-keys'

/** The letter on each card where the kinds are offered, as a key: Emil, issue #213. Where
 *  the keyboard has to be for it to count needs a document, and is
 *  test/effects/new-here.effect.test.ts. */

const KINDS = [
  { kind: 'note', letter: 'n' },
  { kind: 'canvas', letter: 'c' },
  { kind: 'terminal', letter: 'r' },
]

function press(key: string, held: Partial<KeyboardEvent> = {}) {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

describe('a letter where the kinds are offered', () => {
  test('picks the kind it is the letter of', () => {
    expect(kindOfLetter(KINDS, press('c'))?.kind).toBe('canvas')
    expect(kindOfLetter(KINDS, press('x'))).toBeNull()
  })

  /** With Shift it is the same kind, asked for its other forms. */
  test('with or without Shift', () => {
    expect(kindOfLetter(KINDS, press('R', { shiftKey: true }))?.kind).toBe('terminal')
  })

  /** A chord is on its way to the window: Ctrl+N is the scratchpad, not a note. */
  test('never under Ctrl, Alt or Cmd', () => {
    expect(kindOfLetter(KINDS, press('n', { ctrlKey: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { altKey: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { metaKey: true }))).toBeNull()
  })

  /** A key held down is the same press arriving again, and a composed letter is not
   *  finished. */
  test('nor held down, nor while an input method is composing', () => {
    expect(kindOfLetter(KINDS, press('n', { repeat: true }))).toBeNull()
    expect(kindOfLetter(KINDS, press('n', { isComposing: true }))).toBeNull()
  })

  test('nor a key that is not a letter', () => {
    expect(kindOfLetter(KINDS, press('Enter'))).toBeNull()
  })
})
