import { describe, expect, test } from 'vitest'

import { readShortcut } from '../web-tab/shortcut'
import { readZenSession, type ZenSession } from './zen'
import { SIDEBAR } from './zen.fixture'
import { zenImport } from './zen-plan'

const NOW = new Date('2026-10-13T08:00:00.000Z')

function session(): ZenSession {
  const read = readZenSession(SIDEBAR)
  if (!read) throw new Error('the fixture is a sidebar')
  return read
}

function spaces() {
  return zenImport(session(), NOW).spaces
}

describe("Zen's spaces as nib's", () => {
  test('is a space for every Zen space, named, dressed and in order', () => {
    expect(spaces().map((one) => [one.name, one.icon, one.tint])).toEqual([
      ['Home', '🏡', null],
      ['Work', 'briefcase', 'blue'],
      ['Reading', null, null],
    ])
  })

  test('puts every tab where the sidebar has it, folders as folders', () => {
    const [, work, reading] = spaces()
    expect(work?.files.map((one) => one.path)).toEqual([
      'Docs/The guide.url',
      'Docs/API/API reference.url',
      'Docs/Left.url',
      'Docs/Right.url',
      'Board.url',
      'b - Search.url',
      'Later.md',
    ])
    expect(work?.order).toEqual({
      '': ['Docs', 'Board.url', 'b - Search.url', 'Later.md'],
      Docs: ['The guide.url', 'API', 'Left.url', 'Right.url'],
      'Docs/API': ['API reference.url'],
    })
    expect(work?.folderIcons).toEqual({ Docs: 'book' })
    expect(reading?.files).toEqual([])
  })

  test('makes an empty folder an empty note', () => {
    const later = spaces()[1]?.files.find((one) => one.path === 'Later.md')
    expect(later).toEqual({ kind: 'note', path: 'Later.md', text: '' })
  })

  test('makes each tab a web note: its page, where it was pinned, its mark as a picture', () => {
    const [home, work] = spaces()
    const news = home?.files.find((one) => one.path === 'News today.url')
    const mail = home?.files.find((one) => one.path === 'Mail.url')
    const guide = work?.files.find((one) => one.path === 'Docs/The guide.url')

    expect(news?.kind === 'note' && readShortcut(news.text)).toMatchObject({
      url: 'https://news.example.com/today',
      home: 'https://news.example.com/',
      title: 'News today',
      // An address of a mark would be a request to the site at every launch.
      icon: null,
      added: NOW.toISOString(),
    })
    expect(mail?.kind === 'note' && readShortcut(mail.text)?.icon).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
    expect(guide?.kind === 'note' && readShortcut(guide.text)?.title).toBe('The guide')
  })

  test('makes the Essentials bookmarks of the first space, at its top', () => {
    const [home, work] = spaces()
    expect(home?.bookmarks).toEqual(['Mail.url'])
    expect(home?.order['']).toEqual(['Mail.url', 'News today.url'])
    expect(work?.bookmarks).toEqual([])
  })

  test('leaves pages that are not on the web, and says containers stay', () => {
    const all = spaces().flatMap((one) => one.files.map((file) => file.path))
    expect(all.some((path) => path.startsWith('Settings'))).toBe(false)
    expect(zenImport(session(), NOW).lost).toEqual([{ text: 'Containers stay in Zen' }])
  })

  test('steps a name aside rather than writing one tab over another', () => {
    const read = session()
    const twice = {
      ...read,
      tabs: [...read.tabs, { ...read.tabs[6]!, url: 'https://board.example.com/2' }],
    }
    const work = zenImport(twice, NOW).spaces[1]
    expect(work?.order['']).toEqual([
      'Docs',
      'Board.url',
      'b - Search.url',
      'Board 2.url',
      'Later.md',
    ])
  })

  test('takes an Essential of a container to the first space of that container', () => {
    const read = session()
    const contained = {
      ...read,
      spaces: read.spaces.map((one) => (one.name === 'Work' ? { ...one, container: 3 } : one)),
      tabs: read.tabs.map((one) => (one.essential ? { ...one, container: 3 } : one)),
    }
    const [home, work] = zenImport(contained, NOW).spaces
    expect(home?.bookmarks).toEqual([])
    expect(work?.bookmarks).toEqual(['Mail.url'])
  })
})
