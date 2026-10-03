import { describe, expect, test } from 'vitest'
import { readSpec, reportedFolder, startingFolder, writeSpec } from './spec'

/** What a terminal tab's words say, and where a new one starts. */

describe('a terminal written down', () => {
  test('reads back as itself', () => {
    const spec = { shell: 'pwsh', folder: 'C:\\Users\\me\\notes', key: 'k1', name: null }
    expect(readSpec(writeSpec(spec))).toEqual(spec)
    expect(readSpec(writeSpec({ ...spec, name: 'server' }))).toEqual({ ...spec, name: 'server' })
  })

  /** A tab nobody named writes what a build before names wrote. */
  test('with no name where it has none', () => {
    const words = writeSpec({ shell: 'cmd', folder: null, key: 'k', name: null })
    expect(JSON.parse(words)).toEqual({ shell: 'cmd', folder: null, key: 'k' })
  })

  /** A tab's words come back out of storage, so anything may be there. */
  test('and words that are not one read as nothing', () => {
    expect(readSpec('')).toBeNull()
    expect(readSpec('# A note')).toBeNull()
    expect(readSpec('{"folder": "/tmp"}')).toBeNull()
    expect(readSpec('{"shell": ""}')).toBeNull()
    expect(readSpec('{"shell": "cmd", "folder": 3}')).toEqual({
      shell: 'cmd',
      folder: null,
      key: '',
      name: null,
    })
    expect(readSpec('{"shell": "cmd", "name": "  "}')?.name).toBeNull()
  })
})

describe('where a new terminal starts', () => {
  const roots = ['/Notes', '/Work']

  test('in the space being worked in', () => {
    expect(startingFolder('/Notes/plans/week.md', '/Notes', roots)).toBe('/Notes')
    expect(startingFolder(null, '/Notes', roots)).toBe('/Notes')
  })

  /** The app's own stylesheet is in no space: its own folder is the one that has
   *  anything to do with it. */
  test('beside a file in no space', () => {
    expect(startingFolder('/config/nib/custom.css', '/Notes', roots)).toBe('/config/nib')
    expect(startingFolder('C:\\config\\nib\\custom.css', null, [])).toBe('C:\\config\\nib')
  })

  test('and at home with neither', () => {
    expect(startingFolder(null, null, [])).toBeNull()
  })
})

describe('the folder a shell says it is in', () => {
  /** Windows Terminal's OSC 9;9, which Command Prompt and PowerShell are taught. */
  test('as a Windows path', () => {
    expect(reportedFolder(9, '9;C:\\Users\\me', true, false)).toBe('C:\\Users\\me')
    expect(reportedFolder(9, '9;"C:\\Program Files"', true, false)).toBe('C:\\Program Files')
    // Another of ConEmu's sequences on the same number, which says nothing of folders.
    expect(reportedFolder(9, '4;1;50', true, false)).toBeNull()
  })

  /** OSC 7, which bash, zsh and fish say. */
  test('as a file address', () => {
    expect(reportedFolder(7, 'file://mac.local/Users/me/My%20Notes', false, false)).toBe(
      '/Users/me/My Notes',
    )
    expect(reportedFolder(7, 'file:///home/me/100%', false, false)).toBe('/home/me/100%')
    expect(reportedFolder(7, 'https://example.com/', false, false)).toBeNull()
  })

  /** Git Bash says `/c/Users/me`, which is `C:\Users\me` to the next shell started
   *  there - and a WSL shell's Linux path is kept as it is, for `--cd`. */
  test('as the Windows path a Git Bash path is, and a WSL path left alone', () => {
    expect(reportedFolder(7, 'file:///c/Users/me', true, false)).toBe('C:\\Users\\me')
    expect(reportedFolder(7, 'file:///C:/Users/me', true, false)).toBe('C:\\Users\\me')
    expect(reportedFolder(7, 'file:///d', true, false)).toBe('D:\\')
    expect(reportedFolder(7, 'file:///usr/bin', true, false)).toBeNull()
    expect(reportedFolder(7, 'file:///home/me/code', true, true)).toBe('/home/me/code')
  })
})
