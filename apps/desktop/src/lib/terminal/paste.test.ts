import { describe, expect, test } from 'vitest'
import { asksFirst, linesIn, pasted } from './paste'

describe('a paste into a terminal', () => {
  /** Windows Terminal's trimPaste: a command copied with the line break that ended it
   *  does not run the moment it lands. */
  test('loses the whitespace after a single line', () => {
    expect(pasted('npm install\n')).toBe('npm install')
    expect(pasted('ls -la  \r\n')).toBe('ls -la')
  })

  test('and keeps a block of lines as it was', () => {
    expect(pasted('cd x\nls\n')).toBe('cd x\nls\n')
    expect(linesIn('cd x\nls\n')).toBe(3)
    expect(linesIn('one line\n')).toBe(1)
  })

  /** VS Code's "auto": only where the lines would run as they land. */
  test('asks first only for lines a shell without bracketed paste would run', () => {
    expect(asksFirst('a\nb', false)).toBe(true)
    expect(asksFirst('a\nb', true)).toBe(false)
    expect(asksFirst('just this\n', false)).toBe(false)
  })
})
