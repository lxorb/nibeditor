/** The Ask panel's conversations, made threads. */

import { describe, expect, test } from 'vitest'
import { sourcesFor } from './citations'
import { oldSpaces, threadFromAsk } from './migrate'

describe('an Ask conversation', () => {
  test('becomes a thread whose answers still find what they cited', () => {
    const thread = threadFromAsk(
      [
        { role: 'you', text: 'Which way does a kestrel face?' },
        {
          role: 'model',
          text: 'Into the wind [1].',
          sources: [{ path: 'Hovering.md', name: 'Hovering', line: 14 }],
        },
        { role: 'model', text: '' },
        'not a turn',
      ],
      'space',
      'p',
      'm',
    )
    expect(thread?.title).toBe('Which way does a kestrel face?')
    expect(thread?.turns.map((one) => one.role)).toEqual(['you', 'model'])
    expect(sourcesFor(thread?.turns ?? [], 1).map((one) => one.name)).toEqual(['Hovering'])
  })

  test('is nothing where there was nothing', () => {
    expect(threadFromAsk([], 's', 'p', 'm')).toBeNull()
    expect(threadFromAsk('junk', 's', 'p', 'm')).toBeNull()
    expect(oldSpaces({ spaces: { a: [] } })).toEqual({ a: [] })
    expect(oldSpaces(null)).toEqual({})
  })
})
