import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The Hidden tabs question as the reader meets it: the app's own question sheet, its
 *  title and two answers, Escape taking it away with nothing decided, and an answer
 *  closing it and becoming the setting.
 *
 *  In the jsdom project because the sheet needs a document. */

vi.mock('../../src/lib/tauri', async (actual) => ({
  ...(await actual<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  platform: () => 'windows',
  invoke: () => Promise.resolve(undefined),
}))

vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => undefined) }))

/** The sheet rises through the Web Animations API, which jsdom does not implement. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

const { prompt } = await import('../../src/lib/prompt.svelte')
const { overlays } = await import('../../src/lib/overlays')
const { hiddenTabs } = await import('../../src/lib/workspace/hidden-tabs.svelte')
const { pages } = await import('../../src/lib/web-tab/pages.svelte')
const PromptSheet = (await import('../../src/lib/PromptSheet.svelte')).default
type Tab = import('../../src/lib/workspace.svelte').Tab

let target: HTMLElement
let close: (() => void) | undefined

/** A web tab out of sight with its page running: as much of a tab as the store reads. */
function running(id: string): Tab {
  pages.of(id).live = true
  return { id, kind: 'web', paneId: 'aside' } as Tab
}

beforeEach(() => {
  hiddenTabs.set('run')
  hiddenTabs.choice = 'ask'
  target = document.createElement('div')
  document.body.append(target)
  const shown = mount(PromptSheet, { target })
  close = () => void unmount(shown)
  flushSync()
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
})

test('asks in the question sheet: the title and the two answers', async () => {
  const leaving = hiddenTabs.left([running('a')])
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()

  expect(target.querySelector('.title')?.textContent).toBe('Hidden tabs')
  const buttons = [...target.querySelectorAll('.row button')]
  expect(buttons.map((one) => one.textContent.trim())).toEqual(['Keep running', 'Pause'])

  const pause = buttons.at(1)
  if (pause instanceof HTMLButtonElement) pause.click()
  await leaving
  flushSync()

  expect(prompt.open).toBe(false)
  expect(hiddenTabs.choice).toBe('pause')
})

test('Escape takes it away with nothing decided, and the next switch asks again', async () => {
  const leaving = hiddenTabs.left([running('a')])
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  flushSync()

  expect(overlays.escape()).toBe(true)
  await leaving
  flushSync()
  expect(prompt.open).toBe(false)
  expect(hiddenTabs.choice).toBe('ask')

  const again = hiddenTabs.left([running('b')])
  await vi.waitFor(() => expect(prompt.open).toBe(true))
  prompt.dismiss()
  await again
})
