import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** The scratchpad as a switch in the bar and a card at the window's edge, never a tab.
 *
 *  Emil, 2026-10-05: *"The scratchpad should never open as a tab. It should be basically
 *  a thing in the top right that you can click, and then it is selected or it isn't."*
 *  This asks what the switch says, that nothing it does reaches the tabs, the key, and
 *  the card's own keyboard: in when asked for, Escape out, and back where it was. In the
 *  jsdom project because the editor in the card is a real one. */

const disk = vi.hoisted(() => ({ current: null as import('../disk').Disk | null }))

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: false,
  isNative: true,
  invoke: (command: string, args?: Record<string, unknown>) => {
    if (command === 'scratchpad_path') return Promise.resolve(PAD)
    if (command === 'list_spaces') return Promise.resolve([])
    if (!disk.current) throw new Error('no disk')
    return disk.current.invoke(command, args)
  },
}))

const PAD = '/app/Scratchpad.md'

// jsdom lays nothing out, and a focused editor measures where its caret is.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList
Range.prototype.getBoundingClientRect = () => new DOMRect()
Element.prototype.scrollIntoView = () => undefined
globalThis.ResizeObserver = class {
  observe() {
    // Nothing to measure.
  }

  unobserve() {
    // Nothing to measure.
  }

  disconnect() {
    // Nothing to measure.
  }
}

const { Disk } = await import('../disk')
const { default: Titlebar } = await import('../../src/lib/Titlebar.svelte')
const { default: ScratchpadCard } = await import('../../src/lib/scratchpad/ScratchpadCard.svelte')
const { shown, toggleScratchpad } = await import('../../src/lib/scratchpad/is.svelte')
const { scratchpad } = await import('../../src/lib/scratchpad/pad')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { menu } = await import('../../src/lib/menu.svelte')
const { tabMenu } = await import('../../src/lib/tab-strip/menu')
type MenuEntry = import('../../src/lib/menu-item').MenuEntry

let target: HTMLElement
let undo: (() => void)[] = []

beforeEach(() => {
  disk.current = new Disk()
  disk.current.files.set(PAD, 'First thought\n')
  workspace.spaces = [{ id: 'work', name: 'Work', root: '/spaces/Work' }]
  workspace.activeSpaceId = 'work'
  shown.on = false
  shown.calling = false
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  for (const one of undo) one()
  undo = []
  target.remove()
})

function bar() {
  const made = mount(Titlebar, {
    target,
    props: { onpalette: () => undefined, onhistory: () => undefined },
  })
  flushSync()
  undo.push(() => void unmount(made, { outro: false }))
}

/** The card in the column App.svelte keeps for it, with its editor built. */
async function card() {
  const column = document.createElement('div')
  column.dataset.scratchpad = ''
  target.append(column)
  const made = mount(ScratchpadCard, { target: column })
  undo.push(() => void unmount(made, { outro: false }))
  await vi.waitFor(() => expect(scratchpad.live).not.toBe(null))
  flushSync()
  return column
}

const glyph = () => target.querySelector<HTMLButtonElement>('header button.pad')

test('the switch in the bar is pressed while the card is up, and makes no tab', () => {
  bar()
  const tabs = workspace.tabs.length

  expect(glyph()?.getAttribute('aria-pressed')).toBe('false')
  expect(glyph()?.getAttribute('aria-label')).toBe('Scratchpad')

  glyph()?.click()
  flushSync()
  expect(shown.on).toBe(true)
  expect(glyph()?.getAttribute('aria-pressed')).toBe('true')
  expect(glyph()?.classList.contains('is-on')).toBe(true)
  expect(workspace.tabs.length).toBe(tabs)

  glyph()?.click()
  flushSync()
  expect(shown.on).toBe(false)
  expect(glyph()?.getAttribute('aria-pressed')).toBe('false')
})

test('a press on the switch leaves the keyboard where it is', () => {
  bar()
  const press = new PointerEvent('pointerdown', { bubbles: true, cancelable: true })
  glyph()?.dispatchEvent(press)
  expect(press.defaultPrevented).toBe(true)
})

test('opening its file from anywhere shows the card instead of a tab', async () => {
  const tabs = workspace.tabs.length
  await workspace.open(PAD)
  expect(shown.on).toBe(true)
  expect(shown.calling).toBe(true)
  expect(workspace.tabs.length).toBe(tabs)
  expect(workspace.tabs.some((one) => one.path === PAD)).toBe(false)
})

test('Ctrl+Shift+X: up, then the keyboard into it from elsewhere, then away from inside', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  toggleScratchpad()
  expect(shown.on).toBe(true)
  const column = await card()
  expect(column.contains(document.activeElement)).toBe(true)

  // The keyboard taken elsewhere while the card stays up: the key brings it back.
  outside.focus()
  toggleScratchpad()
  flushSync()
  expect(shown.on).toBe(true)
  expect(column.contains(document.activeElement)).toBe(true)

  // From inside the card, the key puts it away.
  toggleScratchpad()
  expect(shown.on).toBe(false)
  expect(document.activeElement).toBe(outside)
})

test('the card takes the keyboard when asked, and Escape gives it back', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  shown.show()
  const column = await card()
  const editor = column.querySelector<HTMLElement>('.cm-content')
  expect(document.activeElement).toBe(editor)
  expect(scratchpad.live?.state.doc.toString()).toBe('First thought\n')

  editor?.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
  )
  expect(shown.on).toBe(false)
  expect(document.activeElement).toBe(outside)
})

test('a card put back by the launch does not take the keyboard', async () => {
  const outside = document.createElement('input')
  target.append(outside)
  outside.focus()

  shown.show(false)
  await card()
  expect(document.activeElement).toBe(outside)
})

test('what is typed is written as the card goes, and an append lands in the card', async () => {
  shown.show()
  await card()
  const view = scratchpad.live
  view?.dispatch({ changes: { from: view.state.doc.length, insert: 'Second' } })

  await scratchpad.append('From the quick question')
  expect(view?.state.doc.toString()).toBe('First thought\nSecond\n\nFrom the quick question\n')
  expect(disk.current?.files.get(PAD)).toBe('First thought\nSecond\n\nFrom the quick question\n')

  view?.dispatch({ changes: { from: 0, insert: '# ' } })
  for (const one of undo) one()
  undo = []
  await vi.waitFor(() =>
    expect(disk.current?.files.get(PAD)).toBe(
      '# First thought\nSecond\n\nFrom the quick question\n',
    ),
  )
  expect(scratchpad.live).toBe(null)
})

test("an agent's edit lands in the card around the caret, and a stale one is refused", async () => {
  shown.show()
  await card()
  const view = scratchpad.live
  view?.dispatch({ selection: { anchor: 5 } })

  expect(await scratchpad.replace('First thought\n', [{ from: 0, to: 0, insert: '> ' }])).toBe(true)
  expect(view?.state.doc.toString()).toBe('> First thought\n')
  expect(view?.state.selection.main.head).toBe(7)
  expect(disk.current?.files.get(PAD)).toBe('> First thought\n')

  expect(await scratchpad.replace('First thought\n', [{ from: 0, to: 5, insert: '' }])).toBe(false)
  expect(view?.state.doc.toString()).toBe('> First thought\n')
})

test("with the card away, an agent's edit is written to the file", async () => {
  expect(
    await scratchpad.replace('First thought\n', [{ from: 14, to: 14, insert: 'More\n' }]),
  ).toBe(true)
  expect(disk.current?.files.get(PAD)).toBe('First thought\nMore\n')
})

/** A tab's rows that would move, rename or put away the file, or point at a space. */
const A_FILES_ROWS = ['Move to space', 'Rename', 'Show in the file list', 'Duplicate']

const labels = (entries: readonly MenuEntry[]) => entries.flatMap((one) => (one ? [one.label] : []))

const TWO_SPACES = [
  { id: 'work', name: 'Work', root: '/spaces/Work' },
  { id: 'home', name: 'Home', root: '/spaces/Home' },
]

// lxorb, issue #231: "when right clicking on the scratchpad there's 'move to space' which
// doesn't make sense". It is in no space and no tab, so a tab's or a file's rows are not its.
test('a right click on the switch offers nothing, Move to space least of all', async () => {
  workspace.spaces = TWO_SPACES
  bar()

  const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  glyph()?.dispatchEvent(click)
  await vi.dynamicImportSettled()
  flushSync()
  expect(menu.open).toBe(false)
  for (const row of A_FILES_ROWS) expect(labels(menu.items)).not.toContain(row)
})

test("a note in a space keeps the rows the scratchpad's switch leaves out", async () => {
  workspace.spaces = TWO_SPACES
  disk.current?.files.set('/spaces/Work/Plan.md', '# Plan\n')
  await workspace.loadTree()
  await workspace.openEntry('/spaces/Work/Plan.md')
  const plan = workspace.tabs.find((one) => one.path === '/spaces/Work/Plan.md')
  if (!plan) throw new Error('no tab for the note')
  undo.push(() => workspace.close(plan.id, false))

  const rows = labels(tabMenu(plan, plan.paneId))
  for (const row of A_FILES_ROWS) expect(rows).toContain(row)
})
