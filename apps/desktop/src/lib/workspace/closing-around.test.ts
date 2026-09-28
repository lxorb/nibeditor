import { describe, expect, test } from 'vitest'
import { type Around, closedAround } from './closing-around'

/** A strip spelled as the reader sees it, as pinning.test.ts spells one: an
 *  upper-case letter is a pinned tab and a lower-case one is not. Each letter is
 *  also the tab's id. */
function closing(shape: string, id: string, which: Around): string {
  const strip: { id: string; pinned: boolean }[] = []
  for (const name of shape) strip.push({ id: name, pinned: name === name.toUpperCase() })

  return closedAround(strip, id, which)
    .map((one) => one.id)
    .join('')
}

describe('the tabs a close around one tab takes', () => {
  test('to the right: every tab after it', () => {
    expect(closing('abcd', 'b', 'right')).toBe('cd')
    expect(closing('abcd', 'd', 'right')).toBe('')
  })

  test('others: every tab but it', () => {
    expect(closing('abcd', 'b', 'others')).toBe('acd')
  })

  test('all: the whole strip, the tab itself included', () => {
    expect(closing('abcd', 'b', 'all')).toBe('abcd')
  })

  /** Chrome, VS Code and Obsidian all leave a pinned tab standing when the strip
   *  around it is cleared, whichever row cleared it. */
  test('never a pinned one', () => {
    expect(closing('PQab', 'P', 'right')).toBe('ab')
    expect(closing('PQab', 'a', 'others')).toBe('b')
    expect(closing('PQab', 'a', 'all')).toBe('ab')
  })

  test('nothing for a tab the strip has not got', () => {
    expect(closing('abc', 'z', 'all')).toBe('')
  })
})
