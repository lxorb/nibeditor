/** A tab restored after a restart wears its site's mark in the first frame it is drawn
 *  in, before its page has been asked for: Emil, 2026-09-30, *"When I restart nib all
 *  the icons from previously opened websites are gone and I only see them when I
 *  actually load them. But they could be cached."*
 *
 *  Two runs of the app in one file. The first sees a page show its mark and writes it
 *  down; the modules are then thrown away and read again, which is what a restart is to
 *  the window, and the second builds the tab the way a session brings one back - an
 *  address and no page - and mounts the strip's mark. The first DOM the mount produces
 *  is the frame: a globe there, swapped for the site a moment later, is the bug. */

import { afterEach, expect, test, vi } from 'vitest'

const invoked: string[] = []

// A desktop, so a web tab is a tab whose page is a webview of its own - and nothing
// here builds one: the command is written down and answered with nothing.
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  invoke: (command: string) => {
    invoked.push(command)
    return Promise.resolve(undefined)
  },
}))

// And no events to hear: the window's listeners start with the first page anyone asks for.
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

const SITE = 'https://web.whatsapp.com/'
const MARK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

afterEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
})

test('a tab restored with no page wears the mark its site last showed, in its first frame', async () => {
  // The run before: the page showed its mark, and the store wrote it down.
  const before = await import('../../src/lib/web-tab/favicons.svelte')
  before.favicons.saw(SITE, MARK)
  before.favicons.write()

  // The restart, Svelte's own runtime with it: a component and the `mount` that runs it
  // have to be the same copy.
  vi.resetModules()
  const { flushSync, mount, unmount } = await import('svelte')
  const { NoteDoc, Tab } = await import('../../src/lib/workspace/documents.svelte')
  const { pages } = await import('../../src/lib/web-tab/pages.svelte')
  const TabMark = (await import('../../src/lib/TabMark.svelte')).default

  // As a session brings a browser tab back: no file, the address it was on, no page.
  const doc = new NoteDoc(
    { kind: 'web', path: null, name: 'WhatsApp', text: '', dirty: false },
    () => undefined,
  )
  const tab = new Tab(doc, 'pane')
  tab.address = SITE

  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(TabMark, { target, props: { tab } })
  flushSync()

  const picture = target.querySelector('img')
  expect(picture?.getAttribute('src'), 'the site s mark, in the first frame').toBe(MARK)
  expect(target.querySelectorAll('svg'), 'and no globe beside or before it').toHaveLength(0)
  expect(picture?.getAttribute('draggable')).toBe('false')

  // Nothing was loaded to get there.
  expect(pages.of(tab.id).live).toBe(false)
  expect(invoked).not.toContain('web_open')

  // And the page's own mark wins the moment it has one.
  const live = MARK.replace('iVBOR', 'iVBOx')
  pages.of(tab.id).icon = live
  flushSync()
  expect(target.querySelector('img')?.getAttribute('src')).toBe(live)

  void unmount(app, { outro: false })
})
