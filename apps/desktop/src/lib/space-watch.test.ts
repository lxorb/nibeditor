import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { SpaceChange, SpaceNews } from './space-watch'

/** What the watcher and the listing say, checked the way the crate says it
 *  (space_watch.rs, `what_the_window_is_told`), and the listing put back together from
 *  its chunks. */

interface Heard {
  onmessage: (message: unknown) => void
}

interface Bridge {
  /** What the crate sends down whichever channel a command was handed. */
  sent: unknown[]
  commands: { command: string; args: unknown }[]
  answer: unknown
}

const bridge = vi.hoisted((): Bridge => ({ sent: [], commands: [], answer: null }))

vi.mock('./native', () => ({
  Channel: class {
    onmessage: (message: unknown) => void = () => undefined
  },
  invoke: (command: string, args?: { listing?: Heard; news?: Heard }) => {
    bridge.commands.push({ command, args })
    const channel = args?.listing ?? args?.news
    for (const one of bridge.sent) channel?.onmessage(one)
    return Promise.resolve(bridge.answer)
  },
}))

const { fileIdentity, listingOf, newsOf, scanSpace, unwatchSpaces, watchSpaces } =
  await import('./space-watch')

beforeEach(() => {
  bridge.sent = []
  bridge.commands = []
  bridge.answer = null
})

const listed = { path: '/s/Plan.md', dir: false, size: 5, mtime: 1_700_000_000_000, id: '2a:1f' }

describe('what the watcher says', () => {
  test('every kind of change reads as itself', () => {
    const changes: SpaceChange[] = [
      { kind: 'created', ...listed },
      { kind: 'modified', ...listed, id: null },
      { kind: 'renamed', from: '/s/Old.md', ...listed },
      { kind: 'removed', path: '/s/Gone', dir: true, id: null },
    ]
    const news: SpaceNews = { root: '/s', changes, scan: false, gone: false }
    expect(newsOf(news)).toEqual(news)
  })

  test('is handed on checked, and what is odd is not handed on', async () => {
    const good: SpaceNews = { root: '/s', changes: [], scan: true, gone: false }
    bridge.sent = [good, { root: '/s' }]
    const heard: SpaceNews[] = []
    const odd = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await watchSpaces(['/s'], (news) => heard.push(news))
    expect(heard).toEqual([good])
    expect(odd).toHaveBeenCalledOnce()
    odd.mockRestore()
    expect(bridge.commands.map((one) => one.command)).toEqual(['space_watch'])

    await unwatchSpaces()
    expect(bridge.commands.at(-1)?.command).toBe('space_unwatch')
  })

  test('anything else is refused whole', () => {
    const base = { root: '/s', changes: [], scan: true, gone: false }
    expect(newsOf(base)).toEqual(base)
    expect(newsOf({ ...base, scan: 'yes' })).toBeNull()
    expect(newsOf({ ...base, changes: [{ kind: 'moved', ...listed }] })).toBeNull()
    expect(newsOf({ ...base, changes: [{ kind: 'renamed', ...listed }] })).toBeNull()
    expect(newsOf({ ...base, changes: [{ kind: 'created', ...listed, size: -1 }] })).toBeNull()
    expect(newsOf(null)).toBeNull()
    expect(listingOf({ listed: [listed, { path: 1 }], done: true })).toBeNull()
  })
})

describe('a listing', () => {
  test('is every chunk, in order, once the last one says done', async () => {
    const second = { ...listed, path: '/s/Idea.md' }
    bridge.sent = [
      { listed: [listed], done: false },
      { listed: [second], done: true },
    ]
    const heard: number[] = []

    const all = await scanSpace('/s', (chunk) => heard.push(chunk.length))
    expect(all).toEqual([listed, second])
    expect(heard).toEqual([1, 1])
    expect(bridge.commands.map((one) => one.command)).toEqual(['space_scan'])
  })

  test('that says something odd is refused', async () => {
    bridge.sent = [{ listed: 'nothing', done: true }]
    await expect(scanSpace('/s')).rejects.toThrow('odd')
  })
})

test('an identity is text, or nothing where nothing is', async () => {
  bridge.answer = '2a:1f'
  expect(await fileIdentity('/s/Plan.md')).toBe('2a:1f')
  bridge.answer = null
  expect(await fileIdentity('/s/Gone.md')).toBeNull()
  expect(bridge.commands.at(-1)).toEqual({ command: 'file_identity', args: { path: '/s/Gone.md' } })
})
