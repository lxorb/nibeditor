import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** Remote's host picker, in the middle of the window.
 *
 *  Emil, 2026-10-03: a Remote card beside Terminal opens a picker built like the space
 *  switcher - typed into with no visible field, numbered, the pinned and recent hosts
 *  first, the groups of the ssh config after - and choosing a host is a terminal tab on
 *  it. This mounts the dialog over the real workspace, with the crate answering from
 *  here, and presses keys on it the way a hand would. What the order and an address are
 *  on their own is remote/hosts.test.ts.
 *
 *  In the jsdom project because mounting a component needs a document. */

/** What the crate holds: the config's hosts and what nib keeps. */
let config: unknown[] = []
let kept: Record<string, unknown> = { own: [], about: {}, order: [], groups: [] }
const asked: { command: string; args: unknown }[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args: unknown) => {
    asked.push({ command, args })
    if (command === 'remote_hosts') return Promise.resolve({ config, kept, file: '/h/.ssh/config' })
    if (command === 'remote_keep') {
      kept = (args as { kept: Record<string, unknown> }).kept
      return Promise.resolve(kept)
    }
    return Promise.resolve(null)
  },
}))

/** jsdom has no Web Animations. This one finishes in the microtask after it is asked
 *  for - after Svelte has hung its `onfinish` on it, and before any timer: a machine
 *  busy enough to hold the timers back for a second would otherwise keep a number on
 *  its way out on screen past a wait for it to go. */
Element.prototype.animate = () => {
  const animation = {
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    onfinish: null as (() => void) | null,
  }
  queueMicrotask(() => animation.onfinish?.())
  return animation as unknown as Animation
}
Element.prototype.scrollIntoView = () => undefined

const { default: HostPicker } = await import('../../src/lib/remote/HostPicker.svelte')
const { hostPicker } = await import('../../src/lib/remote/picker.svelte')
const { remote } = await import('../../src/lib/remote/hosts.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { readSpec } = await import('../../src/lib/terminal/spec')
const { settings } = await import('../../src/lib/settings.svelte')

const NOW = Date.now()

let target: HTMLElement
let close: (() => void) | undefined

beforeEach(() => {
  config = [
    { id: 'pi', also: ['raspberry'], hostname: '10.0.0.5', user: 'emil', group: 'Home' },
    { id: 'nas', also: [], group: 'Home' },
    { id: 'office', also: [], hostname: 'office.example.com', group: 'Work' },
    { id: 'build', also: [] },
  ]
  kept = {
    own: [],
    about: { office: { pinned: true }, nas: { last: NOW - 60_000, colour: '4' } },
    order: [],
    groups: [],
  }
  asked.length = 0
  workspace.panes.collapse()
  workspace.tabs = []
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(HostPicker, { target })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  hostPicker.dismiss()
  flushSync()
  close?.()
  target.remove()
  workspace.tabs = []
  vi.useRealTimers()
})

const dialog = () => target.querySelector<HTMLElement>('[role="menu"]')
const rows = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('.nib-row') ?? [])]
/** A row's host's name, without the address said after it. */
const names = () =>
  rows().map((one) => {
    const label = one.querySelector('.nib-row-label')?.cloneNode(true) as HTMLElement | undefined
    label?.querySelector('.detail')?.remove()
    return label?.textContent
  })

async function opened() {
  hostPicker.show()
  await remote.refresh()
  flushSync()
  await tick()
  flushSync()
}

async function press(key: string, code = '', held: KeyboardEventInit = {}) {
  const at = dialog()?.contains(document.activeElement) ? document.activeElement : dialog()
  at?.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...held }),
  )
  flushSync()
  await tick()
  flushSync()
}

async function type(text: string) {
  for (const character of text) await press(character)
}

/** The terminal a choice made, once it has made one. */
async function made() {
  await vi.waitFor(() => expect(workspace.tabs.length).toBe(1))
  const tab = workspace.tabs[0]
  if (!tab) throw new Error('no tab')
  return tab
}

test('no field: the pinned host, the recent one, then the rest by group, numbered on Alt', async () => {
  await opened()

  expect(dialog()?.classList.contains('is-centred')).toBe(true)
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)
  expect(names()).toEqual(['office', 'nas', 'build', 'pi'])
  // No number by default, as in the space switcher: they come with Alt or a digit.
  const numbers = () => rows().map((one) => one.querySelector('.place')?.textContent ?? null)
  expect(numbers()).toEqual([null, null, null, null])
  await press('Alt', 'AltLeft', { altKey: true })
  expect(numbers()).toEqual(['1', '2', '3', '4'])
  dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }))
  await vi.waitFor(() => expect(numbers()).toEqual([null, null, null, null]))
  // A group's name over its hosts, and a line where the pinned and recent ones end.
  expect([...(dialog()?.querySelectorAll('.head') ?? [])].map((one) => one.textContent)).toEqual([
    'Home',
  ])
  expect(dialog()?.querySelectorAll('hr').length).toBe(2)
  // Where it is, quietly, and when it was last connected to.
  expect(rows()[3]?.querySelector('.detail')?.textContent).toBe('emil@10.0.0.5')
  expect(rows()[1]?.querySelector('.nib-row-meta')).not.toBe(null)
  expect(document.activeElement).toBe(rows()[0])
})

test('a digit connects at once: a terminal tab on that host, named for it', async () => {
  await opened()
  await press('4', 'Digit4')

  expect(hostPicker.open).toBe(false)
  const tab = await made()
  expect(readSpec(tab.doc)?.shell).toBe('ssh:pi')
  expect(tab.kind).toBe('terminal')
  expect(tab.name).toBe('pi')
})

test('a name, or another name of it, is found and waits for Enter', async () => {
  await opened()
  await type('rasp')

  expect(names()).toEqual(['pi'])
  expect(hostPicker.open).toBe(true)
  expect(workspace.tabs).toHaveLength(0)

  await press('Enter')
  expect(readSpec((await made()).doc)?.shell).toBe('ssh:pi')
})

test('an address nobody keeps is a row of its own, and choosing it keeps it', async () => {
  await opened()
  await type('me@box:2222')

  expect(names()).toEqual(['me@box:2222'])
  await press('Enter')

  const tab = await made()
  const own = (kept.own as { id: string; hostname: string; user: string; port: number }[])[0]
  expect(own).toMatchObject({ hostname: 'box', user: 'me', port: 2222, name: 'me@box:2222' })
  expect(readSpec(tab.doc)?.shell).toBe(`ssh:${own?.id ?? ''}`)
})

test('with no hosts at all, the one row is the way to Settings, Remote', async () => {
  config = []
  kept = { own: [], about: {}, order: [], groups: [] }
  const shown = vi.spyOn(settings, 'show').mockImplementation(() => undefined)
  await opened()

  expect(names()).toEqual(['Add host'])
  rows()[0]?.click()
  expect(shown).toHaveBeenCalledWith('remote')
  expect(hostPicker.open).toBe(false)
  shown.mockRestore()
})

test('Escape and the scrim put it away, and a digit no host has is refused', async () => {
  await opened()
  await press('9', 'Digit9')
  expect(hostPicker.open).toBe(true)
  expect(names()).toHaveLength(4)

  target.querySelector<HTMLElement>('.nib-scrim')?.click()
  flushSync()
  expect(hostPicker.open).toBe(false)
  expect(workspace.tabs).toHaveLength(0)
})
