import { describe, expect, test } from 'vitest'
import { type Left, pastesItself, promptEnd, reporting, tidied } from './modes'

/** What a program left on, found where a prompt begins, and switched off there. */

const bytes = (text: string) => new TextEncoder().encode(text)

const clean: Left = {
  modes: {
    mouseTrackingMode: 'none',
    sendFocusMode: false,
    applicationCursorKeysMode: false,
    applicationKeypadMode: false,
    bracketedPasteMode: false,
    synchronizedOutputMode: false,
  },
  alternate: false,
}

const left = (modes: Partial<Left['modes']>, alternate = false): Left => ({
  modes: { ...clean.modes, ...modes },
  alternate,
})

const MOUSE_OFF =
  '\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l'

describe('a prompt mark', () => {
  test('ends just past its terminator, BEL or ESC backslash', () => {
    expect(promptEnd(bytes('out\r\n\x1b]133;A\x07PS C:\\> '))).toBe(13)
    expect(promptEnd(bytes('\x1b]133;A\x1b\\C:\\>'))).toBe(9)
  })

  test("VS Code's own is one too", () => {
    expect(promptEnd(bytes('\x1b]633;A\x07$ '))).toBe(8)
  })

  /** Other sequences are not marks: the folder, a title, a colour, another 133. */
  test('and nothing else is', () => {
    expect(promptEnd(bytes('\x1b]9;9;C:\\\x1b\\\x1b]0;title\x07\x1b[31mred\x1b]133;B\x07'))).toBe(
      -1,
    )
    expect(promptEnd(bytes('plain output'))).toBe(-1)
  })

  test('the first of several', () => {
    const two = bytes('\x1b]133;A\x07$ ls\r\n\x1b]133;A\x07$ ')
    expect(promptEnd(two)).toBe(8)
    expect(promptEnd(two.subarray(8))).toBe(14)
  })

  /** Cut in two by the chunk it came in: not found, and the next prompt's is. */
  test('cut short by the end of the chunk is not found', () => {
    expect(promptEnd(bytes('\x1b]133;A'))).toBe(-1)
    expect(promptEnd(bytes('\x1b]133;A\x1b'))).toBe(-1)
    expect(promptEnd(bytes('\x1b]13'))).toBe(-1)
  })
})

describe('what a prompt switches off', () => {
  test('nothing, where nothing was left on', () => {
    expect(tidied(clean, true)).toBe('')
    expect(tidied(clean, false)).toBe('')
  })

  /** Emil's prompt: any-event tracking in X10 bytes, every move typed at PowerShell. */
  test('the mouse, in every encoding, and the cursor shown', () => {
    expect(tidied(left({ mouseTrackingMode: 'any' }), true)).toBe(`${MOUSE_OFF}\x1b[?25h`)
    expect(tidied(left({ mouseTrackingMode: 'vt200' }), true)).toBe(`${MOUSE_OFF}\x1b[?25h`)
  })

  test('focus reports, held frames, the keys and the second screen', () => {
    const all = left(
      {
        sendFocusMode: true,
        synchronizedOutputMode: true,
        applicationCursorKeysMode: true,
        applicationKeypadMode: true,
      },
      true,
    )
    expect(tidied(all, true)).toBe('\x1b[?1049l\x1b[?1004l\x1b[?2026l\x1b[?1l\x1b>\x1b[?25h')
  })

  /** bash, zsh, fish and PSReadLine switch bracketed paste on for each line themselves. */
  test('bracketed paste only for a shell that never asks for it', () => {
    const paste = left({ bracketedPasteMode: true })
    expect(tidied(paste, true)).toBe('')
    expect(tidied(paste, false)).toBe('\x1b[?2004l\x1b[?25h')
    expect(pastesItself('cmd')).toBe(false)
    expect(pastesItself('vs-cmd:1a2b3c')).toBe(false)
    expect(pastesItself('pwsh')).toBe(true)
    expect(pastesItself('git-bash')).toBe(true)
    expect(pastesItself('/bin/zsh')).toBe(true)
  })

  /** Once the prompt is drawn the keys and the screen are the line editor's. */
  test('after the prompt is drawn, only the mouse and focus', () => {
    const late = left(
      { mouseTrackingMode: 'drag', applicationCursorKeysMode: true, bracketedPasteMode: true },
      true,
    )
    expect(tidied(late, false, false)).toBe(`${MOUSE_OFF}\x1b[?25h`)
    expect(reporting(late)).toBe(true)
    expect(reporting(left({ sendFocusMode: true }))).toBe(true)
    expect(reporting(left({ applicationCursorKeysMode: true }))).toBe(false)
  })
})
