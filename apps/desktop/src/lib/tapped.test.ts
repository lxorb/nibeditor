import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Modifier } from './double-tap'

/** The registry writes to the browser's storage and asks what machine this is, and
 *  there is neither under node. */
function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded at module scope: the registry reaches most of the app. See
 *  docs/conventions.md. */
const { hear, hearTaps, heard, listenForTaps, runTap } = await import('./tapped')
const { shortcuts } = await import('./shortcuts.svelte')
const { runEntry } = await import('./shortcuts/registry')

beforeEach(() => {
  localStorage.clear()
  shortcuts.restore()
})

/** A window that keeps its listeners where a test can call them. */
function fakeWindow() {
  const listeners = new Map<string, ((event: object) => void)[]>()

  const target = {
    addEventListener: (type: string, listener: (event: object) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener])
    },
    removeEventListener: (type: string, listener: (event: object) => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((one) => one !== listener),
      )
    },
  }

  const fire = (type: string, event: object = {}) => {
    for (const listener of listeners.get(type) ?? []) listener({ target, ...event })
  }

  // A stand-in for the window, which is the one thing a test cannot make.
  return { window: target as unknown as Window, fire, target, listeners }
}

describe('who hears a double tap', () => {
  test('is whoever listened last, and then whoever was listening before', () => {
    const got: string[] = []
    const stopApp = hearTaps((key) => got.push(`app ${key}`))
    const stopPane = hearTaps((key) => got.push(`pane ${key}`))

    heard('Shift')
    stopPane()
    heard('Shift')
    stopApp()
    heard('Shift')

    expect(got).toEqual(['pane Shift', 'app Shift'])
  })
})

describe('the window', () => {
  test('hears two taps of Shift, and nothing once it has stopped listening', () => {
    const got: Modifier[] = []
    const stop = hearTaps((key) => got.push(key))
    const { window, fire, listeners } = fakeWindow()
    const unlisten = listenForTaps(window)

    const tap = () => {
      fire('keydown', { key: 'Shift', shiftKey: true })
      fire('keyup', { key: 'Shift' })
    }
    tap()
    tap()
    expect(got).toEqual(['Shift'])

    unlisten()
    expect([...listeners.values()].flat()).toEqual([])
    stop()
  })

  test('forgets a tap when the pointer is pressed, or when the window loses focus', () => {
    const got: Modifier[] = []
    const stop = hearTaps((key) => got.push(key))
    const { window, fire, target } = fakeWindow()
    const unlisten = listenForTaps(window)

    const tap = () => {
      fire('keydown', { key: 'Shift', shiftKey: true })
      fire('keyup', { key: 'Shift' })
    }

    tap()
    fire('pointerdown')
    tap()
    expect(got).toEqual([])

    fire('pointerdown')
    tap()
    fire('blur', { target })
    tap()
    expect(got).toEqual([])

    // A field losing the keyboard is not the window losing it.
    fire('pointerdown')
    tap()
    fire('blur', { target: {} })
    tap()

    expect(got).toEqual(['Shift'])
    unlisten()
    stop()
  })
})

/** Emil, 2026-09-30: "instead of Ctrl + P I want the shortcut to be just 'shift shift'
 *  for that global search". The tap itself is double-tap.ts; this is what it runs. */
describe('what a double tap runs', () => {
  const context = (opened: string[]) => ({
    palette: (mode?: 'commands') => opened.push(mode ?? 'everything'),
    fullscreen: () => undefined,
  })

  test('is the palette on Shift, which is what its row says', () => {
    const opened: string[] = []

    expect(runTap('Shift', context(opened))).toBe(true)
    expect(opened).toEqual(['everything'])
    expect(shortcuts.hint('app.palette')).toBe('Shift Shift')
  })

  test('follows a rebind to another modifier, and is nothing once taken away', () => {
    const opened: string[] = []

    shortcuts.set('app.palette', 'Mod Mod')
    expect(runTap('Shift', context(opened))).toBe(false)
    expect(runTap('Control', context(opened))).toBe(true)

    shortcuts.set('app.palette', null)
    expect(runTap('Control', context(opened))).toBe(false)
    expect(opened).toEqual(['everything'])
  })

  test('clashes like any other key when somebody takes it for something else', () => {
    expect(shortcuts.refuse('Shift Shift')).toBeNull()
    expect(shortcuts.conflicts('app.commands', 'Shift Shift').map((one) => one.id)).toEqual([
      'app.palette',
    ])
  })
})

describe('the app listening', () => {
  test('opens the palette on Shift twice, and stops listening when asked', () => {
    const opened: string[] = []
    const { window, fire, listeners } = fakeWindow()
    const stop = hear(
      () => ({ palette: () => opened.push('palette'), fullscreen: () => undefined }),
      window,
    )

    for (let one = 0; one < 2; one++) {
      fire('keydown', { key: 'Shift', shiftKey: true })
      fire('keyup', { key: 'Shift' })
    }
    expect(opened).toEqual(['palette'])

    stop()
    expect([...listeners.values()].flat()).toEqual([])
  })

  /** Emil, 2026-10-03: Shift Shift with the palette up closes it. The tap says it is a
   *  tap; whether a palette is up to close is the window's, which App.svelte answers. */
  test('says the palette was asked by a tap, which a chord never does', () => {
    const asked: (boolean | undefined)[] = []
    const { window, fire } = fakeWindow()
    const stop = hear(
      () => ({
        palette: (_mode?: 'commands', again?: boolean) => asked.push(again),
        fullscreen: () => undefined,
      }),
      window,
    )

    for (let one = 0; one < 2; one++) {
      fire('keydown', { key: 'Shift', shiftKey: true })
      fire('keyup', { key: 'Shift' })
    }
    stop()
    expect(asked).toEqual([true])

    const chord: (boolean | undefined)[] = []
    runEntry('app.palette.alt', {
      palette: (_mode?: 'commands', again?: boolean) => chord.push(again),
      fullscreen: () => undefined,
    })
    expect(chord).toEqual([undefined])
  })
})
