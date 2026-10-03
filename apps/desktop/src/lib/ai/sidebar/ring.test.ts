/** The ring's bands. */

import { describe, expect, test } from 'vitest'
import type { Turn } from '../chat/types'
import { noUsage } from '../chat/usage'
import { attachedIn, bandsOf } from './ring'

describe('the ring', () => {
  test('fits what nib sent inside the provider’s own count', () => {
    const usage = { ...noUsage(100_000), input: 40_000, output: 2_000 }
    const bands = bandsOf(usage, 100_000, 'x'.repeat(4_000), 5_000, 1_000)
    expect(bands.used).toBe(42_000)
    expect(bands.instructions).toBe(1_000)
    expect(bands.attached).toBe(5_000)
    expect(bands.conversation).toBe(36_000)
    expect(bands.fraction).toBeCloseTo(0.43)
    expect(bands.warn).toBe(false)
    expect(bands.compacts).toBe(80_000)
  })

  test('warns past four fifths, with the next message counted', () => {
    const usage = { ...noUsage(10_000), input: 7_000, output: 500 }
    expect(bandsOf(usage, 10_000, '', 0, 900).warn).toBe(true)
  })

  test('draws no circle against a window nobody said', () => {
    const bands = bandsOf({ ...noUsage(null), input: 10 }, null, '', 0, 5)
    expect(bands.fraction).toBeNull()
    expect(bands.compacts).toBeNull()
  })

  test('counts what went with the messages since the last compaction', () => {
    const turns: Turn[] = ['a', 'b'].map((id) => ({
      id,
      role: 'you',
      at: 0,
      parts: [],
      draft: { text: '', attachments: [{ label: 'n', text: 'x'.repeat(400) }] },
    }))
    expect(attachedIn(turns)).toBeGreaterThan(attachedIn(turns, 'a'))
    expect(attachedIn(turns, 'b')).toBe(0)
  })
})
