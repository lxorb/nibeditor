/** An address a program on the machine asked a browser for (docs/online-terminal.md 4.13).
 *
 *  Emil, 2026-10-05: `claude` printed its sign-in address to be copied by hand. A program
 *  that asks for a browser now gets a tab beside its terminal, and a sign-in whose
 *  provider sends the browser back to the program's own `localhost` listener has that
 *  request made on the machine: the tab goes, and the terminal is in front again.
 *
 *  In the jsdom project because the tab is watched by an effect. The workspace and the
 *  pages are stand-ins that keep what they were asked. */

import { flushSync } from 'svelte'
import { beforeEach, expect, test, vi } from 'vitest'

const opened: { url: string; ask: string; opener: string | undefined }[] = []
const closed: string[] = []
const state = vi.hoisted(() => ({
  tabs: [] as { id: string }[],
  active: null as string | null,
}))

vi.mock('../../src/lib/workspace.svelte', async () => {
  const { reactive } = await import('./online-opening-world.svelte')
  return { workspace: reactive(state, opened, closed) }
})
vi.mock('../../src/lib/web-tab/pages.svelte', async () => {
  const { pagesOf } = await import('./online-opening-world.svelte')
  return { pages: pagesOf() }
})
const external: string[] = []
vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  openExternal: (url: string) => {
    external.push(url)
    return Promise.resolve()
  },
}))

const { Opener, Pace, whereToOpen } = await import('../../src/lib/online/opening.svelte')
const { land, reset } = await import('./online-opening-world.svelte')

const SIGN_IN =
  'https://claude.ai/oauth/authorize?code=true&redirect_uri=http%3A%2F%2Flocalhost%3A54545%2Fcallback&state=s'
const DESKTOP = { pages: true, native: true }

let calledBack: string[]
let offered: string[]

beforeEach(() => {
  opened.length = 0
  closed.length = 0
  external.length = 0
  calledBack = []
  offered = []
  state.tabs = [{ id: 'terminal' }]
  state.active = 'terminal'
  reset()
})

function opener(build = DESKTOP) {
  return new Opener(
    () => 'terminal',
    build,
    (url) => calledBack.push(url),
    (url) => offered.push(url),
  )
}

test('a desktop opens a tab beside the terminal, in front only while it is looked at', () => {
  const one = opener()
  one.open('https://github.com/login/device', true, 0)
  one.open('https://example.com/', false, 10_000)
  expect(opened).toEqual([
    { url: 'https://github.com/login/device', ask: 'front', opener: 'terminal' },
    { url: 'https://example.com/', ask: 'behind', opener: 'terminal' },
  ])
})

test('a sign-in’s way back is made on the machine, then the tab goes and the terminal is back', () => {
  const one = opener()
  one.open(SIGN_IN, true, 0)
  expect(opened).toHaveLength(1)

  // The provider's own pages first: nothing to do.
  land('tab-1', 'https://claude.ai/oauth/authorize?code=true')
  flushSync()
  expect(calledBack).toEqual([])

  // A loopback page the opened address did not name is no way back of this sign-in.
  land('tab-1', 'http://localhost:9999/callback?code=c')
  flushSync()
  expect(calledBack).toEqual([])

  state.active = 'tab-1'
  land('tab-1', 'http://localhost:54545/callback?code=c&state=s')
  flushSync()
  expect(calledBack).toEqual(['http://localhost:54545/callback?code=c&state=s'])

  // Landing there again (a reload) does not make the request twice.
  land('tab-1', 'http://localhost:54545/callback?code=c&state=s#again')
  flushSync()
  expect(calledBack).toHaveLength(1)

  one.called('http://localhost:54545/callback?code=c&state=s', 302)
  expect(closed).toEqual(['tab-1'])
  expect(state.active).toBe('terminal')
})

test('a way back the program refused leaves the tab to show it', () => {
  const one = opener()
  one.open(SIGN_IN, true, 0)
  land('tab-1', 'http://localhost:54545/callback?code=c&state=s')
  flushSync()
  one.called('http://localhost:54545/callback?code=c&state=s', 0)
  expect(closed).toEqual([])
})

test('a phone hands it to the system browser, a browser build offers it, and neither a sign-in it cannot finish', () => {
  const phone = opener({ pages: false, native: true })
  phone.open('https://github.com/login/device', true, 0)
  phone.open(SIGN_IN, true, 10_000)
  expect(external).toEqual(['https://github.com/login/device'])

  const web = opener({ pages: false, native: false })
  web.open('https://github.com/login/device', true, 0)
  web.open(SIGN_IN, true, 10_000)
  expect(offered).toEqual(['https://github.com/login/device'])
  expect(opened).toEqual([])
})

test('only the web, ever', () => {
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ms-settings:', 'vscode://x']) {
    expect(whereToOpen(url, DESKTOP)).toBe('none')
  }
  const one = opener()
  one.open('file:///etc/passwd', true, 0)
  expect(opened).toEqual([])
})

test('six a minute, and the same address not twice in a breath', () => {
  const pace = new Pace()
  expect(pace.allows('https://a.b/', 0)).toBe(true)
  expect(pace.allows('https://a.b/', 1000)).toBe(false)
  expect(pace.allows('https://a.b/', 4000)).toBe(true)
  for (let one = 0; one < 4; one++)
    expect(pace.allows(`https://a.b/${String(one)}`, 5000)).toBe(true)
  expect(pace.allows('https://a.b/7', 5000)).toBe(false)
  expect(pace.allows('https://a.b/7', 61_000)).toBe(true)
})
