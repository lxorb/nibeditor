import { describe, expect, test } from 'vitest'
import { type Keystroke, routeKey } from './keys'

/** Which keys a terminal lets the app have: VS Code's split, checked against its own
 *  skip list. See keys.ts, and docs/keyboard.md for the list as a reader sees it. */

function press(key: string, held: Partial<Omit<Keystroke, 'key'>> = {}): Keystroke {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held }
}

const ctrl = { ctrlKey: true }
const ctrlShift = { ctrlKey: true, shiftKey: true }
const cmd = { metaKey: true }

describe('on Windows and Linux', () => {
  test.each(['win', 'linux'] as const)('the tab and window keys are the app’s (%s)', (platform) => {
    for (const [key, held, command] of [
      ['t', ctrl, 'app.new-kind'],
      ['T', ctrlShift, 'app.reopen'],
      ['Tab', ctrl, 'app.next-note'],
      ['Tab', ctrlShift, 'app.previous-note'],
      ['PageDown', ctrl, 'app.next-note.alt'],
      ['PageUp', ctrlShift, 'app.move-tab-left'],
      ['p', ctrl, 'app.palette'],
      ['P', ctrlShift, 'app.commands'],
      ['F6', {}, 'app.region-next'],
      ['F11', {}, 'app.fullscreen'],
      ['3', { altKey: true }, 'app.note-3.alt'],
      ['3', { ctrlKey: true, altKey: true }, 'app.note-3'],
      ['ArrowRight', { ctrlKey: true, altKey: true }, 'pane.split-right'],
      ['E', ctrlShift, 'app.files'],
    ] as const) {
      expect(routeKey(press(key, held), platform, command, false), `${key} ${command}`).toBe('app')
    }
  })

  /** A half-typed command losing its tab to a word deleted is the worst trade there is:
   *  VS Code, Windows Terminal and every emulator let the shell have Ctrl+W. */
  test('and everything a shell reads is the shell’s, Ctrl+W above all', () => {
    for (const [key, command] of [
      ['w', 'app.close'],
      ['n', 'app.new'],
      ['o', 'app.open'],
      ['s', 'app.save'],
      ['r', null],
      ['c', null],
      ['d', null],
    ] as const) {
      expect(routeKey(press(key, ctrl), 'win', command, false), key).toBe('shell')
    }
    expect(routeKey(press('a'), 'win', null, false)).toBe('shell')
    expect(routeKey(press('F5'), 'win', null, false)).toBe('shell')
  })

  /** Close window here and Close tab in every terminal there is: neither, then. */
  test('Ctrl+Shift+W is sent to nobody', () => {
    expect(routeKey(press('W', ctrlShift), 'win', 'app.close-window', false)).toBe('shell')
  })

  test('the terminal’s own copy, paste and find', () => {
    expect(routeKey(press('C', ctrlShift), 'linux', null, false)).toBe('copy')
    expect(routeKey(press('V', ctrlShift), 'linux', null, false)).toBe('paste')
    expect(routeKey(press('Insert', { shiftKey: true }), 'linux', null, false)).toBe('paste')
    expect(routeKey(press('f', ctrl), 'win', null, true)).toBe('find')
    expect(routeKey(press('=', ctrl), 'win', 'app.zoom-in', false)).toBe('zoom-in')
    expect(routeKey(press('0', ctrl), 'win', 'app.zoom-reset', false)).toBe('zoom-reset')
  })

  /** Windows Terminal and VS Code paste on Ctrl+V there; Linux keeps it for the shell. */
  test('Ctrl+V pastes on Windows only, and Ctrl+C is always the interrupt', () => {
    expect(routeKey(press('v', ctrl), 'win', null, false)).toBe('paste')
    expect(routeKey(press('v', ctrl), 'linux', null, false)).toBe('shell')
    expect(routeKey(press('c', ctrl), 'win', null, false)).toBe('shell')
  })

  /** AltGr is Ctrl and Alt to Windows, and it is how half of Europe types a brace. */
  test('AltGr typing a character is never a chord', () => {
    expect(routeKey(press('{', { ctrlKey: true, altKey: true }), 'win', 'app.note-7', false)).toBe(
      'shell',
    )
    expect(routeKey(press('@', { ctrlKey: true, altKey: true }), 'win', null, false)).toBe('shell')
  })
})

describe('on a Mac', () => {
  /** No shell ever sees Cmd, so every app command on it is the app's - Cmd+W closing
   *  the tab among them, as it does in Terminal and iTerm2. */
  test('every app command on Cmd is the app’s', () => {
    expect(routeKey(press('w', cmd), 'mac', 'app.close', false)).toBe('app')
    expect(routeKey(press('t', cmd), 'mac', 'app.new-kind', false)).toBe('app')
    expect(routeKey(press('Tab', ctrl), 'mac', 'app.next-note', false)).toBe('app')
  })

  test('Ctrl is the shell’s, all of it', () => {
    expect(routeKey(press('w', ctrl), 'mac', null, false)).toBe('shell')
    expect(routeKey(press('c', ctrl), 'mac', null, false)).toBe('shell')
  })

  test('and Terminal’s own copy, paste, select all and clear', () => {
    expect(routeKey(press('c', cmd), 'mac', null, false)).toBe('copy')
    expect(routeKey(press('v', cmd), 'mac', null, false)).toBe('paste')
    expect(routeKey(press('a', cmd), 'mac', null, false)).toBe('select-all')
    expect(routeKey(press('k', cmd), 'mac', null, false)).toBe('clear')
  })
})
