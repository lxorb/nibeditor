import { describe, expect, test } from 'vitest'
import { dotCom, isWebAddress, plainOrigin, webAddress } from './address'

/** Ctrl+Enter in the address field, which every browser has had for thirty years. */
describe('the dot-com press', () => {
  test('makes one word a site', () => {
    expect(dotCom('svelte')).toBe('https://www.svelte.com')
    expect(dotCom('  example  ')).toBe('https://www.example.com')
  })

  test('leaves anything that already reads as an address to the ordinary press', () => {
    expect(dotCom('svelte.dev')).toBe(null)
    expect(dotCom('https://svelte.dev')).toBe(null)
    expect(dotCom('localhost:1425')).toBe(null)
    expect(dotCom('svelte docs')).toBe(null)
    expect(dotCom('a/b')).toBe(null)
    expect(dotCom('')).toBe(null)
  })
})

describe('what a web tab may open', () => {
  test('takes http and https', () => {
    expect(isWebAddress('https://example.com/a')).toBe(true)
    expect(isWebAddress('http://example.com')).toBe(true)
  })

  test('refuses every other scheme', () => {
    expect(isWebAddress('file:///C:/notes/Idea.md')).toBe(false)
    expect(isWebAddress('javascript:alert(1)')).toBe(false)
    expect(isWebAddress('data:text/html,<p>hi')).toBe(false)
    expect(isWebAddress('mailto:someone@example.com')).toBe(false)
    expect(isWebAddress('nib://open')).toBe(false)
  })

  /** A tab holding nib inside nib is a page whose script sits beside the app's. The
   *  crate says the same thing again on every navigation; see web_tabs.rs. */
  test('refuses the app itself', () => {
    expect(isWebAddress('http://tauri.localhost/index.html')).toBe(false)
    expect(isWebAddress('https://TAURI.localhost/')).toBe(false)
    expect(isWebAddress('http://ipc.localhost/x')).toBe(false)
    expect(isWebAddress('http://asset.localhost/a.png')).toBe(false)
  })

  test('refuses what is not an address at all', () => {
    expect(isWebAddress('')).toBe(false)
    expect(isWebAddress('example.com')).toBe(false)
  })
})

describe('what somebody typed', () => {
  test('nothing means nothing', () => {
    expect(webAddress('')).toBeNull()
    expect(webAddress('   ')).toBeNull()
  })

  test('an address is taken as written', () => {
    expect(webAddress('https://svelte.dev/docs')).toBe('https://svelte.dev/docs')
    expect(webAddress('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  test('a scheme no tab opens means nothing rather than a search', () => {
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('file:///etc/passwd')).toBeNull()
  })

  test('a host is given https', () => {
    expect(webAddress('svelte.dev')).toBe('https://svelte.dev')
    expect(webAddress('svelte.dev/docs?a=1#b')).toBe('https://svelte.dev/docs?a=1#b')
    expect(webAddress('localhost:1425')).toBe('https://localhost:1425')
    expect(webAddress('//svelte.dev')).toBe('https://svelte.dev')
  })

  test('words are a search', () => {
    expect(webAddress('svelte docs')).toBe('https://duckduckgo.com/?q=svelte%20docs')
    // One word with no dot is a word: a browser searches for `svelte` too.
    expect(webAddress('svelte')).toBe('https://duckduckgo.com/?q=svelte')
  })
})

describe('the origin, plainly', () => {
  test('is the host', () => {
    expect(plainOrigin('https://svelte.dev/docs/introduction')).toBe('svelte.dev')
    expect(plainOrigin('https://docs.example.org:8443/a')).toBe('docs.example.org:8443')
  })

  test('drops www, the way every browser does', () => {
    expect(plainOrigin('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
  })

  /** The one thing about an address worth warning somebody about. */
  test('says so when the page is not over https', () => {
    expect(plainOrigin('http://example.com/a')).toBe('http://example.com')
  })

  test('answers with what it was given when that is not an address', () => {
    expect(plainOrigin('not an address')).toBe('not an address')
  })
})
