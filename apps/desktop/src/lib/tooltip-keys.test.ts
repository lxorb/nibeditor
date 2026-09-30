import { afterEach, describe, expect, test, vi } from 'vitest'

/** What a button's tooltip says: `shortcuts.tooltip`, the name and the key held now. */

/** A Windows machine, with nothing chosen yet: the store asks the browser both. */
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
})
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

const { shortcuts } = await import('./shortcuts.svelte')
const tooltip = (label: string, id: string | null = null) => shortcuts.tooltip(label, id)
const { viewport } = await import('./viewport.svelte')

afterEach(() => {
  shortcuts.resetAll()
})

describe('a tooltip', () => {
  test('is the name and the key, in brackets after it', () => {
    expect(tooltip('Back', 'app.back')).toBe('Back (Alt+←)')
    expect(tooltip('Settings', 'app.settings')).toBe('Settings (Ctrl+,)')
  })

  test('is the name alone where nothing holds a key', () => {
    expect(tooltip('Downloads')).toBe('Downloads')
    // Pin has no key out of the box.
    expect(tooltip('Pin', 'app.pin')).toBe('Pin')
  })

  test('says the key the reader chose, the moment it is chosen', () => {
    shortcuts.set('app.back', 'Mod-Shift-b')
    expect(tooltip('Back', 'app.back')).toBe('Back (Ctrl+Shift+B)')

    shortcuts.set('app.back', null)
    expect(tooltip('Back', 'app.back')).toBe('Back')
  })

  test('is the name alone on a touch screen, where a key means nothing', () => {
    const was = viewport.device
    viewport.device = 'phone'
    try {
      expect(tooltip('Back', 'app.back')).toBe('Back')
    } finally {
      viewport.device = was
    }
  })
})
