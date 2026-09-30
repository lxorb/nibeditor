import { describe, expect, test } from 'vitest'
import { showDelay, siteOf, spot, whereOf } from './card'
import { WIDTH } from './layout'

describe("the card's wait", () => {
  test("is Chrome's 300 ms while the tabs are no wider than a pinned one", () => {
    expect(showDelay(WIDTH.pinned)).toBe(300)
    expect(showDelay(20)).toBe(300)
  })

  test('grows on a logarithmic scale towards 800 ms, fastest at the narrow end', () => {
    const narrow = showDelay(WIDTH.pinned + 20) - showDelay(WIDTH.pinned)
    const wide = showDelay(200) - showDelay(180)
    expect(narrow).toBeGreaterThan(wide)
    expect(showDelay(WIDTH.standard - 1)).toBeLessThanOrEqual(800)
    expect(showDelay(WIDTH.standard - 1)).toBeGreaterThan(780)
  })

  test('and half a second more once every name is whole on its tab', () => {
    expect(showDelay(WIDTH.standard)).toBe(1300)
  })
})

describe("the card's place", () => {
  const anchor = { left: 100, right: 300, bottom: 38 }

  test('is under the tab, from its leading edge', () => {
    expect(spot(anchor, 256, 1200, 1)).toEqual({ x: 100, y: 42 })
  })

  test('from its trailing edge in a language that reads the other way', () => {
    expect(spot(anchor, 256, 1200, -1)).toEqual({ x: 44, y: 42 })
  })

  test('and inside the window', () => {
    expect(spot({ left: 1100, right: 1190, bottom: 38 }, 256, 1200, 1).x).toBe(936)
    expect(spot({ left: 2, right: 60, bottom: 38 }, 256, 1200, -1).x).toBe(8)
  })
})

describe('what the card says a page is on', () => {
  test('is the host, without the www nobody reads', () => {
    expect(siteOf('https://www.example.com/a/b?c')).toBe('example.com')
    expect(siteOf('http://news.ycombinator.com/')).toBe('news.ycombinator.com')
  })

  test('and nothing for what is not a site', () => {
    expect(siteOf(null)).toBe('')
    expect(siteOf('about:blank')).toBe('')
    expect(siteOf('not an address')).toBe('')
  })
})

describe('where the card says a file lives', () => {
  const spaces = [
    { name: 'Work', root: 'C:\\Spaces\\Work' },
    { name: 'Home', root: '/home/me/Spaces/Home' },
  ]

  test('is its space and the folders down to it', () => {
    expect(whereOf('C:\\Spaces\\Work\\Projects\\2026\\Plan.md', spaces)).toBe(
      'Work / Projects / 2026',
    )
    expect(whereOf('/home/me/Spaces/Home/List.md', spaces)).toBe('Home')
  })

  test('and nothing for a file in no space', () => {
    expect(whereOf('D:\\Downloads\\x.md', spaces)).toBe('')
    expect(whereOf(null, spaces)).toBe('')
  })
})
