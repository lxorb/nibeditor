import { describe, expect, test } from 'vitest'
import { isNumber, read, typedBy, typedOn } from './space-pick'

const FEW = ['VIS', 'Journal', 'ETH', 'Home']
const MANY = Array.from({ length: 12 }, (_, at) => `Space ${String(at + 1)}`)

describe('a number', () => {
  test('goes at once when only one space can be meant', () => {
    expect(read('3', FEW)).toEqual({ shown: [2], best: 2, go: 2, waits: false })
    expect(read('1', FEW).go).toBe(0)
  })

  test('with ten or more, waits where a second digit could still make it longer', () => {
    const one = read('1', MANY)
    expect(one.go).toBe(null)
    expect(one.waits).toBe(true)
    expect(one.best).toBe(0)
    // Space 1, 10, 11 and 12, in the list's order.
    expect(one.shown).toEqual([0, 9, 10, 11])

    expect(read('12', MANY)).toEqual({ shown: [11], best: 11, go: 11, waits: false })
    expect(read('2', MANY).go).toBe(1)
  })

  test('a digit no number starts with is refused', () => {
    expect(typedOn('', '0', FEW)).toBe(null)
    expect(typedOn('', '5', FEW)).toBe(null)
    expect(typedOn('1', '3', MANY)).toBe(null)
    expect(typedOn('1', '2', MANY)).toBe('12')
  })

  test('a letter after a number is refused, a space too', () => {
    expect(typedOn('1', 'a', MANY)).toBe(null)
    expect(typedOn('1', ' ', MANY)).toBe(null)
  })
})

describe('a name', () => {
  test('shows the spaces whose name holds the letters, and stands on the best', () => {
    const reading = read('jo', FEW)
    expect(reading.shown).toEqual([1])
    expect(reading.best).toBe(1)
    // Never without Enter, however few are left: a name that went by itself would
    // take the next keystroke with it.
    expect(reading.go).toBe(null)
    expect(reading.waits).toBe(false)
  })

  test('letters need not touch, case and accents aside', () => {
    expect(read('hm', FEW).shown).toEqual([3])
    expect(read('é', ['Été', 'Winter']).shown).toEqual([0])
    expect(read('VIS', ['vis', 'Visual']).best).toBe(0)
  })

  test('the best match is the one the keyboard stands on, the first of a tie', () => {
    expect(read('e', ['Home', 'ETH']).best).toBe(1)
    expect(read('x', ['Box', 'Fox']).best).toBe(0)
  })

  test('a letter no name holds is refused; digits after a letter belong to the name', () => {
    expect(typedOn('', 'z', FEW)).toBe(null)
    expect(typedOn('', 'e', FEW)).toBe('e')
    expect(typedOn('Space ', '1', MANY)).toBe('Space 1')
    expect(read('Space 1', MANY).go).toBe(null)
  })

  test('a space starts nothing, and inside a name is a letter like any other', () => {
    expect(typedOn('', ' ', FEW)).toBe(null)
    expect(typedOn('Space', ' ', MANY)).toBe('Space ')
  })
})

describe('what a key types', () => {
  test('a digit by its key, and by its place on the top row while a number is typed', () => {
    expect(typedBy('3', 'Digit3', '')).toBe('3')
    // A French keyboard's top row without Shift.
    expect(typedBy('&', 'Digit1', '')).toBe('1')
    expect(typedBy('é', 'Digit2', '1')).toBe('2')
    // Inside a name the key is what it types.
    expect(typedBy('é', 'Digit2', 'Caf')).toBe('é')
    expect(typedBy('7', 'Numpad7', '')).toBe('7')
  })

  test('a named key types nothing', () => {
    expect(typedBy('Enter', 'Enter', '')).toBe(null)
    expect(typedBy('ArrowDown', 'ArrowDown', 'a')).toBe(null)
    expect(typedBy('End', 'Numpad1', '')).toBe(null)
  })

  test('a number is what starts with a digit', () => {
    expect(isNumber('12')).toBe(true)
    expect(isNumber('a1')).toBe(false)
    expect(isNumber('')).toBe(false)
  })
})

test('nothing typed shows every space and goes nowhere', () => {
  expect(read('', FEW)).toEqual({ shown: [0, 1, 2, 3], best: -1, go: null, waits: false })
})
