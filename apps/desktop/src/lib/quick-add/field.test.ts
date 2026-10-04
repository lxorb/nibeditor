import { describe, expect, test } from 'vitest'
import { carried, piecesOf, without } from './field'

/** The field's bookkeeping: the line cut into words and chips, the spans pressed back
 *  into words following an edit, and a chip taken out when a control picks its field. */

describe('the line as runs', () => {
  test('words and chips, in order, each where it was typed', () => {
    const text = 'Call mum tomorrow p1'
    expect(
      piecesOf(text, [
        { kind: 'priority', from: 18, to: 20 },
        { kind: 'when', from: 9, to: 17 },
      ]),
    ).toEqual([
      { text: 'Call mum ', from: 0 },
      { text: 'tomorrow', chip: 'when', from: 9 },
      { text: ' ', from: 17 },
      { text: 'p1', chip: 'priority', from: 18 },
    ])
  })
})

describe('a span turned back into words', () => {
  const span = { from: 9, to: 17 }

  test('moves with the words when something is typed before it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Now call mum tomorrow')).toEqual([
      { from: 13, to: 21 },
    ])
  })

  test('stays when something is typed after it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorrow p1')).toEqual([span])
  })

  test('goes when the edit reaches into it', () => {
    expect(carried([span], 'Call mum tomorrow', 'Call mum tomorow')).toEqual([])
  })
})

describe('a chip taken out', () => {
  test('closes the gap it leaves', () => {
    expect(without('Call mum tomorrow at noon', { from: 9, to: 17 })).toBe('Call mum at noon')
    expect(without('tomorrow call mum', { from: 0, to: 8 })).toBe('call mum')
  })
})
