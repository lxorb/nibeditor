import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SEARCH } from './typed'
import { engineById, engineHome, enginesFor, isEngineAddress } from './engines'

describe("Chrome's list", () => {
  test('starts with Google, the default', () => {
    expect(enginesFor('en-US')[0]).toEqual({ id: 'google', name: 'Google', url: SEARCH })
  })

  test('offers the engines Chrome offers everywhere', () => {
    const ids = enginesFor('de-CH').map((one) => one.id)
    for (const id of ['google', 'bing', 'duckduckgo', 'ecosia', 'brave', 'startpage']) {
      expect(ids).toContain(id)
    }
    expect(ids).not.toContain('naver')
  })

  test("adds a region's own", () => {
    expect(enginesFor('ko-KR').map((one) => one.id)).toContain('naver')
    expect(enginesFor('zh-CN').map((one) => one.id)).toContain('baidu')
    expect(enginesFor('ja').map((one) => one.id)).toContain('yahoo-jp')
  })

  test('every engine searches the web, with somewhere for the words', () => {
    for (const one of enginesFor('zh')) expect(isEngineAddress(one.url)).toBe(true)
    for (const one of enginesFor('ko')) expect(isEngineAddress(one.url)).toBe(true)
  })

  test('a choice made elsewhere is still found here', () => {
    expect(engineById('naver')?.name).toBe('NAVER')
    expect(engineById('nothing')).toBeNull()
  })
})

/** Where a new web note lands (#354): the engine's own page, which is the root of the
 *  address its search goes to. */
describe("the engine's own page", () => {
  test('is the front door of the engine, not a search for nothing', () => {
    expect(engineHome(SEARCH)).toBe('https://www.google.com/')
    expect(engineHome('https://duckduckgo.com/?q=%s')).toBe('https://duckduckgo.com/')
    expect(engineHome('https://search.brave.com/search?q=%s')).toBe('https://search.brave.com/')
  })

  test('every engine on the list has one, and it is an address a tab may open', () => {
    for (const language of ['en-US', 'zh', 'ja', 'ko', 'ru']) {
      for (const one of enginesFor(language)) {
        const home = engineHome(one.url)
        expect(home, one.id).toMatch(/^https:\/\//)
        expect(home, one.id).not.toContain('%s')
      }
    }
  })

  test('a custom engine has one too', () => {
    expect(engineHome('https://kagi.com/search?q=%s')).toBe('https://kagi.com/')
  })

  /** Nothing can reach this - a custom engine is an address before it is kept - but a
   *  new tab with nowhere to go is worse than a new tab on Google. */
  test('falls back to the default engine for an address that cannot be read', () => {
    expect(engineHome('not an address')).toBe('https://www.google.com/')
  })
})

describe('a custom engine', () => {
  test('needs %s and the web', () => {
    expect(isEngineAddress('https://kagi.com/search?q=%s')).toBe(true)
    expect(isEngineAddress('https://kagi.com/search?q=')).toBe(false)
    expect(isEngineAddress('javascript:alert(%s)')).toBe(false)
    expect(isEngineAddress('file:///%s')).toBe(false)
  })
})

describe('the choice', () => {
  beforeEach(() => {
    // Node has no storage; this one outlives a module read again, which is a restart.
    const kept = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
      removeItem: (key: string) => void kept.delete(key),
    })
    vi.resetModules()
  })

  test('is Google until somebody chooses', async () => {
    const { searchEngine } = await import('./search-engine.svelte')
    expect(searchEngine.url).toBe(SEARCH)
  })

  test("carries the engine's own page, which is where a new web note lands", async () => {
    const { searchEngine } = await import('./search-engine.svelte')
    expect(searchEngine.home).toBe('https://www.google.com/')
    searchEngine.choose('qwant')
    expect(searchEngine.home).toBe('https://www.qwant.com/')
  })

  test('is kept, and read back', async () => {
    const first = await import('./search-engine.svelte')
    first.searchEngine.choose('duckduckgo')
    vi.resetModules()
    const again = await import('./search-engine.svelte')
    expect(again.searchEngine.url).toBe('https://duckduckgo.com/?q=%s')
  })

  test('a custom address is chosen as it is written, and a bad one changes nothing', async () => {
    const { searchEngine, CUSTOM } = await import('./search-engine.svelte')
    expect(searchEngine.setCustom('not an engine')).toBe(false)
    expect(searchEngine.id).toBe('google')
    // Custom with nothing written is not a choice.
    searchEngine.choose(CUSTOM)
    expect(searchEngine.id).toBe('google')

    expect(searchEngine.setCustom(' https://kagi.com/search?q=%s ')).toBe(true)
    expect(searchEngine.id).toBe(CUSTOM)
    expect(searchEngine.url).toBe('https://kagi.com/search?q=%s')

    // Kept while another is chosen, so going back finds it.
    searchEngine.choose('bing')
    searchEngine.choose(CUSTOM)
    expect(searchEngine.url).toBe('https://kagi.com/search?q=%s')
  })
})
