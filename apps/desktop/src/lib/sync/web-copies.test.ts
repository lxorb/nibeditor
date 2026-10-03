import { describe, expect, test } from 'vitest'
import { copiedFrom } from './web-copies'

describe('the note a web note’s copy was made of', () => {
  test('is the name with every stamp taken off', () => {
    expect(copiedFrom('/S/Docs (from another device 2026-10-01).url')).toBe('/S/Docs.url')
    expect(copiedFrom('/S/Docs (from another device 2026-10-01) 3.url')).toBe('/S/Docs.url')
    expect(
      copiedFrom('/S/Docs (from another device 2026-09-30) (from another device 2026-10-01).url'),
    ).toBe('/S/Docs.url')
  })

  test('is nothing for a web note that is not a copy, or a copy that is not a web note', () => {
    expect(copiedFrom('/S/Docs 2.url')).toBeNull()
    expect(copiedFrom('/S/Plan (from another device 2026-10-01).md')).toBeNull()
  })
})
