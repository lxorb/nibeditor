import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed, root } from './runes.svelte'

/** Building the palette's rows writes nothing.
 *
 *  The palette works its list out in a `$derived`, and a derived may not write state
 *  made outside it: Svelte throws `state_unsafe_mutation` and the palette never
 *  opens. The export rows used to bring the note's words forward while they were
 *  being built, so opening the palette in the pause between a keystroke and the save
 *  that follows it failed, every time. A row reads; whatever it needs written first
 *  is written by its `run`.
 *
 *  Every list the palette and the `/` menu are built from is read here through a
 *  derived, the way a component reads it, with a note typed in and not yet brought
 *  forward - which is the state that found the bug. */

const notes = new Map<string, string>()

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      case 'list_spaces':
        return [{ name: 'space', path: '/space' }]
      case 'read_tree':
        return {
          name: 'space',
          path: '/space',
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
  },
}))

/** Svelte plays a transition through the Web Animations API, which jsdom lacks. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

const { workspace } = await import('../../src/lib/workspace.svelte')
const { appCommands, blockRows, exportCommands } = await import('../../src/lib/commands')
const { default: Palette } = await import('../../src/lib/Palette.svelte')

/** A note open and typed in, its words still a step behind what the editor holds. */
async function typed() {
  await workspace.open('/space/One.md')
  const note = workspace.active?.note
  if (!note) throw new Error('nothing opened')

  note.live.edit([{ from: note.live.text.length, to: note.live.text.length, insert: ' more' }])
}

/** What `$derived(of())` answers inside a component, or what it throws. */
function derived<T>(of: () => T): T {
  let read: (() => T) | undefined
  const stop = root(() => {
    read = computed(of)
  })

  try {
    if (!read) throw new Error('the root ran nothing')
    return read()
  } finally {
    stop()
  }
}

let target: HTMLElement

beforeEach(() => {
  notes.clear()
  notes.set('/space/One.md', '# One')
  workspace.spaces = [{ id: 's', name: 'space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.tabs = []
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  workspace.tabs = []
  target.remove()
})

test('the command list is read without writing, mid-typing', async () => {
  expect(derived(() => appCommands().length)).toBeGreaterThan(50)

  await typed()

  expect(derived(() => appCommands().length)).toBeGreaterThan(50)
  expect(derived(() => exportCommands().length)).toBeGreaterThan(0)
})

test('the `/` menu is read without writing, mid-typing', async () => {
  await typed()

  expect(derived(() => blockRows().length)).toBeGreaterThan(10)
})

test('the export rows still answer what the note has just become', async () => {
  await typed()
  const note = workspace.active?.note
  if (!note) throw new Error('nothing opened')

  // A rule between two written lines is what makes a note a deck; typed, and not yet
  // brought forward, it is already one to the export rows.
  const end = note.live.text.length
  note.live.edit([{ from: end, to: end, insert: '\n\n---\n\nTwo' }])

  const ids = derived(() => exportCommands().map((command) => command.id))
  expect(ids).toContain('export-slides-html')
})

test('the palette opens on the commands, mid-typing', async () => {
  await typed()

  const made = mount(Palette, { target, props: { open: false } })
  flushSync()

  try {
    await (made as unknown as { showCommands(): Promise<void> }).showCommands()
    flushSync()

    expect(target.querySelector('input')?.value).toBe('>')
    expect(target.querySelectorAll('[role="option"]').length).toBeGreaterThan(10)
  } finally {
    void unmount(made, { outro: false })
  }
})
