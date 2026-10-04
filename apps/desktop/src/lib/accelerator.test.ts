import { describe, expect, test } from 'vitest'
import { accelerator } from './accelerator'

describe('a key from any app, handed to the system', () => {
  test('is the registry key resolved for the platform', () => {
    expect(accelerator('Mod-Alt-Shift-k', 'win')).toBe('Control+Alt+Shift+K')
    expect(accelerator('Mod-Ctrl-Alt-k', 'mac')).toBe('Control+Super+Alt+K')
    expect(accelerator('Mod-Alt-1', 'linux')).toBe('Control+Alt+Digit1')
    expect(accelerator('Mod-Alt-F4', 'win')).toBe('Control+Alt+F4')
  })

  test("quick add's keys", () => {
    expect(accelerator('Ctrl-Alt-Space', 'win')).toBe('Control+Alt+Space')
    expect(accelerator('Mod-Shift-a', 'win')).toBe('Control+Shift+A')
    expect(accelerator('Alt-Meta-q', 'linux')).toBe('Super+Alt+Q')
    expect(accelerator('Ctrl-Alt--', 'win')).toBe('Control+Alt+Minus')
    expect(accelerator('F9', 'win')).toBe('F9')
  })

  test('is refused where it would take a key from every app', () => {
    expect(accelerator('Shift-k', 'win')).toBeNull()
    expect(accelerator('k', 'win')).toBeNull()
    expect(accelerator('', 'win')).toBeNull()
    expect(accelerator(null, 'win')).toBeNull()
    expect(accelerator('Shift Shift', 'win')).toBeNull()
  })
})
