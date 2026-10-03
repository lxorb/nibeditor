/** The ring's numbers: the providers' own counts, the ≈ estimate, where it compacts. */

import { describe, expect, test } from 'vitest'
import {
  anthropicUsage,
  compactionSpent,
  compactsAt,
  completionsUsage,
  estimate,
  estimateText,
  filled,
  fraction,
  responsesUsage,
  shouldCompact,
  warns,
} from './usage'

describe('the providers’ counts', () => {
  test('Claude’s input is its uncached, cache-read and cache-written tokens together', () => {
    expect(
      anthropicUsage(
        {
          input_tokens: 10,
          cache_read_input_tokens: 900,
          cache_creation_input_tokens: 90,
          output_tokens: 5,
        },
        200_000,
      ),
    ).toEqual({ input: 1_000, cached: 900, output: 5, reasoning: 0, window: 200_000 })
  })

  test('what Claude spent compacting is its iterations, not its top level', () => {
    expect(
      compactionSpent({
        input_tokens: 0,
        iterations: [
          { type: 'compaction', input_tokens: 180_000, output_tokens: 3_500 },
          { type: 'message', input_tokens: 23_000, output_tokens: 1_000 },
        ],
      }),
    ).toEqual({ input: 180_000, output: 3_500 })
  })

  test('OpenAI’s shapes, cached and reasoning tokens included', () => {
    expect(
      responsesUsage(
        {
          input_tokens: 129,
          input_tokens_details: { cached_tokens: 64 },
          output_tokens: 20,
          output_tokens_details: { reasoning_tokens: 8 },
        },
        null,
      ),
    ).toEqual({ input: 129, cached: 64, output: 20, reasoning: 8, window: null })
    expect(completionsUsage({ prompt_tokens: 51, completion_tokens: 47 }, 8_192)).toEqual({
      input: 51,
      cached: 0,
      output: 47,
      reasoning: 0,
      window: 8_192,
    })
  })
})

describe('the ring', () => {
  test('is filled by what was sent and what came back, against a window somebody said', () => {
    const usage = { input: 400_000, cached: 0, output: 12_000, reasoning: 0, window: 1_000_000 }
    expect(filled(usage)).toBe(412_000)
    expect(fraction(usage)).toBeCloseTo(0.412)
    expect(fraction({ ...usage, window: null })).toBeNull()
    expect(warns(usage)).toBe(false)
    expect(warns(usage, 400_000)).toBe(true)
  })

  test('compacts at Claude Code’s 967K of 1M, a fifth below a small window, as set, or never', () => {
    expect(compactsAt(1_000_000)).toBe(967_000)
    expect(compactsAt(8_000)).toBe(6_400)
    expect(compactsAt(null)).toBeNull()
    expect(compactsAt(200_000, 100_000)).toBe(100_000)
    expect(compactsAt(200_000, 'off')).toBeNull()
  })

  test('the next send compacts first when it would pass the tick, and not on a fresh thread', () => {
    const near = { input: 960_000, cached: 0, output: 5_000, reasoning: 0, window: 1_000_000 }
    expect(shouldCompact(near, 3_000)).toBe(true)
    expect(shouldCompact(near, 1_000)).toBe(false)
    expect(shouldCompact(near, 3_000, 'off')).toBe(false)
    expect(shouldCompact({ ...near, input: 0, output: 0 }, 2_000_000)).toBe(false)
  })
})

describe('the estimate', () => {
  test('is about four characters a token, one a character where words have no spaces', () => {
    expect(estimateText('a'.repeat(400))).toBe(100)
    expect(estimateText('日本語の文章')).toBe(6)
  })

  test('counts the chips and a picture', () => {
    const plain = estimate({ text: 'a'.repeat(40), attachments: [] })
    const with_ = estimate({
      text: 'a'.repeat(40),
      attachments: [
        { label: 'n.md', text: 'b'.repeat(400) },
        { label: 'p', image: { mime: 'image/png', data: '' } },
      ],
    })
    expect(plain).toBe(10)
    expect(with_).toBeGreaterThan(plain + 100 + 1_500)
  })
})
