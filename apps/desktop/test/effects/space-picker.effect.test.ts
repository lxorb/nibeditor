import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The switcher in the middle of the window, Ctrl+Shift+Space.
 *
 *  Emil, 2026-10-03: a digit switches as soon as only one space can be meant, without
 *  Enter; letters find a space by its name and need Enter; there is no field anywhere,
 *  the letters show as hits in the rows and Backspace edits them; the key again puts it
 *  away; a space shared only to be read is there, and marked. This mounts the dialog and
 *  presses keys on it the way a hand would; what the keys mean on their own is
 *  space-pick.test.ts. In the jsdom project because mounting a component needs a
 *  document. */

vi.mock('../../src/lib/sharing.svelte', async (original) => ({
  ...(await original<typeof import('../../src/lib/sharing.svelte')>()),
  roleOf: (root: string) => (root === '/spaces/Lab' ? 'read' : 'owner'),
  isShared: (root: string) => root === '/spaces/Lab',
}))

const { default: SpacePicker } = await import('../../src/lib/SpacePicker.svelte')
const { spacePicker } = await import('../../src/lib/space-picker.svelte')
const { viewport } = await import('../../src/lib/viewport.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { overlays } = await import('../../src/lib/overlays')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')

/** Svelte plays a transition through the Web Animations API, which jsdom has not got;
 *  this one is over as soon as it starts. */
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
  setTimeout(() => animation.onfinish?.(), 0)
  return animation as unknown as Animation
}
Element.prototype.scrollIntoView = () => undefined

const FOUR = ['VIS', 'Journal', 'ETH', 'Lab']

function spaces(names: readonly string[]) {
  workspace.spaces = names.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    root: `/spaces/${name}`,
  }))
  workspace.activeSpaceId = workspace.spaces[0]?.id ?? null
}

let target: HTMLElement
let close: (() => void) | undefined
let was: typeof viewport.device
let shown: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  spaces(FOUR)
  shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(SpacePicker, { target })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  spacePicker.dismiss()
  flushSync()
  close?.()
  target.remove()
  viewport.device = was
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const dialog = () => target.querySelector<HTMLElement>('[data-spaces-open]')
const rows = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('.nib-row') ?? [])]
const names = () => rows().map((one) => one.querySelector('.nib-row-label')?.textContent)

async function opened() {
  spacePicker.toggle()
  flushSync()
  await tick()
}

/** A key, pressed wherever the keyboard is in the dialog. */
async function press(key: string, code = '') {
  const at = dialog()?.contains(document.activeElement) ? document.activeElement : dialog()
  at?.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
  flushSync()
  await tick()
  flushSync()
}

async function type(text: string) {
  for (const character of text) await press(character)
}

test('it has no field: every space is a numbered row, and nothing can be typed into', async () => {
  await opened()

  expect(dialog()).not.toBe(null)
  expect(dialog()?.classList.contains('is-centred')).toBe(true)
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)
  expect(names()).toEqual(FOUR)
  expect(rows().map((one) => one.querySelector('.place')?.textContent)).toEqual([
    '1',
    '2',
    '3',
    '4',
  ])
  // Only for switching: no New space and no space's own menu in it.
  expect(dialog()?.querySelector('.more')).toBe(null)
  expect(dialog()?.textContent).not.toContain('New space')
  // The space you are in is where the keyboard starts.
  expect(document.activeElement).toBe(rows()[0])
})

test('a digit switches at once, without Enter', async () => {
  await opened()
  await press('3', 'Digit3')

  expect(shown).toHaveBeenCalledWith('eth')
  expect(spacePicker.open).toBe(false)
})

test('a name is found, shown as hits, and waits for Enter', async () => {
  await opened()
  await type('jo')

  expect(names()).toEqual(['Journal'])
  expect(rows()[0]?.querySelector('.nib-row-label b')?.textContent).toBe('Jo')
  expect(shown).not.toHaveBeenCalled()
  expect(spacePicker.open).toBe(true)
  // Still no field: the letters live in the row.
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)

  await press('Enter')
  expect(shown).toHaveBeenCalledWith('journal')
  expect(spacePicker.open).toBe(false)
})

test('Backspace takes a letter back, and a letter nothing holds is refused', async () => {
  await opened()
  await type('e')
  expect(names()).toEqual(['ETH'])

  await press('z')
  expect(names()).toEqual(['ETH'])
  expect(rows()[0]?.querySelector('.nib-row-label b')?.textContent).toBe('E')

  await press('Backspace')
  expect(names()).toEqual(FOUR)
  expect(dialog()?.querySelector('b')).toBe(null)
})

test('with ten or more, a digit another could extend waits, and a second one goes at once', async () => {
  spaces(Array.from({ length: 12 }, (_, at) => `Space ${String(at + 1)}`))
  workspace.activeSpaceId = 'space-5'
  await opened()

  vi.useFakeTimers()
  await press('1', 'Digit1')
  expect(shown).not.toHaveBeenCalled()
  expect(rows().map((one) => one.querySelector('.place')?.textContent)).toEqual([
    '1',
    '10',
    '11',
    '12',
  ])
  await press('2', 'Digit2')
  expect(shown).toHaveBeenCalledWith('space-12')

  await opened()
  await press('1', 'Digit1')
  vi.advanceTimersByTime(700)
  expect(shown).toHaveBeenLastCalledWith('space-1')
})

test('the key again puts it away, as Escape does', async () => {
  await opened()
  expect(overlays.depth).toBe(1)

  // Pressed on a row, the chord is neither the list's nor a letter: it goes on to the
  // window, whose handler is the one that answers it.
  const chord = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  })
  document.activeElement?.dispatchEvent(chord)
  expect(chord.defaultPrevented).toBe(false)
  expect(shortcuts.handle(chord, {} as never)).toBe(true)
  await vi.waitFor(() => expect(spacePicker.open).toBe(false))
  flushSync()
  expect(overlays.depth).toBe(0)

  await opened()
  overlays.escape()
  flushSync()
  expect(spacePicker.open).toBe(false)
  expect(shown).not.toHaveBeenCalled()
})

test('a space shared only to be read is there, and marked', async () => {
  await opened()

  const lab = rows()[3]
  expect(lab?.querySelector('.nib-row-label')?.textContent).toBe('Lab')
  expect(lab?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Read-only')
  expect(rows()[0]?.querySelector('[role="img"]')).toBe(null)
})

describe('on a phone', () => {
  test('the key opens the drawer’s own list rather than a dialog', async () => {
    viewport.device = 'phone'
    spacePicker.toggle()
    flushSync()
    await tick()

    expect(spacePicker.open).toBe(false)
    expect(dialog()).toBe(null)
  })
})
