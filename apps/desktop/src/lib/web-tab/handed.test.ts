/** Links another program handed nib, as the window takes them.
 *
 *  What the crate refuses is tested beside it (src-tauri/src/web_handed.rs); what is
 *  under test here is the window's half: every page a tab in front, beside the one
 *  being read, in the order they came - the ones the app was started for and the ones
 *  that arrive while it runs - and anything that is not a page on the web opens
 *  nothing, whatever crossed the boundary. See handed.ts. */

import { beforeEach, expect, test, vi } from 'vitest'

interface Opened {
  url: string
  ask: string
}

const world = vi.hoisted(() => ({
  opened: [] as Opened[],
  /** What `take_startup_pages` answers with. */
  waiting: [] as unknown,
  /** The listener the window put up, once it has. */
  heard: null as ((event: { payload: unknown }) => void) | null,
  asked: [] as string[],
}))

vi.mock('../workspace.svelte', () => ({
  workspace: {
    openPage: (url: string, ask: string) => {
      world.opened.push({ url, ask })
      return 'tab'
    },
  },
}))

vi.mock('../tauri', () => ({
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

const { hearPages, showPages } = await import('./handed')

beforeEach(() => {
  world.opened = []
  world.waiting = []
  world.heard = null
  world.asked = []
})

test('listens before it asks, so no page falls between the two', async () => {
  await hearPages()
  expect(world.asked).toEqual(['listen nib://open-pages', 'take_startup_pages'])
})

test('the pages the app was started for open as tabs in front, in order', async () => {
  world.waiting = ['https://one.example/', 'https://two.example/a?b=1']
  await hearPages()

  expect(world.opened).toEqual([
    { url: 'https://one.example/', ask: 'front' },
    { url: 'https://two.example/a?b=1', ask: 'front' },
  ])
})

test('and so does a page that arrives while it runs', async () => {
  await hearPages()
  world.heard?.({ payload: ['http://three.example/'] })

  expect(world.opened).toEqual([{ url: 'http://three.example/', ask: 'front' }])
})

test('nothing but a page on the web opens anything', () => {
  showPages([
    'file:///C:/Users/me/Notes/Idea.md',
    'C:\\Users\\me\\Notes\\Idea.md',
    'javascript:alert(1)',
    'nib://open?path=Idea.md',
    'https://tauri.localhost/',
    42,
    null,
    'https://fine.example/',
  ])
  showPages('https://not-a-list.example/')
  showPages(null)

  expect(world.opened).toEqual([{ url: 'https://fine.example/', ask: 'front' }])
})
