/** A web note is open in one tab of one window, across the app's windows: another
 *  window holding it shows it instead of this one opening a second, and two windows
 *  that came to hold one anyway leave it to whoever had it first. The other window is
 *  played here by a channel of the test's own. See web-tab/one-window.svelte.ts. */

import { afterAll, beforeEach, expect, test, vi } from 'vitest'

const SITE = '/space/Site.url'
const MAIL = '/space/Mail.url'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: false,
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(
      command === 'read_note'
        ? `[InternetShortcut]\r\nURL=https://example.com/${String(args?.path).includes('Mail') ? 'mail' : 'site'}\r\n`
        : undefined,
    ),
}))

// The pages' own channel from the crate, which nothing here says anything on.
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

const { workspace } = await import('../../src/lib/workspace.svelte')
const { heldElsewhere } = await import('../../src/lib/web-tab/one-window.svelte')

/** The other window. */
const other = new BroadcastChannel('nib:web-notes')
const heard: Record<string, unknown>[] = []
other.onmessage = (event: MessageEvent<Record<string, unknown>>) => {
  heard.push(event.data)
}

afterAll(() => {
  other.close()
})

beforeEach(() => {
  heard.length = 0
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

test('a web note another window has open is shown there, not opened here', async () => {
  other.postMessage({ window: 'other', held: [[MAIL, 1]] })
  await vi.waitFor(() => expect(heldElsewhere(MAIL)).toBe(true))

  await workspace.openWeb(MAIL)

  expect(workspace.tabs).toEqual([])
  await vi.waitFor(() =>
    expect(heard).toContainEqual(expect.objectContaining({ show: MAIL, to: 'other' })),
  )
})

test('one both windows came to hold stays with whoever had it first', async () => {
  await workspace.openWeb(SITE)
  const tab = workspace.active
  if (!tab) throw new Error('nothing opened')
  await vi.waitFor(() =>
    expect(heard).toContainEqual(expect.objectContaining({ held: [[SITE, expect.any(Number)]] })),
  )

  // The other window has had it since the start of time.
  other.postMessage({ window: 'other', held: [[SITE, 0]] })

  await vi.waitFor(() => expect(tab.path).toBeNull())
  expect(tab.kind).toBe('web')
  expect(tab.address).toBe('https://example.com/site')
})
