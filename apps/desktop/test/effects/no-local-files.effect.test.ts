import { afterEach, beforeEach, expect, test, vi } from 'vitest'

/** nib opens nothing from outside its spaces.
 *
 *  Emil, 2026-09-30: *"for the user it shouldn't be possible to open local files on
 *  the computer. Only nib files should be possible to be opened. So there shouldn't
 *  be the linking to double click files to open them with nib anymore."*
 *
 *  The crate refuses such a path and the bundles claim no file type; this is the
 *  window's half, walked the way a person would try: the row that used to open a file
 *  is nowhere, Ctrl+O goes where a hand that learned it in Obsidian expects - the
 *  palette on the notes - and a file dragged in from Explorer and let go where nothing
 *  takes it is not opened in place of the app.
 *
 *  In the jsdom project because a keystroke and a drop are events on a document. */

const opened: string[] = []

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    if (command === 'read_note' && typeof args?.path === 'string') opened.push(args.path)
    return undefined
  },
}))

const { appCommands } = await import('../../src/lib/commands')
const { guardDrops } = await import('../../src/lib/drops')
const { SHORTCUTS } = await import('../../src/lib/shortcuts/registry')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')

beforeEach(() => {
  opened.length = 0
})

test('there is no Open file to press, in the palette or on a key', () => {
  const rows = appCommands()
  expect(rows.map((one) => one.id)).not.toContain('open')
  expect(rows.map((one) => one.label)).not.toContain('Open file')

  expect(SHORTCUTS.map((one) => one.id)).not.toContain('app.open')
  expect(SHORTCUTS.map((one) => one.label())).not.toContain('Open file')
})

test('Ctrl+O opens the palette on the notes, and nothing else', () => {
  const asked: string[] = []
  const nothing = () => undefined
  const context = {
    view: undefined,
    palette: (mode?: 'commands') => void asked.push(mode ?? 'notes'),
    fullscreen: nothing,
  }

  const handler = (event: KeyboardEvent) => void shortcuts.handle(event, context)
  window.addEventListener('keydown', handler)
  try {
    const press = new KeyboardEvent('keydown', {
      key: 'o',
      code: 'KeyO',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    document.body.dispatchEvent(press)

    expect(asked).toEqual(['notes'])
    expect(press.defaultPrevented).toBe(true)
    expect(opened).toEqual([])
  } finally {
    window.removeEventListener('keydown', handler)
  }
})

/** jsdom has no drag events of its own, so one is made the way a browser hands one
 *  over: a cancelable event on an element, carrying the transfer's types. */
function drag(type: 'dragover' | 'drop', on: Element, types: string[]): DragEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent
  const transfer = { types, dropEffect: 'copy', files: [], items: [] }
  Object.defineProperty(event, 'dataTransfer', { value: transfer })
  on.dispatchEvent(event)
  return event
}

let stop: (() => void) | undefined
let somewhere: HTMLElement

beforeEach(() => {
  stop = guardDrops()
  somewhere = document.createElement('div')
  document.body.append(somewhere)
})

afterEach(() => {
  stop?.()
  somewhere.remove()
})

test('a file let go where nothing takes it is not opened in place of the app', () => {
  const over = drag('dragover', somewhere, ['Files'])
  expect(over.defaultPrevented).toBe(true)
  expect(over.dataTransfer?.dropEffect).toBe('none')

  const dropped = drag('drop', somewhere, ['Files'])
  expect(dropped.defaultPrevented).toBe(true)
  expect(opened).toEqual([])
})

/** The file list copies a file in, and so does a note: a surface that takes the drag
 *  says so first, and what it said stands. */
test('while a surface that takes files keeps them', () => {
  const list = document.createElement('div')
  list.addEventListener('dragover', (event) => {
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  })
  somewhere.append(list)

  expect(drag('dragover', list, ['Files']).dataTransfer?.dropEffect).toBe('copy')
})

/** Text and links dragged over a field are the field's, and a link dropped on the tab
 *  strip is a page; none of them is a file. */
test('and a drag that carries no file is left alone', () => {
  const over = drag('dragover', somewhere, ['text/plain'])
  expect(over.defaultPrevented).toBe(false)
  expect(over.dataTransfer?.dropEffect).toBe('copy')
})
