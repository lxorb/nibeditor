/** What an agent types into the reader's terminal and reads back off it: keys as the
 *  bytes a program expects, the one rule for what goes without asking, and a buffer as
 *  the lines a person reads. */

import { describe, expect, test } from 'vitest'
import { keyBytes, linesOf, type Row, typesFreely } from './terminal-keys'

describe('keys', () => {
  test('by name, the arrows as the program in front asked for them', () => {
    expect(keyBytes(['Ctrl+C', 'Enter', 'Tab'], false)).toEqual({ bytes: '\x03\r\t' })
    expect(keyBytes(['Up', 'Left'], false)).toEqual({ bytes: '\x1b[A\x1b[D' })
    expect(keyBytes(['Up', 'Left'], true)).toEqual({ bytes: '\x1bOA\x1bOD' })
    expect(keyBytes(['Up', 'F13'], false)).toEqual({ unknown: 'F13' })
  })
})

describe('what goes without asking', () => {
  const programs = ['git', 'NPM']

  test('one command line of a program on the list, with Enter', () => {
    expect(typesFreely('git status', true, [], programs)).toBe(true)
    expect(typesFreely('npm test', true, [], programs)).toBe(true)
    expect(typesFreely('"C:\\Program Files\\Git\\bin\\git.exe" log', true, [], programs)).toBe(true)
  })

  test('nothing else: another program, a second command, no Enter, keys after it', () => {
    expect(typesFreely('rm -rf build', true, [], programs)).toBe(false)
    expect(typesFreely('git status; rm -rf ~', true, [], programs)).toBe(false)
    expect(typesFreely('git log | sh', true, [], programs)).toBe(false)
    expect(typesFreely('git status', false, [], programs)).toBe(false)
    expect(typesFreely('git status', true, ['Enter'], programs)).toBe(false)
    // An Enter alone runs whatever was typed before it, which is not here to judge.
    expect(typesFreely('', true, [], programs)).toBe(false)
    expect(typesFreely('', false, ['Enter'], programs)).toBe(false)
    expect(typesFreely('', false, ['Up'], programs)).toBe(false)
  })

  test('an interrupt alone', () => {
    expect(typesFreely('', false, ['Ctrl+C'], [])).toBe(true)
    expect(typesFreely('', false, ['Ctrl+C', 'Ctrl+C'], [])).toBe(true)
    expect(typesFreely('', false, [], [])).toBe(false)
  })
})

describe('a buffer as lines', () => {
  function rows(...lines: [string, boolean?][]) {
    const all: Row[] = lines.map(([words, wrapped]) => ({
      isWrapped: wrapped ?? false,
      translateToString: () => words,
    }))
    return { length: all.length, getLine: (at: number) => all[at] }
  }

  test('wrapped rows joined, the empty rows under the last words left out', () => {
    const buffer = rows(['$ npm run build'], ['a very long li'], ['ne, wrapped', true], [''], [''])
    expect(linesOf(buffer, 0, 100)).toEqual({
      text: '$ npm run build\na very long line, wrapped',
      truncated: false,
    })
  })

  test('from a row on, and the last lines when there are more', () => {
    const buffer = rows(['one'], ['two'], ['three'], ['four'])
    expect(linesOf(buffer, 1, 100).text).toBe('two\nthree\nfour')
    expect(linesOf(buffer, 0, 2)).toEqual({ text: 'three\nfour', truncated: true })
  })
})
