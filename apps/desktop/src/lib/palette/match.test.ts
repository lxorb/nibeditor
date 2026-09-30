import { describe, expect, test } from 'vitest'
import { fuzzy } from '../fuzzy'
import { fuzzyFolded, fuzzyPlaces, nearly, oneSlip } from './match'

describe('the best place to start', () => {
  test('is the word the letters sit together in, not the first letter that fits', () => {
    // The greedy walk scatters `plan` across both words; started at the second, the
    // four letters are together.
    expect(fuzzyFolded('plan', 'project plan')).toBeGreaterThan(fuzzy('plan', 'project plan') ?? 0)
    expect(fuzzyPlaces('plan', 'Project plan')).toEqual([8, 9, 10, 11])
  })

  test('answers what `fuzzy` answers where the first place was already the best', () => {
    expect(fuzzyFolded('rdm', 'read me')).toBe(fuzzy('rdm', 'read me'))
    expect(fuzzyFolded('zz', 'read me')).toBeNull()
  })
})

describe('one slip', () => {
  test('is a letter wrong, missing, extra, or two swapped', () => {
    expect(oneSlip('setings', 'settings')).toBe(true)
    expect(oneSlip('settinsg', 'settings')).toBe(true)
    expect(oneSlip('settimgs', 'settings')).toBe(true)
    expect(oneSlip('settingss', 'settings')).toBe(true)
    expect(oneSlip('stetings', 'settings')).toBe(true)
    expect(oneSlip('sttngs', 'settings')).toBe(false)
  })

  test('finds a word at the start of a word in a name, for five letters and more', () => {
    expect(nearly('shotrcuts', 'keyboard shortcuts')).toBe(true)
    expect(nearly('tbale', 'insert table')).toBe(true)
    expect(nearly('tbl', 'insert table')).toBe(false)
    expect(nearly('xyzwv', 'insert table')).toBe(false)
    // Four letters are one slip from too much: `dark` is not `markdown`.
    expect(nearly('dark', 'export as markdown')).toBe(false)
  })
})
