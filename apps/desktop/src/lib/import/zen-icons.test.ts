import { describe, expect, test } from 'vitest'

import { keyNamed, loadIcons } from '../icons'
import { ZEN_DRAWINGS, zenIcon, zenTint } from './zen-icons'

describe("a Zen space's icon", () => {
  test('is an emoji as it was', () => {
    expect(zenIcon('🏡')).toBe('🏡')
  })

  test("is Lucide's drawing of what Zen drew", () => {
    expect(zenIcon('chrome://browser/skin/zen-icons/selectable/rocket.svg')).toBe('rocket')
    expect(zenIcon('chrome://browser/skin/zen-icons/selectable/people.svg')).toBe('users')
  })

  test('is nothing where nib has nothing to draw', () => {
    expect(zenIcon('chrome://browser/skin/zen-icons/selectable/baseball.svg')).toBeNull()
    expect(zenIcon('chrome://browser/skin/zen-icons/selectable/../../../evil.svg')).toBeNull()
    expect(zenIcon('a word')).toBeNull()
    expect(zenIcon(null)).toBeNull()
  })

  test('is one Lucide draws, every one of them', async () => {
    const library = await loadIcons()
    expect(ZEN_DRAWINGS.filter((name) => keyNamed(library, name) === null)).toEqual([])
  })
})

describe("a Zen space's colour", () => {
  test('is the nearest accent', () => {
    expect(zenTint([53, 132, 228])).toBe('blue')
    expect(zenTint([240, 85, 90])).toBe('red')
    expect(zenTint([60, 200, 140])).toBe('green')
    expect(zenTint([120, 120, 125])).toBe('slate')
    expect(zenTint(null)).toBeNull()
  })
})
