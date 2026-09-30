import { describe, expect, test } from 'vitest'
import { asksFirst, linesIn, pasted, spokenPath } from './paste'

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

  /** A row of the file list dropped on a terminal: its path, as the shell reads one. */
  test('a dropped path is spelled for the shell it lands in', () => {
    expect(spokenPath('C:\\Users\\me\\notes', 'pwsh')).toBe('C:\\Users\\me\\notes')
    expect(spokenPath('C:\\Users\\me\\My notes', 'cmd')).toBe('"C:\\Users\\me\\My notes"')
    expect(spokenPath('C:\\Users\\me\\My notes', 'git-bash')).toBe("'/c/Users/me/My notes'")
    expect(spokenPath('C:\\Users\\me\\notes', 'wsl:Ubuntu')).toBe('/mnt/c/Users/me/notes')
    expect(spokenPath("/home/me/it's here", '/bin/zsh')).toBe("'/home/me/it'\\''s here'")
    expect(spokenPath('/home/me/notes.md', '/bin/bash')).toBe('/home/me/notes.md')
  })

  /** VS Code's "auto": only where the lines would run as they land. */
  test('asks first only for lines a shell without bracketed paste would run', () => {
    expect(asksFirst('a\nb', false)).toBe(true)
    expect(asksFirst('a\nb', true)).toBe(false)
    expect(asksFirst('just this\n', false)).toBe(false)
  })
})
