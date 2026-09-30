import { describe, expect, test, vi } from 'vitest'
import { matchesCombination } from '../keys'
import { barKey, type Bindings, stops } from './bar-keys'
import { replay } from './keys'

/** The registry's defaults for the bar, bound the way the shortcuts store binds
 *  them. Which keys those are is shortcuts.test.ts's; this is what the bar makes of
 *  them. */
const DEFAULTS: Record<string, string> = {
  'web.address': 'Mod-l',
  'web.address.alt': 'Alt-d',
  'web.reload': 'F5',
  'web.reload.alt': 'Mod-r',
  'web.fresh': 'Mod-Shift-r',
  'web.fresh.alt': 'Mod-F5',
  'web.stop': 'Escape',
  'app.zoom-in': 'Mod-=',
  'app.zoom-out': 'Mod--',
  'app.zoom-reset': 'Mod-0',
}

function bindings(keys: Record<string, string> = DEFAULTS): Bindings {
  return {
    platform: 'win',
    pressed: (id, event) => {
      const key = keys[id]
      return key !== undefined && matchesCombination(key, event, 'win')
    },
  }
}

function press(key: string, held: Partial<KeyboardEvent> = {}): KeyboardEvent {
  const code = /^\d$/.test(key) ? `Digit${key}` : key.length === 1 ? `Key${key.toUpperCase()}` : key
  return {
    key,
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    defaultPrevented: false,
    ...held,
  } as KeyboardEvent
}

const CTRL = { ctrlKey: true }

describe('a key in front of a page', () => {
  test('reloads on F5 and Ctrl+R, and past the cache with Shift', () => {
    const keys = bindings()
    expect(barKey(press('F5'), keys)).toEqual({ to: 'step', step: 'reload' })
    expect(barKey(press('r', CTRL), keys)).toEqual({ to: 'step', step: 'reload' })
    expect(barKey(press('R', { ctrlKey: true, shiftKey: true }), keys)).toEqual({
      to: 'step',
      step: 'fresh',
    })
    expect(barKey(press('F5', CTRL), keys)).toEqual({ to: 'step', step: 'fresh' })
  })

  test('goes to the address field on Ctrl+L and Alt+D', () => {
    const keys = bindings()
    expect(barKey(press('l', CTRL), keys)).toEqual({ to: 'address' })
    expect(barKey(press('d', { altKey: true }), keys)).toEqual({ to: 'address' })
  })

  test('jumps along the strip on Ctrl and a digit, the ninth being the last', () => {
    const keys = bindings()
    expect(barKey(press('1', CTRL), keys)).toEqual({ to: 'tab', index: 0 })
    expect(barKey(press('9', CTRL), keys)).toEqual({ to: 'tab', index: 8 })
    // Ctrl+Alt and a digit is the app's own jump, which the window answers.
    expect(barKey(press('1', { ctrlKey: true, altKey: true }), keys)).toBeNull()
  })

  test("zooms the page on Chrome's keys, which size a note's words elsewhere", () => {
    const keys = bindings()
    const zoom = (step: string) => ({ to: 'zoom', step })

    expect(barKey(press('=', { ...CTRL, code: 'Equal' }), keys)).toEqual(zoom('in'))
    expect(barKey(press('-', { ...CTRL, code: 'Minus' }), keys)).toEqual(zoom('out'))
    expect(barKey(press('0', CTRL), keys)).toEqual(zoom('reset'))
    // Ctrl and +: Shift and = on an American keyboard, its own key on a German one,
    // and the number pad's, whose - and 0 are the same characters as the row's.
    expect(barKey(press('+', { ...CTRL, shiftKey: true, code: 'Equal' }), keys)).toEqual(zoom('in'))
    expect(barKey(press('+', { ...CTRL, code: 'BracketRight' }), keys)).toEqual(zoom('in'))
    expect(barKey(press('+', { ...CTRL, code: 'NumpadAdd' }), keys)).toEqual(zoom('in'))
    expect(barKey(press('-', { ...CTRL, code: 'NumpadSubtract' }), keys)).toEqual(zoom('out'))
    expect(barKey(press('0', { ...CTRL, code: 'Numpad0' }), keys)).toEqual(zoom('reset'))
  })

  test('leaves a sign typed with AltGr, or with no Ctrl, to whatever has the keyboard', () => {
    const keys = bindings()
    expect(barKey(press('+', { ctrlKey: true, altKey: true, code: 'Equal' }), keys)).toBeNull()
    expect(barKey(press('+', { shiftKey: true, code: 'Equal' }), keys)).toBeNull()
    expect(barKey(press('=', { code: 'Equal' }), keys)).toBeNull()
    expect(barKey(press('+', { metaKey: true, code: 'NumpadAdd' }), keys)).toBeNull()
  })

  test('zooms on Cmd and + on a Mac, and not on Ctrl', () => {
    const mac: Bindings = { platform: 'mac', pressed: () => false }
    expect(barKey(press('+', { metaKey: true, shiftKey: true, code: 'Equal' }), mac)).toEqual({
      to: 'zoom',
      step: 'in',
    })
    expect(barKey(press('+', { ...CTRL, code: 'NumpadAdd' }), mac)).toBeNull()
  })

  test("follows a reader's own bindings", () => {
    const keys = bindings({ ...DEFAULTS, 'web.reload': 'F9', 'web.reload.alt': '' })
    expect(barKey(press('F5'), keys)).toBeNull()
    expect(barKey(press('r', CTRL), keys)).toBeNull()
    expect(barKey(press('F9'), keys)).toEqual({ to: 'step', step: 'reload' })
  })

  test("zooms on the reader's own keys for the words' size", () => {
    const keys = bindings({ ...DEFAULTS, 'app.zoom-out': 'Mod-Shift-j', 'app.zoom-reset': '' })
    expect(barKey(press('-', { ...CTRL, code: 'Minus' }), keys)).toBeNull()
    expect(barKey(press('0', CTRL), keys)).toBeNull()
    expect(barKey(press('J', { ...CTRL, shiftKey: true }), keys)).toEqual({
      to: 'zoom',
      step: 'out',
    })
  })

  test('leaves every other key alone', () => {
    const keys = bindings()
    for (const one of [press('a'), press('F6'), press('Escape'), press('t', CTRL)]) {
      expect(barKey(one, keys), one.key).toBeNull()
    }
  })
})

/** F6 in the app walks its regions; F6 inside a page is Chrome's way out to the
 *  address field, and the only thing that tells them apart is where it was pressed. */
describe('F6', () => {
  test('from inside the page is the address field', () => {
    let played: Event | undefined
    vi.stubGlobal(
      'KeyboardEvent',
      class {
        constructor(
          readonly type: string,
          init: KeyboardEventInit,
        ) {
          Object.assign(this, { defaultPrevented: false, metaKey: false, ...init })
        }
      },
    )
    vi.stubGlobal('window', { dispatchEvent: (event: Event) => (played = event) })

    replay({
      key: 'F6',
      code: 'F6',
      ctrl: false,
      shift: false,
      alt: false,
      repeat: false,
      down: true,
    })
    vi.unstubAllGlobals()

    expect(played).toBeDefined()
    if (played) expect(barKey(played as KeyboardEvent, bindings())).toEqual({ to: 'address' })
    expect(barKey(press('F6'), bindings())).toBeNull()
  })
})

describe('Escape', () => {
  test('stops a page on its way, and only then', () => {
    const keys = bindings()
    expect(stops(press('Escape'), true, keys)).toBe(true)
    expect(stops(press('Escape'), false, keys)).toBe(false)
  })

  test('is not taken from whatever answered it first', () => {
    expect(stops(press('Escape', { defaultPrevented: true }), true, bindings())).toBe(false)
  })
})
