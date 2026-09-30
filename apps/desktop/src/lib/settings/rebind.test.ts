import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Choosing a key for a shortcut: what one keystroke does to the row that is
 *  listening. The registry underneath is the real one, so what counts as a
 *  refusal or a clash is what the app itself thinks. */

function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

let Rebind: typeof import('./rebind.svelte').Rebind
let shortcuts: typeof import('../shortcuts.svelte').shortcuts
let rebind: InstanceType<typeof Rebind>

/** The registry reaches most of the app: loaded here rather than by whichever
 *  `beforeEach` runs first, which was ten seconds of it against a hook's budget
 *  of thirty. See docs/conventions.md. */
await Promise.all([import('./rebind.svelte'), import('../shortcuts.svelte')])

/** A keystroke, as the window would hand one over. */
function press(key: string, held: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) {
  return {
    key,
    ctrlKey: !!held.ctrl,
    metaKey: false,
    altKey: !!held.alt,
    shiftKey: !!held.shift,
  } as KeyboardEvent
}

beforeEach(async () => {
  localStorage.clear()
  vi.resetModules()
  ;({ Rebind } = await import('./rebind.svelte'))
  ;({ shortcuts } = await import('../shortcuts.svelte'))
  shortcuts.restore()
  rebind = new Rebind()
})

describe('a row that is listening', () => {
  test('takes the next keystroke as its key', () => {
    rebind.listen('format.bold')
    rebind.record(press('j', { ctrl: true, alt: true }))

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-Alt-j')
    expect(rebind.listening).toBeNull()
  })

  test('keeps waiting while only modifiers are down', () => {
    rebind.listen('format.bold')
    rebind.record(press('Control', { ctrl: true }))

    expect(rebind.listening).toBe('format.bold')
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
  })

  test('stops listening on Escape, leaving the key as it was', () => {
    rebind.listen('format.bold')
    rebind.record(press('Escape'))

    expect(rebind.listening).toBeNull()
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
  })

  test('takes the key away on Backspace', () => {
    rebind.listen('format.bold')
    rebind.record(press('Backspace'))

    expect(shortcuts.keyFor('format.bold')).toBeNull()
  })

  test('is stopped by asking for it again', () => {
    rebind.listen('format.bold')
    rebind.listen('format.bold')
    expect(rebind.listening).toBeNull()
  })

  test('moves to another row rather than listening for two', () => {
    rebind.listen('format.bold')
    rebind.listen('format.italic')
    expect(rebind.listening).toBe('format.italic')
  })
})

describe('a key that cannot be taken', () => {
  test('is turned down with a reason, and nothing is written', () => {
    rebind.listen('format.bold')
    // A bare letter would fire while typing.
    rebind.record(press('j'))

    expect(rebind.turnedDown).toMatchObject({ id: 'format.bold' })
    expect(rebind.turnedDown?.reason).toBeTruthy()
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(rebind.listening).toBeNull()
  })
})

describe('a key something else already answers to', () => {
  test('is held back until it is answered', () => {
    rebind.listen('format.bold')
    // Ctrl+O is Open file.
    rebind.record(press('o', { ctrl: true }))

    expect(rebind.clash?.key).toBe('Mod-o')
    expect(rebind.clash?.holders.map((one) => one.id)).toContain('app.open')
    // Nothing written while the question stands.
    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.open')).toBe('Mod-o')
  })

  test('taking it over leaves the one that held it with none', () => {
    rebind.listen('format.bold')
    rebind.record(press('o', { ctrl: true }))
    rebind.takeOver()

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-o')
    expect(shortcuts.keyFor('app.open')).toBeNull()
    expect(rebind.clash).toBeNull()
  })

  test('leaving it alone changes nothing at all', () => {
    rebind.listen('format.bold')
    rebind.record(press('o', { ctrl: true }))
    rebind.clash = null

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(shortcuts.keyFor('app.open')).toBe('Mod-o')
  })
})

describe('closing the pane', () => {
  test('leaves nothing listening and no question standing', () => {
    rebind.listen('format.bold')
    rebind.record(press('o', { ctrl: true }))

    rebind.forget()

    expect(rebind.listening).toBeNull()
    expect(rebind.clash).toBeNull()
    expect(rebind.turnedDown).toBeNull()
  })
})

describe('a modifier tapped twice', () => {
  test('is the key of a row the window runs', () => {
    rebind.listen('app.graph')
    rebind.tapped('Alt')

    expect(shortcuts.keyFor('app.graph')).toBe('Alt Alt')
    expect(rebind.listening).toBeNull()
  })

  test('clashes with the palette, which Shift twice already opens', () => {
    rebind.listen('app.graph')
    rebind.tapped('Shift')

    expect(rebind.clash?.holders.map((one) => one.id)).toEqual(['app.palette'])
  })

  test('is not a key for the editor, which has no such thing, so the row goes on waiting', () => {
    rebind.listen('format.bold')
    rebind.tapped('Shift')

    expect(shortcuts.keyFor('format.bold')).toBe('Mod-b')
    expect(rebind.listening).toBe('format.bold')
  })
})
