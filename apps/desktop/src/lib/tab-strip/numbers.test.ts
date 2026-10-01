import { describe, expect, test } from 'vitest'
import { AltHold, numerals, type Stroke } from './numbers'

/** The keys as they ship on Windows: Alt and a digit for the first nine places, and
 *  Alt+0 for the last. */
const SHIPPED: Record<string, string> = {
  ...Object.fromEntries(
    Array.from({ length: 8 }, (_, at) => [`app.note-${at + 1}.alt`, `Alt-${at + 1}`]),
  ),
  'app.note-ninth': 'Alt-9',
  'app.note-9.alt': 'Alt-0',
}

const shipped = (id: string) => SHIPPED[id] ?? null

describe('the numbers on the tabs', () => {
  test('are the places, and the last tab wears 0', () => {
    expect(numerals(4, shipped, 'win')).toEqual(['1', '2', '3', '0'])
  })

  test('a lone tab is the last one', () => {
    expect(numerals(1, shipped, 'win')).toEqual(['0'])
  })

  test('past nine, the ninth wears 9 and the ones after it nothing but the last', () => {
    expect(numerals(12, shipped, 'win')).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      null,
      null,
      '0',
    ])
  })

  test('with exactly nine, the ninth is the last and wears 0', () => {
    expect(numerals(9, shipped, 'win').at(-1)).toBe('0')
  })

  test('follow the keys as they are bound now', () => {
    const rebound = (id: string) =>
      id === 'app.note-2.alt' ? 'Alt-x' : id === 'app.note-3.alt' ? 'Mod-Alt-3' : shipped(id)
    // A key under Alt alone is its character; one held with more than Alt says nothing.
    expect(numerals(4, rebound, 'win')).toEqual(['1', 'X', null, '0'])
  })

  test('and say nothing where no key is held under Alt, as on a Mac', () => {
    expect(numerals(3, () => null, 'mac')).toEqual([null, null, null])
  })
})

/** A key pressed with Alt down, as a browser says it: Alt itself has `altKey` too. */
const stroke = (key: string, more: Partial<Stroke> = {}): Stroke => ({
  key,
  code: /^\d$/.test(key) ? `Digit${key}` : key,
  altKey: true,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  altGraph: false,
  ...more,
})

describe('Alt held', () => {
  test('shows the numbers the moment it goes down, and carries on through its repeats', () => {
    const hold = new AltHold()
    expect(hold.down(stroke('Alt'))).toBe(true)
    expect(hold.down(stroke('Alt', { repeat: true }))).toBe(false)
    expect(hold.holding).toBe(true)
  })

  /** A held key repeats, and a repeat an engine does not flag as one is the same hold:
   *  it must not begin it again. */
  test('a repeat not flagged as one is the same hold, not a new one', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    expect(hold.down(stroke('Alt'))).toBe(false)
    expect(hold.holding).toBe(true)
  })

  /** Emil, 2026-10-01: *"It should always display, even if I press and hold Alt and then
   *  press a number. The only condition should be Alt held."* */
  test('keeps them through Alt and a digit, and puts them where the new tab is', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    for (const digit of ['3', '1', '0']) {
      expect(hold.down(stroke(digit)), digit).toBe(true)
      expect(hold.holding, digit).toBe(true)
    }
    // A digit held down repeats, and is still the hold.
    expect(hold.down(stroke('2', { repeat: true }))).toBe(true)
    expect(hold.holding).toBe(true)
  })

  test('a digit with Alt shows them even where the Alt itself was not heard', () => {
    const hold = new AltHold()
    expect(hold.down(stroke('4'))).toBe(true)
    expect(hold.holding).toBe(true)
  })

  test('a digit is known by its place on a keyboard whose top row types something else', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    // AZERTY's 1.
    expect(hold.down(stroke('&', { code: 'Digit1' }))).toBe(true)
    expect(hold.holding).toBe(true)
    // The number pad's digits type a character by its code with Alt on Windows.
    hold.down(stroke('1', { code: 'Numpad1' }))
    expect(hold.holding).toBe(false)
  })

  test('Alt+F4, Alt+Tab and Alt and an arrow end it, and a repeat of Alt does not bring it back', () => {
    for (const key of ['F4', 'Tab', 'ArrowLeft', 'd']) {
      const hold = new AltHold()
      hold.down(stroke('Alt'))
      hold.down(stroke('2'))
      expect(hold.down(stroke(key)), key).toBe(false)
      expect(hold.holding, key).toBe(false)
      // Still down, and repeating unflagged: the chord used it.
      expect(hold.down(stroke('Alt')), key).toBe(false)
      expect(hold.holding, key).toBe(false)

      // Let go of, the next Alt is a hold again.
      hold.released()
      expect(hold.down(stroke('Alt')), key).toBe(true)
    }
  })

  test('AltGr never shows them, however a keyboard names it, nor with a digit', () => {
    const hold = new AltHold()
    // Windows says AltGr as Ctrl and Alt; a browser may name it apart.
    hold.down(stroke('Control', { ctrlKey: true, altKey: false }))
    expect(hold.down(stroke('Alt', { ctrlKey: true }))).toBe(false)
    expect(hold.holding).toBe(false)
    // AltGr and 2 is a Swiss `@`.
    expect(hold.down(stroke('@', { code: 'Digit2', ctrlKey: true }))).toBe(false)
    expect(hold.holding).toBe(false)
    hold.released()

    expect(hold.down(stroke('AltGraph', { ctrlKey: true, altGraph: true }))).toBe(false)
    expect(hold.down(stroke('Alt', { altGraph: true }))).toBe(false)
    expect(hold.down(stroke('7', { altGraph: true }))).toBe(false)
    expect(hold.holding).toBe(false)
  })

  test('nor is Alt with Shift, the switch between keyboards, either way round', () => {
    const hold = new AltHold()
    hold.down(stroke('Shift', { shiftKey: true, altKey: false }))
    hold.down(stroke('Alt', { shiftKey: true }))
    expect(hold.holding).toBe(false)
    hold.released()

    hold.down(stroke('Alt'))
    hold.down(stroke('Shift', { shiftKey: true }))
    expect(hold.holding).toBe(false)
    hold.down(stroke('Alt', { repeat: true }))
    expect(hold.holding).toBe(false)
  })

  test('a press of the pointer or the wheel ends it until Alt is let go of', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    hold.used()
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('Alt'))).toBe(false)
  })

  test('keys typed without Alt never begin one', () => {
    const hold = new AltHold()
    for (const key of ['a', '3', 'Enter']) hold.down(stroke(key, { altKey: false }))
    expect(hold.holding).toBe(false)
    expect(hold.down(stroke('Alt'))).toBe(true)
  })
})
