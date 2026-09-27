import { describe, expect, test } from 'vitest'
import { movedOn } from './used'

describe('movedOn', () => {
  test('nothing counts before the first load has landed', () => {
    expect(movedOn(null, 'https://example.com/')).toBe(false)
    expect(movedOn(null, 'https://example.com/elsewhere')).toBe(false)
  })

  test('the page where it landed is still only being looked at', () => {
    expect(movedOn('https://www.example.com/en/', 'https://www.example.com/en/')).toBe(false)
  })

  test('a fragment written while scrolling is not a move', () => {
    expect(movedOn('https://example.com/docs', 'https://example.com/docs#install')).toBe(false)
    expect(movedOn('https://example.com/docs#a', 'https://example.com/docs#b')).toBe(false)
  })

  test('another page is', () => {
    expect(movedOn('https://example.com/', 'https://example.com/about')).toBe(true)
    expect(movedOn('https://example.com/', 'https://example.com/?q=search')).toBe(true)
    expect(movedOn('https://example.com/', 'https://other.org/')).toBe(true)
  })

  test('with no address at all there is nothing to have moved to', () => {
    expect(movedOn('https://example.com/', null)).toBe(false)
  })
})
