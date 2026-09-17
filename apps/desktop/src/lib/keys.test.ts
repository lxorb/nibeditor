import { describe, expect, test } from 'vitest'
import {
  chorded,
  holdKey,
  matchesCombination,
  parseCombination,
  type Platform,
  readCombination,
  sameCombination,
  showCombination,
  withShift,
} from './keys'

/** A keystroke, with only the fields the reader of one looks at. */
function press(key: string, held: Partial<KeyboardEvent> & { code?: string } = {}) {
  return {
    key,
    code: held.code,
    ctrlKey: !!held.ctrlKey,
    metaKey: !!held.metaKey,
    altKey: !!held.altKey,
    shiftKey: !!held.shiftKey,
  }
}

describe('reading a written combination', () => {
  test('Mod is Ctrl off a Mac and Cmd on one', () => {
    expect(parseCombination('Mod-k', 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: false,
      key: 'k',
    })
    expect(parseCombination('Mod-k', 'mac')).toEqual({
      ctrl: false,
      meta: true,
      alt: false,
      shift: false,
      key: 'k',
    })
  })

  test('keeps a trailing minus as the key it is', () => {
    expect(parseCombination('Mod--', 'win')?.key).toBe('-')
    expect(parseCombination('Mod-Shift-[', 'win')?.key).toBe('[')
  })

  test('takes the modifiers in any order and the letter in any case', () => {
    expect(sameCombination('Mod-Shift-k', 'Shift-Mod-K', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'win')).toBe(true)
    expect(sameCombination('Mod-k', 'Ctrl-k', 'mac')).toBe(false)
  })

  test('refuses what is not one', () => {
    expect(parseCombination('', 'win')).toBeNull()
    expect(parseCombination('Hyper-k', 'win')).toBeNull()
  })
})

describe('reading a keystroke', () => {
  test('writes it the way the keymap writes it', () => {
    expect(readCombination(press('s', { ctrlKey: true, code: 'KeyS' }), 'win')).toBe('Mod-s')
    expect(readCombination(press('s', { metaKey: true, code: 'KeyS' }), 'mac')).toBe('Mod-s')
    expect(readCombination(press('F10'), 'win')).toBe('F10')
  })

  test('names the key rather than the character Shift made of it', () => {
    // Ctrl+Shift+3 arrives as `#` on a US layout and as `§` on others; the
    // key underneath is the 3, and that is what the binding says.
    expect(
      readCombination(press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }), 'win'),
    ).toBe('Mod-Shift-3')
    expect(
      readCombination(press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }), 'win'),
    ).toBe('Mod-Shift-=')
  })

  test('waits through the modifiers on their own', () => {
    expect(readCombination(press('Control', { ctrlKey: true }), 'win')).toBeNull()
    expect(readCombination(press('Shift', { shiftKey: true }), 'win')).toBeNull()
  })
})

describe('matching a keystroke against a binding', () => {
  test('answers to the character or to the key', () => {
    expect(
      matchesCombination(
        'Mod-Shift-3',
        press('#', { ctrlKey: true, shiftKey: true, code: 'Digit3' }),
        'win',
      ),
    ).toBe(true)
    expect(
      matchesCombination(
        'Mod-Shift-3',
        press('3', { ctrlKey: true, shiftKey: true, code: 'Digit3' }),
        'win',
      ),
    ).toBe(true)
  })

  /** The layout rule this exists for.
   *
   *  On AZERTY the digits are the shifted characters of the top row: a French reader
   *  pressing what is printed as Ctrl+0 is holding Shift down, because Shift is how
   *  that key makes a nought at all. Matching the modifiers exactly means Ctrl+0 is a
   *  chord nobody on that keyboard can press - which is what kept the text size from
   *  resetting there - so a digit is matched by the key underneath rather than by what
   *  the layout printed on it.
   *
   *  Digits only, and only where the chord asks for no Shift. A letter is not read
   *  this way round: the shifted letter and the letter are two names for one key, so
   *  relaxing it there would make Ctrl+Shift+E fire Ctrl+E as well. */
  test('a digit answers to its own key, whatever the layout needs to type it', () => {
    // A US keyboard, where the nought needs nothing.
    expect(matchesCombination('Mod-0', press('0', { ctrlKey: true, code: 'Digit0' }), 'win')).toBe(
      true,
    )
    // AZERTY, pressing the same physical key with Shift, which is how a nought is typed.
    expect(
      matchesCombination(
        'Mod-0',
        press('0', { ctrlKey: true, shiftKey: true, code: 'Digit0' }),
        'win',
      ),
    ).toBe(true)
    // And AZERTY without the Shift, where the same key makes an à.
    expect(matchesCombination('Mod-0', press('à', { ctrlKey: true, code: 'Digit0' }), 'win')).toBe(
      true,
    )
  })

  test('but a letter still wants the Shift it was written with', () => {
    expect(
      matchesCombination(
        'Mod-e',
        press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' }),
        'win',
      ),
    ).toBe(false)
    expect(
      matchesCombination(
        'Mod-Shift-e',
        press('E', { ctrlKey: true, shiftKey: true, code: 'KeyE' }),
        'win',
      ),
    ).toBe(true)
  })

  test('and Shift written into the chord is still wanted exactly', () => {
    // Ctrl+Shift+0 is not Ctrl+0 with Shift allowed: nothing is bound to it, and a
    // chord that answered both would be the clash the digit rule is about.
    expect(
      matchesCombination('Mod-Shift-0', press('0', { ctrlKey: true, code: 'Digit0' }), 'win'),
    ).toBe(false)
    expect(
      matchesCombination(
        'Mod-=',
        press('+', { ctrlKey: true, shiftKey: true, code: 'Equal' }),
        'win',
      ),
    ).toBe(false)
  })

  test('wants the modifiers exactly', () => {
    expect(matchesCombination('Mod-s', press('s', { ctrlKey: true, code: 'KeyS' }), 'win')).toBe(
      true,
    )
    // Ctrl+Alt+S is not Ctrl+S with something else held down.
    expect(
      matchesCombination('Mod-s', press('s', { ctrlKey: true, altKey: true, code: 'KeyS' }), 'win'),
    ).toBe(false)
    expect(matchesCombination('Mod-s', press('s', { metaKey: true, code: 'KeyS' }), 'win')).toBe(
      false,
    )
  })
})

describe('showing a combination', () => {
  test('is signs on a Mac and words everywhere else', () => {
    expect(showCombination('Mod-Shift-k', 'mac')).toBe('⇧⌘K')
    expect(showCombination('Mod-Shift-k', 'win')).toBe('Ctrl+Shift+K')
    expect(showCombination('Mod-Shift-k', 'linux')).toBe('Ctrl+Shift+K')
  })

  test('puts the Mac signs in the order a Mac writes them', () => {
    expect(showCombination('Mod-Alt-Ctrl-Shift-k', 'mac')).toBe('⌃⌥⇧⌘K')
  })

  /** The key with the flag on it. `Meta` is what a browser calls it and nothing
   *  a reader has ever seen printed on a keyboard. */
  test('calls the meta key what the keyboard under it calls it', () => {
    expect(showCombination('Meta-k', 'win')).toBe('Win+K')
    expect(showCombination('Meta-k', 'linux')).toBe('Super+K')
    expect(showCombination('Ctrl-k', 'mac')).toBe('⌃K')
  })

  test('names the keys that have no character', () => {
    expect(showCombination('Alt-ArrowUp', 'win')).toBe('Alt+↑')
    expect(showCombination('Escape', 'win')).toBe('Esc')
    expect(showCombination('F10', 'mac')).toBe('F10')
  })

  test('hands back what it cannot read rather than nothing', () => {
    expect(showCombination('Hyper-k', 'win')).toBe('Hyper-k')
  })
})

/** The space bar, which had no test at all here until the one chord on it stopped
 *  working.
 *
 *  `Mod-Shift-Space` is the space switcher, and every layer of the app agreed it was
 *  a chord: the parser reads it, the matcher answers a real Ctrl+Shift+Space, the
 *  registry binds it - and it still opened nothing, because the key never reached the
 *  window. A list had taken it on the way past. So what was missing is both halves:
 *  that Space is a key like any other here, and that a widget can tell a chord from
 *  its own bare key before it claims one. See `chorded`, roving.ts and Select.svelte. */
describe('the space bar', () => {
  /** The browser's name for it is a single space; the written form spells it,
   *  because a combination with a space in the middle of it cannot be read back. */
  test('is written Space and read as one', () => {
    expect(parseCombination('Mod-Shift-Space', 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: true,
      key: ' ',
    })
    expect(
      readCombination(press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' }), 'win'),
    ).toBe('Mod-Shift-Space')
    expect(showCombination('Mod-Shift-Space', 'win')).toBe('Ctrl+Shift+Space')
    expect(showCombination('Mod-Shift-Space', 'mac')).toBe('⇧⌘Space')
  })

  test('answers the chord the space switcher is bound to', () => {
    const chord = press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' })
    expect(matchesCombination('Mod-Shift-Space', chord, 'win')).toBe(true)
    expect(matchesCombination('Mod-Shift-Space', chord, 'mac')).toBe(false)
    // And the bare key is not it, which is what a list opens a row with.
    expect(matchesCombination('Mod-Shift-Space', press(' ', { code: 'Space' }), 'win')).toBe(false)
  })
})

/** Whether a press belongs to the widget the keyboard is in or to the window.
 *
 *  The question every list, menu and picker has to ask before it calls
 *  `preventDefault`, because the window's own handler is the last one to run and
 *  gives way to a press something else has already spent. One list answering Space
 *  without asking was one chord nobody could press anywhere the keyboard could be in
 *  a list, which is most of the app. */
describe('telling a chord from a key a widget owns', () => {
  test('a bare key, and one under Shift, belong to the widget', () => {
    expect(chorded(press(' ', { code: 'Space' }))).toBe(false)
    expect(chorded(press('Enter'))).toBe(false)
    // Shift+F10 is the menu key: a list owns it, so Shift is not a modifier here.
    expect(chorded(press('F10', { shiftKey: true }))).toBe(false)
  })

  test('a key under Ctrl, Alt or Cmd is on its way to the window', () => {
    expect(chorded(press(' ', { ctrlKey: true, shiftKey: true, code: 'Space' }))).toBe(true)
    expect(chorded(press('ArrowLeft', { altKey: true }))).toBe(true)
    expect(chorded(press('Enter', { metaKey: true }))).toBe(true)
  })

  /** A keystroke may arrive with the modifiers left out - a synthetic one, or an
   *  older recording - and "not there" is not held down. */
  test('a keystroke with nothing said about the modifiers is a bare one', () => {
    expect(chorded({ key: ' ' })).toBe(false)
  })
})

/** The two halves a chord that is held rather than pressed needs: which key's release
 *  ends it, and what the same chord reads as with Shift added. See new-kind-chord.ts. */
describe('a chord that is held', () => {
  /** Never null for any of these: the combinations are written out here, and a
   *  parser that could not read one is the failure the test wants to see. */
  function combination(text: string, platform: Platform) {
    const read = parseCombination(text, platform)
    if (!read) throw new Error(`not a combination: ${text}`)

    return read
  }

  test('is ended by the modifier it is written with', () => {
    expect(holdKey(combination('Mod-t', 'win'))).toBe('Control')
    expect(holdKey(combination('Mod-t', 'mac'))).toBe('Meta')
    expect(holdKey(combination('Alt-n', 'win'))).toBe('Alt')
  })

  /** Mod first, because that is what every chord in this app is written with. */
  test('and Mod is the one that counts where there are two', () => {
    expect(holdKey(combination('Ctrl-Alt-n', 'win'))).toBe('Control')
  })

  /** Which `refuse` in shortcuts.svelte.ts forbids; a map from another version is not
   *  this one's to trust. */
  test('a combination with no modifier has nothing to hold', () => {
    expect(holdKey(combination('Shift-t', 'win'))).toBeNull()
  })

  test('steps back under Shift, which is the same chord with Shift in it', () => {
    expect(withShift('Mod-t')).toBe('Mod-Shift-t')
    expect(withShift('Alt-ArrowDown')).toBe('Alt-Shift-ArrowDown')
  })

  /** `Mod--` is Mod and the minus key, not Mod and nothing. */
  test('and the minus key survives being written again', () => {
    expect(parseCombination(withShift('Mod--'), 'win')).toEqual({
      ctrl: true,
      meta: false,
      alt: false,
      shift: true,
      key: '-',
    })
  })

  test('a chord that already holds Shift is left alone', () => {
    expect(withShift('Mod-Shift-t')).toBe('Mod-Shift-t')
  })
})
