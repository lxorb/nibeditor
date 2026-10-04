import { describe, expect, test } from 'vitest'
import { accelerator } from './accelerator'

/** The registry writes `Ctrl-Alt-Space`; the system's plugin reads `Control+Alt+Space`. */
describe('a key handed to the system', () => {
  test.each([
    ['Ctrl-Alt-Space', 'Control+Alt+Space'],
    ['Mod-Shift-a', 'CommandOrControl+Shift+A'],
    ['Alt-Meta-q', 'Alt+Super+Q'],
    ['Ctrl-Alt--', 'Control+Alt+-'],
    ['F9', 'F9'],
  ])('%s', (key, said) => {
    expect(accelerator(key)).toBe(said)
  })

  test('is none for no key, and for a tap twice, which no system holds', () => {
    expect(accelerator(null)).toBeNull()
    expect(accelerator('Shift Shift')).toBeNull()
  })
})
