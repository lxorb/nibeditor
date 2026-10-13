/** PDFs another program opened with nib, as the window takes them: each in the viewer,
 *  in the space it is in or brought into the one that is open, the ones the app was
 *  started for and the ones that arrive while it runs. See handed.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

interface World {
  asked: string[]
  /** What `take_startup_pdfs` answers with. */
  waiting: unknown
  heard: ((event: { payload: unknown }) => void) | null
  done: string[]
  active: string | null
  /** Where `bringInPdf` says a paper landed; null for one that would not come in. */
  landed: string | null
}

const world = vi.hoisted((): World => ({
  asked: [],
  waiting: [],
  heard: null,
  done: [],
  active: 'work',
  landed: 'C:\\Nib\\Work\\a.pdf',
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'work', name: 'Work', root: 'C:\\Nib\\Work' },
      { id: 'home', name: 'Home', root: 'C:\\Nib\\Home' },
    ],
    get activeSpaceId() {
      return world.active
    },
    selectSpace: (id: string) => {
      world.done.push(`space ${id}`)
      world.active = id
      return Promise.resolve()
    },
    bringInPdf: (from: string, root: string) => {
      world.done.push(`bring ${from} into ${root}`)
      return Promise.resolve(world.landed)
    },
    openPdf: (path: string) => {
      world.done.push(`open ${path}`)
    },
  },
}))

vi.mock('../tauri', async (actual) => ({
  ...(await actual<typeof import('../tauri')>()),
  invoke: (command: string) => {
    world.asked.push(command)
    return Promise.resolve(world.waiting)
  },
}))

vi.mock('../log', () => ({ log: () => undefined }))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    listen: (event: string, handler: (event: { payload: unknown }) => void) => {
      world.asked.push(`listen ${event}`)
      world.heard = handler
      return Promise.resolve(() => undefined)
    },
  }),
}))

const { hearPdfs, showPdfs } = await import('./handed')

beforeEach(() => {
  world.asked = []
  world.waiting = []
  world.heard = null
  world.done = []
  world.active = 'work'
  world.landed = 'C:\\Nib\\Work\\a.pdf'
})

test('listens before it asks, so no PDF falls between the two', async () => {
  await hearPdfs()
  expect(world.asked).toEqual(['listen nib://open-pdfs', 'take_startup_pdfs'])
})

test('a PDF from outside every space is brought into the open one and opened there', async () => {
  world.waiting = ['C:\\Users\\me\\Downloads\\a.pdf']
  await hearPdfs()
  await vi.waitFor(() => expect(world.done).toHaveLength(2))

  expect(world.done).toEqual([
    'bring C:\\Users\\me\\Downloads\\a.pdf into C:\\Nib\\Work',
    'open C:\\Nib\\Work\\a.pdf',
  ])
})

test('one in another space opens where it is, in that space, while the app runs', async () => {
  await hearPdfs()
  world.heard?.({ payload: ['C:\\Nib\\Home\\Papers\\b.pdf'] })
  await vi.waitFor(() => expect(world.done).toHaveLength(2))

  expect(world.done).toEqual(['space home', 'open C:\\Nib\\Home\\Papers\\b.pdf'])
})

test('a paper that would not come in opens nothing, and nothing but paths is read', async () => {
  world.landed = null
  await showPdfs(['C:\\Users\\me\\Downloads\\big.pdf', 42, null, ''])
  await showPdfs('C:\\not-a-list.pdf')

  expect(world.done).toEqual(['bring C:\\Users\\me\\Downloads\\big.pdf into C:\\Nib\\Work'])
})
