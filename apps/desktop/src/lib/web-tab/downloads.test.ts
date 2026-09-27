/** What the bar knows about the files the web tabs saved.
 *
 *  The crate reports each download whole, every time it starts, moves or ends, and the
 *  reports can cross: a word about how far a file had got can arrive after the word that
 *  it is done. The list has to end on what actually happened. See downloads.svelte.ts. */

import { expect, test, vi } from 'vitest'

const asked: { command: string; id: unknown }[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    asked.push({ command, id: args.id })
    return Promise.resolve(undefined)
  },
}))

const { downloads, merged, progressOf, readDownload } = await import('./downloads.svelte')
type Download = NonNullable<ReturnType<typeof readDownload>>

function one(id: number, change: Partial<Download> = {}): Download {
  return {
    id,
    tab: 'tab-1',
    url: `https://moodle.example/pluginfile.php/${String(id)}/slides.pdf`,
    name: `slides (${String(id)}).pdf`,
    state: 'going',
    received: 0,
    total: null,
    ...change,
  }
}

test('what the crate sends is read, and nothing else is', () => {
  expect(
    readDownload({
      id: 3,
      tab: 't',
      url: 'https://a.example/f',
      name: 'f.pdf',
      state: 'done',
      received: 10,
      total: 10,
    }),
  ).toEqual({
    id: 3,
    tab: 't',
    url: 'https://a.example/f',
    name: 'f.pdf',
    state: 'done',
    received: 10,
    total: 10,
  })

  // A size the server never said is no size, not a size of nought.
  expect(
    readDownload({ id: 1, tab: 't', url: 'u', name: 'n', state: 'going', total: null })?.total,
  ).toBeNull()
  expect(readDownload({ id: 1, tab: 't', url: 'u', name: 'n', state: 'lost' })).toBeNull()
  expect(readDownload({ id: '1', tab: 't', url: 'u', name: 'n', state: 'done' })).toBeNull()
  expect(readDownload(null)).toBeNull()
  expect(readDownload('done')).toBeNull()
})

test('a new download goes at the end and a known one stays where it is', () => {
  const list = merged(merged([], one(1)), one(2))
  expect(list.map((each) => each.id)).toEqual([1, 2])

  const moved = merged(list, one(1, { received: 5, total: 10 }))
  expect(moved.map((each) => each.id)).toEqual([1, 2])
  expect(moved[0]?.received).toBe(5)
})

test('the end of a download is the last word about it', () => {
  const done = merged([one(1)], one(1, { state: 'done', received: 10, total: 10 }))
  const late = merged(done, one(1, { received: 7, total: 10 }))

  expect(late[0]?.state).toBe('done')
  expect(late[0]?.received).toBe(10)
})

test('a download the reader stopped leaves the list', () => {
  const list = merged([one(1), one(2)], one(1, { state: 'cancelled' }))
  expect(list.map((each) => each.id)).toEqual([2])
})

test('the ring says how far everything still going has got', () => {
  expect(progressOf([])).toBeNull()
  expect(progressOf([one(1, { state: 'done', total: 5, received: 5 })])).toBeNull()
  expect(progressOf([one(1)])).toBe('unknown')
  expect(
    progressOf([
      one(1, { received: 1, total: 4 }),
      one(2, { received: 3, total: 4 }),
      one(3, { state: 'done', received: 100, total: 100 }),
    ]),
  ).toBe(0.5)
})

test('the store says which report is a download starting', () => {
  expect(downloads.heard(one(10))).toBe(true)
  expect(downloads.heard(one(10, { received: 4, total: 8 }))).toBe(false)
  expect(downloads.list.find((each) => each.id === 10)?.received).toBe(4)
})

test('a row goes back to the crate by id, never by a path', async () => {
  await downloads.open(4)
  await downloads.show(4)
  await downloads.cancel(4)

  expect(asked).toEqual([
    { command: 'web_download_open', id: 4 },
    { command: 'web_download_show', id: 4 },
    { command: 'web_download_cancel', id: 4 },
  ])
})
