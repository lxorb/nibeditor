import { describe, expect, test } from 'vitest'

import { readZenSession } from './zen'
import { SIDEBAR } from './zen.fixture'

describe("Zen's sidebar", () => {
  test('lists the spaces in the order the switcher shows them', () => {
    const session = readZenSession(SIDEBAR)
    expect(session?.spaces.map((one) => [one.name, one.icon, one.colour])).toEqual([
      ['Home', '🏡', null],
      ['Work', 'chrome://browser/skin/zen-icons/selectable/briefcase.svg', [53, 132, 228]],
      ['Reading', null, null],
    ])
  })

  test('keeps every tab with a page, in order, and none of the stand-ins', () => {
    const tabs = readZenSession(SIDEBAR)?.tabs ?? []
    expect(tabs.map((one) => one.title)).toEqual([
      'Mail',
      'News today',
      'The guide',
      'API: reference',
      'Left',
      'Right',
      'Board',
      'b - Search',
      'Settings',
    ])
  })

  test('reads what each tab is beyond its page', () => {
    const tabs = readZenSession(SIDEBAR)?.tabs ?? []
    const [mail, news] = tabs
    expect(mail).toMatchObject({ essential: true, pinned: true, space: null })
    expect(news).toMatchObject({
      url: 'https://news.example.com/today',
      home: 'https://news.example.com/',
      space: '{s-home}',
      pinned: true,
    })
    expect(tabs.find((one) => one.title === 'Board')?.container).toBe(2)
    expect(tabs.find((one) => one.title === 'b - Search')?.url).toBe(
      'https://search.example.com/?q=b',
    )
  })

  test('reads the folders, a split view among them', () => {
    const folders = readZenSession(SIDEBAR)?.folders ?? []
    expect(folders.map((one) => [one.id, one.parent, one.split])).toEqual([
      ['f-docs', null, false],
      ['f-api', 'f-docs', false],
      ['f-split', 'f-docs', true],
      ['f-later', null, false],
    ])
  })

  test("reads Firefox's session the same, each tab once and no private window", () => {
    const [mail, ...rest] = SIDEBAR.tabs
    const session = readZenSession({
      version: ['sessionrestore', 1],
      windows: [
        {
          isPrivate: true,
          spaces: [],
          tabs: [{ zenSyncId: 'secret', entries: [{ url: 'https://secret.example.com/' }] }],
        },
        {
          spaces: SIDEBAR.spaces,
          folders: SIDEBAR.folders,
          tabs: [{ ...mail, entries: [] }, ...rest],
        },
        { tabs: [mail] },
      ],
    })

    expect(session?.spaces).toHaveLength(3)
    expect(session?.tabs.map((one) => one.title)[0]).toBe('Mail')
    expect(session?.tabs.filter((one) => one.title === 'Mail')).toHaveLength(1)
    expect(session?.tabs.some((one) => one.url.includes('secret'))).toBe(false)
  })

  test('is nothing where there are no spaces', () => {
    expect(readZenSession({ windows: [{ tabs: SIDEBAR.tabs }] })).toBeNull()
    expect(readZenSession({ spaces: [] })).toBeNull()
    expect(readZenSession('nonsense')).toBeNull()
  })
})
