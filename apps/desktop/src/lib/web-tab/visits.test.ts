import { describe, expect, test } from 'vitest'
import {
  MOST_VISITS,
  named,
  typedTo,
  unvisited,
  visitKey,
  visited,
  visitsFrom,
  type Visit,
} from './visits'

const NOW = Date.UTC(2026, 8, 27)

describe('the address a row is kept under', () => {
  test('is the page without its fragment', () => {
    expect(visitKey('https://svelte.dev/docs#runes')).toBe('https://svelte.dev/docs')
    expect(visitKey('https://svelte.dev')).toBe('https://svelte.dev/')
  })

  test('and nothing a web tab would not open', () => {
    expect(visitKey('javascript:alert(1)')).toBe(null)
    expect(visitKey('file:///C:/notes/a.md')).toBe(null)
    expect(visitKey('about:blank')).toBe(null)
    expect(visitKey(`https://example.com/?q=${'a'.repeat(3000)}`)).toBe(null)
  })
})

describe('a visit', () => {
  test('adds a row, then counts on it', () => {
    const once = visited([], 'https://example.com/a', 'A', NOW)
    const twice = visited(once, 'https://example.com/a#b', '', NOW + 5)

    expect(twice).toEqual([
      { url: 'https://example.com/a', title: 'A', visits: 2, typed: 0, last: NOW + 5 },
    ])
  })

  test('typed is counted apart, and is not a visit', () => {
    const list = typedTo([], 'https://example.com/', NOW)
    expect(list).toEqual([
      { url: 'https://example.com/', title: '', visits: 0, typed: 1, last: NOW },
    ])
  })

  test('a title arriving later renames the row and counts nothing', () => {
    const list = visited([], 'https://example.com/', '', NOW)
    const said = named(list, 'https://example.com/', '  Example  ')

    expect(said[0]).toMatchObject({ title: 'Example', visits: 1 })
    expect(named(said, 'https://example.com/', 'Example')).toBe(said)
    expect(named(said, 'https://elsewhere.example/', 'Else')).toBe(said)
  })

  test('Shift+Delete takes a row out', () => {
    const list = visited([], 'https://example.com/', '', NOW)
    expect(unvisited(list, 'https://example.com/')).toEqual([])
  })

  test('the list is bounded, and the least recently open goes first', () => {
    let list: readonly Visit[] = []
    for (let index = 0; index <= MOST_VISITS; index++) {
      list = visited(list, `https://site${index}.example/`, '', NOW + index)
    }

    expect(list).toHaveLength(MOST_VISITS)
    expect(list.some((one) => one.url === 'https://site0.example/')).toBe(false)
    expect(list.some((one) => one.url === `https://site${MOST_VISITS}.example/`)).toBe(true)
  })
})

describe('what an earlier run wrote down', () => {
  test('keeps the rows it can read and drops the rest', () => {
    const read = visitsFrom([
      { url: 'https://example.com/', title: 'Ex', visits: 2, typed: 1, last: NOW },
      { url: 'javascript:alert(1)', title: '', visits: 1, typed: 0, last: NOW },
      { url: 'https://example.org/', visits: 'many', typed: 0, last: NOW },
      'nonsense',
    ])

    expect(read).toEqual([
      { url: 'https://example.com/', title: 'Ex', visits: 2, typed: 1, last: NOW },
    ])
  })

  test('and reads nothing from nothing', () => {
    expect(visitsFrom(null)).toEqual([])
    expect(visitsFrom({ url: 'https://example.com/' })).toEqual([])
  })
})
