import { getDomain } from 'tldts'
import { describe, expect, test, vi } from 'vitest'
import { hostOf, isWebData, siteOf, storeName, WEB_DATA } from './web-data'

/** Storage for the test, since node has none; what the app writes is read back from
 *  here. */
function memoryStorage(): Storage {
  const store = new Map<string, string>()

  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())

/** The public suffix list's answer, the way web-data.svelte.ts asks for it. */
const registrable = (host: string) => getDomain(host, { allowPrivateDomains: true })

const site = (url: string) => siteOf(hostOf(url) ?? '', registrable)

describe('what a site is', () => {
  test('a sign-in through a sister host stays one site', () => {
    // ETH's Moodle signs in at ETH's identity provider and comes back: one store.
    expect(site('https://moodle-app2.let.ethz.ch/my/')).toBe('ethz.ch')
    expect(site('https://aai-logon.ethz.ch/idp/profile/SAML2/Redirect/SSO')).toBe('ethz.ch')
  })

  test('the registrable domain, public suffixes and private ones alike', () => {
    expect(site('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
    expect(site('https://alice.github.io/')).toBe('alice.github.io')
    expect(site('https://bob.github.io/')).toBe('bob.github.io')
  })

  test('a host with no registrable domain is its own site', () => {
    expect(site('http://127.0.0.1:22300/app')).toBe('127.0.0.1')
    expect(site('http://localhost:1420/')).toBe('localhost')
  })

  test('an international name in the ASCII form the address spells it in', () => {
    expect(site('https://www.münchen.de/')).toBe('xn--mnchen-3ya.de')
  })

  test('only a web address has a host', () => {
    expect(hostOf('https://ethz.ch')).toBe('ethz.ch')
    expect(hostOf('file:///C:/notes/a.md')).toBeNull()
    expect(hostOf('not an address')).toBeNull()
    expect(hostOf(null)).toBeNull()
  })
})

describe('the name of a store', () => {
  test('global is the one every space shares', () => {
    expect(storeName('global', '0-k3j9x2', 'ethz.ch')).toBeNull()
  })

  test('a space of its own, named after its id', () => {
    expect(storeName('space', '0-k3j9x2', 'ethz.ch')).toBe('space_0-k3j9x2')
    expect(storeName('space', '0-k3j9x2', null)).toBe('space_0-k3j9x2')
  })

  test('a site within a space', () => {
    expect(storeName('site', '0-k3j9x2', 'ethz.ch')).toBe('site_0-k3j9x2_ethz.ch')
    expect(storeName('site', '1-aaaaaa', 'ethz.ch')).not.toBe(
      storeName('site', '0-k3j9x2', 'ethz.ch'),
    )
  })

  test('a page with no site is in the space’s own store', () => {
    expect(storeName('site', '0-k3j9x2', null)).toBe('space_0-k3j9x2')
  })

  test('only the characters the crate takes as a folder name', () => {
    expect(storeName('site', '0-K3/..', '[::1]')).toBe('site_0-k3-.._---1-')
    for (const choice of WEB_DATA) {
      const name = storeName(choice, 'Ab C', 'x y.z')
      if (name !== null) expect(name).toMatch(/^(space|site)_[a-z0-9._-]+$/)
    }
    expect(storeName('site', '0-a', 'a'.repeat(400))?.length).toBe(160)
  })

  test('the same name on every call, which is what keeps the cookies', () => {
    expect(storeName('site', '0-k3j9x2', site('https://moodle-app2.let.ethz.ch'))).toBe(
      storeName('site', '0-k3j9x2', site('https://aai-logon.ethz.ch')),
    )
  })
})

test('the three, and nothing else', () => {
  expect(WEB_DATA).toEqual(['global', 'space', 'site'])
  expect(WEB_DATA.every(isWebData)).toBe(true)
  expect(isWebData('host')).toBe(false)
})

describe('a web note’s own web data', () => {
  test('a note kept apart is in a store of its own, and every other page in the shared one', async () => {
    const { ownStore, webData } = await import('./web-data.svelte')
    expect(ownStore(null)).toBeNull()
    expect(ownStore('3f9a0c17e2b4d685')).toBe('note_3f9a0c17e2b4d685')
    expect(await webData.store(null)).toBeNull()
    expect(await webData.store('3f9a0c17e2b4d685')).toBe('note_3f9a0c17e2b4d685')
    expect(webData.history()).toBe('nib:web-visits')
  })

  test('a fresh id is sixteen hex digits, another each time, and a name the crate takes', async () => {
    const { freshOwn } = await import('./web-data.svelte')
    const one = freshOwn()
    expect(one).toMatch(/^[0-9a-f]{16}$/)
    expect(freshOwn()).not.toBe(one)
  })
})
