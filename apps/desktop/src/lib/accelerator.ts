/** A key from any app as the system is handed it - the agents' stop, quick add's key:
 *  the keyboard registry writes `Mod-Alt-Shift-k`, the system's global shortcut reads
 *  `Control+Alt+Shift+K`.
 *
 *  One key chosen in one list, so a reader who moves a key moves it everywhere; the
 *  registry's notation is resolved for this platform here, where `Mod` is Cmd on a Mac
 *  and Ctrl everywhere else, and handed over already resolved. */

import { parseCombination, type Platform } from './keys'

/** The system's names for the keys the registry writes by `KeyboardEvent.key`. */
const NAMED: Readonly<Record<string, string>> = {
  ' ': 'Space',
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  '-': 'Minus',
  '=': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
}

/** The accelerator for a written combination, or null for one the system cannot hold:
 *  none at all, or a key other than a function key with no modifier, which would take a
 *  letter from every app. */
export function accelerator(written: string | null, platform: Platform): string | null {
  const combination = parseCombination(written ?? '', platform)
  if (!combination) return null
  const key = combination.key
  const chord = combination.ctrl || combination.meta || combination.alt
  if (!chord && !/^F\d{1,2}$/.test(key)) return null

  const named = /^[a-z]$/.test(key)
    ? key.toUpperCase()
    : /^[0-9]$/.test(key)
      ? `Digit${key}`
      : /^F\d{1,2}$/.test(key)
        ? key
        : NAMED[key]
  if (named === undefined) return null

  return [
    combination.ctrl ? 'Control' : null,
    combination.meta ? 'Super' : null,
    combination.alt ? 'Alt' : null,
    combination.shift ? 'Shift' : null,
    named,
  ]
    .filter((part) => part !== null)
    .join('+')
}
