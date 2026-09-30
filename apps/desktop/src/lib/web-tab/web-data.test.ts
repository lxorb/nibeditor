import { getDomain } from 'tldts'
import { describe, expect, test, vi } from 'vitest'
import { historyKey, hostOf, isWebData, siteOf, spaceOf, storeName, WEB_DATA } from './web-data'

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

describe('the history a space offers', () => {
  test('global shares the one list; apart is a list of the space’s own', () => {
    expect(historyKey('global', '0-a')).toBe('nib:web-visits')
    expect(historyKey('space', '0-a')).toBe('nib:web-visits:0-a')
    expect(historyKey('site', '0-a')).toBe('nib:web-visits:0-a')
    expect(historyKey('space', null)).toBe('nib:web-visits')
  })
})

describe('which space a page is in', () => {
  const spaces = [
    { id: 'w', root: 'C:\\Users\\me\\Documents\\Nib\\Work' },
    { id: 'wx', root: 'C:\\Users\\me\\Documents\\Nib\\Work extra' },
    { id: 'h', root: '/home/me/Nib/Home/' },
  ]

  test('the space whose folder holds the note', () => {
    expect(spaceOf('C:\\Users\\me\\Documents\\Nib\\Work\\Moodle.url', spaces, 'h')).toBe('w')
    expect(spaceOf('C:/Users/me/Documents/Nib/Work extra/a/Site.url', spaces, 'h')).toBe('wx')
    expect(spaceOf('/home/me/Nib/Home/Site.url', spaces, 'w')).toBe('h')
  })

  test('a tab with no note, or a note outside every space, is in the open one', () => {
    expect(spaceOf(null, spaces, 'h')).toBe('h')
    expect(spaceOf('/elsewhere/Site.url', spaces, 'w')).toBe('w')
    expect(spaceOf(null, spaces, null)).toBeNull()
  })
})

test('the three, and nothing else', () => {
  expect(WEB_DATA).toEqual(['global', 'space', 'site'])
  expect(WEB_DATA.every(isWebData)).toBe(true)
  expect(isWebData('host')).toBe(false)
})

describe('the choice each space has made', () => {
  test('global until asked, kept by id, and put back by choosing global again', async () => {
    const { webData } = await import('./web-data.svelte')

    expect(webData.of('0-k3j9x2')).toBe('global')
    expect(await webData.store('0-k3j9x2', 'https://moodle-app2.let.ethz.ch')).toBeNull()

    webData.set('0-k3j9x2', 'site')
    expect(webData.of('0-k3j9x2')).toBe('site')
    expect(webData.of('1-other')).toBe('global')
    expect(await webData.store('0-k3j9x2', 'https://moodle-app2.let.ethz.ch/my')).toBe(
      'site_0-k3j9x2_ethz.ch',
    )
    expect(webData.history('0-k3j9x2')).toBe('nib:web-visits:0-k3j9x2')
    expect(JSON.parse(localStorage.getItem('nib:web-data') ?? '{}')).toEqual({ '0-k3j9x2': 'site' })

    webData.set('0-k3j9x2', 'space')
    expect(await webData.store('0-k3j9x2', 'https://ethz.ch')).toBe('space_0-k3j9x2')

    webData.set('0-k3j9x2', 'global')
    expect(webData.of('0-k3j9x2')).toBe('global')
    expect(JSON.parse(localStorage.getItem('nib:web-data') ?? '{}')).toEqual({})
  })
})

/** While web logins travel, the choice is the space's on the account: every computer
 *  puts the space's pages in the same store. See docs/sync-v2.md section 6.1. */
describe('the choice on the account', () => {
  test('is the one that counts, is written there, and a device’s own goes up once', async () => {
    const { webData } = await import('./web-data.svelte')
    localStorage.clear()
    webData.set('mine-1', 'site')
    webData.set('local-1', 'space')

    const written: [string, string][] = []
    const writeUp = (space: string, choice: string) => {
      written.push([space, choice])
      return Promise.resolve()
    }

    const changed = webData.follow(
      [
        { id: 'mine-1', role: 'owner', webStore: 'global' },
        { id: 'theirs-1', role: 'write', webStore: 'space' },
      ],
      writeUp,
    )

    // This device's choice for a space the account kept on Global goes up, once.
    expect(written).toEqual([['mine-1', 'site']])
    expect(webData.of('mine-1')).toBe('site')
    // Somebody else's space is in the store its owner chose, on every computer.
    expect(webData.of('theirs-1')).toBe('space')
    expect(changed).toEqual(['theirs-1'])
    // A space the account does not have goes by the device, as it always did.
    expect(webData.of('local-1')).toBe('space')

    // Chosen again on this computer: written to the account, not to the device.
    webData.set('mine-1', 'global')
    expect(written.at(-1)).toEqual(['mine-1', 'global'])
    expect(webData.of('mine-1')).toBe('global')

    // Listed again with the account's own word: nothing goes up a second time.
    written.length = 0
    webData.follow([{ id: 'mine-1', role: 'owner', webStore: 'global' }], writeUp)
    expect(written).toEqual([])

    webData.unfollow()
    expect(webData.of('mine-1')).toBe('site')
  })
})
