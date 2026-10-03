import { beforeEach, describe, expect, test, vi } from 'vitest'
import { SEARCH } from './address'
import { engineById, enginesFor, isEngineAddress } from './engines'

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
