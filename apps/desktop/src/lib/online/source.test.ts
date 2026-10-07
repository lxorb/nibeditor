import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ServerFrame } from '@nib/online/wire'
import type { Said } from '../terminal/source'
import { termSession } from './calls'
import { OnlineSource } from './source'

/** The seams a start goes through under v2: the file's words, sync's id for it, the
 *  account's answer, and the write - the socket itself stays shut. */
const seen = vi.hoisted((): { words: string | null; written: string[] } => ({
  words: '',
  written: [],
}))

vi.mock('../account.svelte', () => ({ account: { accountToken: 'token' } }))
vi.mock('../sync.svelte', () => ({ sync: { version: 2 } }))
vi.mock('../sync2/runner.svelte', () => ({
  runner: {
    engine: { entryAt: () => ({ id: 'file-1' }) },
    kick: () => undefined,
    wrote: () => Promise.resolve(),
  },
}))
vi.mock('../tauri', async (real) => ({
  ...(await real<typeof import('../tauri')>()),
  invoke: () => Promise.resolve(seen.words),
}))
vi.mock('../workspace/write-file', () => ({
  writeFile: (_path: string, text: string) => {
    seen.written.push(text)
    return Promise.resolve()
  },
}))
vi.mock('./calls', async (real) => ({
  ...(await real<typeof import('./calls')>()),
  termSession: vi.fn(),
}))
vi.mock('./link', async (real) => ({
  ...(await real<typeof import('./link')>()),
  Link: class {
    open(): void {
      // The socket stays shut here.
    }
    close(): void {
      // Nothing was opened.
    }
  },
}))

const source = () =>
  new OnlineSource(
    () => '/space/Terminal.term',
    () => Promise.resolve('device'),
    { tab: () => 't1', front: () => true, offer: () => undefined },
    { pages: false, native: false },
  )

/** What the socket's frames become for the terminal, read off the source's own seam. */
function hearing(frame: ServerFrame): Said[] {
  const said: Said[] = []
  ;(source() as unknown as { heard(frame: ServerFrame, said: (what: Said) => void): void }).heard(
    frame,
    (what) => said.push(what),
  )
  return said
}
describe('an online source told it is refused', () => {
  test('a session that is gone is said as gone, which only a new terminal answers', () => {
    expect(hearing({ t: 'refused', error: 'gone' })).toEqual([
      { refused: 'This terminal is gone', gone: true },
    ])
  })

  test('any other refusal is its words alone', () => {
    expect(hearing({ t: 'refused', error: 'allowance' })).toEqual([
      { refused: 'This month’s online hours are used' },
    ])
    expect(hearing({ t: 'refused', error: 'role' })).toEqual([{ typing: false }])
  })
})

/** 2026-10-07: a `.term` made on sync v1 opened under v2 with a new shell beside its old
 *  one, which went on counting toward the eight. */
describe('an online source starting under v2', () => {
  const asked = vi.mocked(termSession)
  const OLD = '{"v":1,"machine":"m1","session":"s_old"}\n'

  beforeEach(() => {
    asked.mockReset()
    seen.written = []
  })

  test('asks by the file’s id with the session its words name, and leaves them', async () => {
    seen.words = OLD
    asked.mockResolvedValue({ v: 1, machine: 'm1', session: 's_old' })
    await source().start(80, 24, () => undefined)
    expect(asked).toHaveBeenCalledWith('file-1', 's_old')
    expect(seen.written).toEqual([])
  })

  test('writes the session the account answered where the words name another, or none', async () => {
    seen.words = OLD
    asked.mockResolvedValue({ v: 1, machine: 'm1', session: 's_new' })
    await source().start(80, 24, () => undefined)
    seen.words = ''
    await source().start(80, 24, () => undefined)
    expect(asked).toHaveBeenLastCalledWith('file-1', undefined)
    expect(seen.written).toEqual([
      '{"v":1,"machine":"m1","session":"s_new"}\n',
      '{"v":1,"machine":"m1","session":"s_new"}\n',
    ])
  })

  test('writes nothing into a file it could not read', async () => {
    seen.words = null
    asked.mockResolvedValue({ v: 1, machine: 'm1', session: 's_new' })
    await source().start(80, 24, () => undefined)
    expect(seen.written).toEqual([])
  })
})
