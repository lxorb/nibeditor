import { MUTED_FOR_GOOD } from '@nib/chats/notify'
import { describe, expect, it } from 'vitest'
import { mutedUntil, ringOf } from './bell'

const NOW = 1_790_000_000_000

describe('ringOf', () => {
  it('draws the level in force, and off for a muted chat or one set to nothing', () => {
    expect(ringOf(null, null, 3, NOW)).toBe('all')
    expect(ringOf(null, null, 30, NOW)).toBe('mentions')
    expect(ringOf('mentions', null, 3, NOW)).toBe('mentions')
    expect(ringOf('nothing', null, 3, NOW)).toBe('off')
    expect(ringOf('all', NOW + 1, 3, NOW)).toBe('off')
    expect(ringOf('all', NOW - 1, 3, NOW)).toBe('all')
  })
})

describe('mutedUntil', () => {
  it('ends a mute after its hours, or never', () => {
    expect(mutedUntil(8, NOW)).toBe(NOW + 8 * 3_600_000)
    expect(mutedUntil(null, NOW)).toBe(MUTED_FOR_GOOD)
  })
})
