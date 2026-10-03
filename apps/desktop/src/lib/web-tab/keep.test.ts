/** The file keeping up with the page.
 *
 *  This is what makes reopening a web note open the page that was open rather than the
 *  site's front door, so the thing worth being sure of is what ends up in the file:
 *  `URL` moves, `Nib-Home` remembers where the note pointed, and `Nib-Added` is left
 *  exactly as it was - a day a note was made is not a day that changes. See keep.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

interface Call {
  path: string
  content: string
}

const written: Call[] = []
/** What the link index was told, so a row that draws the site's own mark can be
 *  shown to hear about it. */
const told: Call[] = []

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'write_note') {
      written.push({ path: String(args.path), content: String(args.content) })
    }
    return Promise.resolve(undefined)
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteSaved: (path: string, content: string) => told.push({ path, content }),
  },
}))

const { keepPage, keepNow } = await import('./keep')
const { SAVE_AT_MOST, SAVE_DELAY } = await import('../backoff')
const { settleUp, written: landed } = await import('../parting')

const PATH = '/Notes/Svelte docs.url'
const FILE =
  '[InternetShortcut]\r\nURL=https://svelte.dev/docs\r\n' +
  'Title=Svelte docs\r\nNib-Added=2026-09-12T08:30:00.000Z\r\n'

/** Everything the write said, as the app's own reader reads it back. */
function said(): string {
  return written.at(-1)?.content ?? ''
}

beforeEach(() => {
  keepNow(PATH)
  written.length = 0
  told.length = 0
  vi.useFakeTimers()
})

test('writes the page the reading got to, and keeps where the note points', async () => {
  let text = FILE
  keepPage({
    path: PATH,
    text,
    url: 'https://svelte.dev/docs/svelte/what-are-runes',
    icon: 'https://svelte.dev/favicon.png',
    wrote: (next) => (text = next),
  })

  // Nothing yet: the reading has to settle first, so a page that redirects twice on
  // the way in is one write rather than three. The notes' own pause; see backoff.ts.
  expect(written).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(SAVE_DELAY - 50)
  expect(written).toHaveLength(0)

  await vi.advanceTimersByTimeAsync(100)

  expect(written).toHaveLength(1)
  expect(said()).toContain('URL=https://svelte.dev/docs/svelte/what-are-runes')
  expect(said()).toContain('Nib-Home=https://svelte.dev/docs')
  expect(said()).toContain('Nib-Icon=https://svelte.dev/favicon.png')
  expect(said()).toContain('Title=Svelte docs')
  // The day the note was made, untouched.
  expect(said()).toContain('Nib-Added=2026-09-12T08:30:00.000Z')
  // And the tab's own copy of the file is the file.
  expect(text).toBe(said())
})

test('a page that moves twice in a moment is one write', async () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/a',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(200)
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/b',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(1)
  expect(said()).toContain('URL=https://svelte.dev/b')
})

test('the home already in the file is the home that stays', async () => {
  const moved =
    '[InternetShortcut]\r\nURL=https://svelte.dev/docs/one\r\n' +
    'Title=Svelte docs\r\nNib-Added=2026-09-12T08:30:00.000Z\r\n' +
    'Nib-Home=https://svelte.dev/docs\r\n'

  keepPage({
    path: PATH,
    text: moved,
    url: 'https://svelte.dev/docs/two',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(said()).toContain('URL=https://svelte.dev/docs/two')
  expect(said()).toContain('Nib-Home=https://svelte.dev/docs')
})

test('a page that has not moved is not written', async () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/docs',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
})

test('an address that is not the web is never written', async () => {
  keepPage({ path: PATH, text: FILE, url: 'file:///C:/notes', icon: null, wrote: () => undefined })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
})

/** The row in the file list draws the site's own mark out of this file, and nothing
 *  rescans a space while it is open - so the index has to be told, the same way every
 *  other write in the app tells it. Without this the row wore the plain globe until
 *  the next launch. See link-index.svelte.ts and docs/web-tabs.md. */
test('tells the index what the file now says, so the row can wear the favicon', async () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/docs/svelte/runes',
    icon: 'https://svelte.dev/favicon.png',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(told).toHaveLength(1)
  expect(told[0]?.path).toBe(PATH)
  // The same text that went to the disk, so the index and the file cannot disagree.
  expect(told[0]?.content).toBe(said())
  expect(told[0]?.content).toContain('Nib-Icon=https://svelte.dev/favicon.png')
})

test('says nothing to the index when there was nothing to write', async () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/docs',
    icon: null,
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)

  expect(written).toHaveLength(0)
  expect(told).toHaveLength(0)
})

/** Two devices draw one favicon into two different pictures, and each wrote its own
 *  over the other's on every open: a web note syncing back and forth on a change
 *  nobody could see, and the copies beside it that two writers between two passes
 *  used to leave. A mark already held as a picture stays until the reading moves. */
test('a mark already held as a picture is not written over on its own', async () => {
  const held = `${FILE}Nib-Icon=data:image/png;base64,AAAA\r\n`
  keepPage({
    path: PATH,
    text: held,
    url: 'https://svelte.dev/docs',
    icon: 'data:image/png;base64,BBBB',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)
  expect(written).toHaveLength(0)

  keepPage({
    path: PATH,
    text: held,
    url: 'https://svelte.dev/docs/svelte/runes',
    icon: 'data:image/png;base64,BBBB',
    wrote: () => undefined,
  })
  await vi.advanceTimersByTimeAsync(2500)
  expect(said()).toContain('Nib-Icon=data:image/png;base64,BBBB')
})

/** A reader clicking through links without a pause is still written every couple of
 *  seconds, the way somebody typing without a pause is. */
test('a reading that never settles is written at the longest wait a note has', async () => {
  for (let step = 0; step < 12; step++) {
    keepPage({
      path: PATH,
      text: FILE,
      url: `https://svelte.dev/page-${step}`,
      icon: null,
      wrote: () => undefined,
    })
    await vi.advanceTimersByTimeAsync(SAVE_DELAY / 2)
  }

  expect(written.length).toBeGreaterThanOrEqual(1)
  expect(written.length).toBeLessThanOrEqual(Math.ceil((12 * SAVE_DELAY) / 2 / SAVE_AT_MOST) + 1)
})

/** Emil's quit: the window going writes the address now, and waits for it. */
test('the window going writes what is waiting, and waits for it', async () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/docs/kit',
    icon: null,
    wrote: () => undefined,
  })
  expect(written).toHaveLength(0)

  settleUp()
  await landed()

  expect(said()).toContain('URL=https://svelte.dev/docs/kit')
  // And nothing is written a second time once the pause would have come.
  await vi.advanceTimersByTimeAsync(2500)
  expect(written).toHaveLength(1)
})

test('leaving the tab writes what is waiting for its note', () => {
  keepPage({
    path: PATH,
    text: FILE,
    url: 'https://svelte.dev/docs/cli',
    icon: null,
    wrote: () => undefined,
  })
  keepNow(PATH)

  expect(said()).toContain('URL=https://svelte.dev/docs/cli')
})
