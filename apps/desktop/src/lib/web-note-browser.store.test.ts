import { beforeEach, expect, test, vi } from 'vitest'

/** A web note opened anywhere but the desktop app hands its address to the browser:
 *  a new tab beside nib's own in a browser build, the system's from the phone and
 *  tablet app. Only a shortcut with no address yet opens in a tab, for its bar.
 *  Issue #206; see `openSite` in workspace.svelte.ts and docs/web-tabs.md. */

const SITE = '/space/Site.url'
const BLANK = '/space/Blank.url'

const handed: string[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: false,
  isNative: false,
  openExternal: (url: string) => {
    handed.push(url)
    return Promise.resolve()
  },
  invoke: (command: string, args?: Record<string, unknown>) =>
    Promise.resolve(
      command === 'read_note' && args?.path === SITE
        ? '[InternetShortcut]\r\nURL=https://example.com/site\r\n'
        : command === 'read_note'
          ? '[InternetShortcut]\r\n'
          : undefined,
    ),
}))

const { workspace } = await import('./workspace.svelte')

beforeEach(() => {
  handed.length = 0
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/space' }]
  workspace.activeSpaceId = 's'
})

test('a web note in a browser opens its address in a new tab, not in nib', async () => {
  await workspace.openWeb(SITE)

  expect(handed).toEqual(['https://example.com/site'])
  expect(workspace.tabs).toEqual([])
})

test('a web note with no address yet opens in nib, where its bar can take one', async () => {
  await workspace.openWeb(BLANK)

  expect(handed).toEqual([])
  expect(workspace.tabs.map((one) => [one.kind, one.path])).toEqual([['web', BLANK]])
})
