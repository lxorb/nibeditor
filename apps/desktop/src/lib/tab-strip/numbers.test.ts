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

const stroke = (key: string, more: Partial<Stroke> = {}): Stroke => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  metaKey: false,
  repeat: false,
  altGraph: false,
  ...more,
})

describe('Alt held on its own', () => {
  test('begins with Alt and carries on through its repeats', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    hold.down(stroke('Alt', { repeat: true }))
    expect(hold.holding).toBe(true)
  })

  test('a quick Alt+3 is over at the digit, before any number could show', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    hold.down(stroke('3'))
    expect(hold.holding).toBe(false)
  })

  test('AltGr is never one, however a keyboard names it', () => {
    const hold = new AltHold()
    // Windows says AltGr as Ctrl and Alt; a browser may name it apart.
    hold.down(stroke('Alt', { ctrlKey: true }))
    expect(hold.holding).toBe(false)
    hold.down(stroke('AltGraph', { ctrlKey: true, altGraph: true }))
    expect(hold.holding).toBe(false)
    hold.down(stroke('Alt', { altGraph: true }))
    expect(hold.holding).toBe(false)
  })

  test('nor is Alt with Shift, the switch between keyboards', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt', { shiftKey: true }))
    expect(hold.holding).toBe(false)

    hold.down(stroke('Alt'))
    hold.down(stroke('Shift'))
    expect(hold.holding).toBe(false)
    // Alt still down and repeating after that is not a hold again.
    hold.down(stroke('Alt', { repeat: true }))
    expect(hold.holding).toBe(false)
  })

  test('Alt+Tab ends it, whether the Tab arrives or only the window going', () => {
    const hold = new AltHold()
    hold.down(stroke('Alt'))
    hold.down(stroke('Tab'))
    expect(hold.holding).toBe(false)

    hold.down(stroke('Alt'))
    hold.broken()
    expect(hold.holding).toBe(false)
  })
})
