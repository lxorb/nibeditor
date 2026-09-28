import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Saving a note on a machine that has no space yet.
 *
 *  A fresh install has no space until somebody makes one, and the empty pane still
 *  offers a new note. Typing into it and pressing Ctrl+S used to do nothing at all:
 *  the save sheet had no folder to offer, so it answered "dismissed" before it was
 *  shown, and the words stayed in a tab with nowhere to go. A save that silently
 *  does nothing is the one answer a save must never give.
 *
 *  So a first save makes the first space - under the app's own word for a folder of
 *  notes, the one the browser build keeps its notes in - and writes the note into
 *  it, the way Obsidian's first launch always ends in a vault before any note is
 *  written. Nothing is made when the question is dismissed. */

const notes = new Map<string, string>()
const sent: string[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** The spaces folder, as the crate would list it: empty until one is made. */
const made: { name: string; path: string }[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    sent.push(command)
    const path = text(args?.path)
    switch (command) {
      case 'create_space': {
        const name = text(args?.name)
        const space = { name, path: `/spaces/${name}` }
        made.push(space)
        return space
      }
      case 'list_spaces':
        return made
      case 'read_tree': {
        const root = made[0]?.path ?? '/spaces'
        return { name: 'space', path: root, is_dir: true, modified: 0, created: 0, children: [] }
      }
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      default:
        return undefined
    }
  },
}))

/** The save sheet, answered from here. */
const sheet = { name: null as string | null, asked: 0 }

vi.mock('./prompt.svelte', () => ({
  prompt: {
    askName: () => {
      sheet.asked += 1
      return Promise.resolve(
        sheet.name === null ? null : { name: sheet.name, space: null, folder: null },
      )
    },
  },
}))

function memoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    key: (index) => [...store.keys()][index] ?? null,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
  }
}
vi.stubGlobal('localStorage', memoryStorage())

const { workspace } = await import('./workspace.svelte')

beforeEach(() => {
  notes.clear()
  sent.length = 0
  made.length = 0
  sheet.name = null
  sheet.asked = 0
  workspace.spaces = []
  workspace.activeSpaceId = null
  workspace.tree = null
  workspace.tabs = []
})

describe('saving a note while there is no space', () => {
  test('makes the first space and writes the note into it', async () => {
    workspace.openBlank('Untitled', '# Plan\n\nwords\n')
    sheet.name = 'Plan'

    await workspace.save()

    expect(sheet.asked).toBe(1)
    expect(sent).toContain('create_space')
    expect(workspace.spaces.map((one) => one.name)).toEqual(['Notes'])
    expect(notes.get('/spaces/Notes/Plan.md')).toBe('# Plan\n\nwords\n')
    expect(workspace.active?.path).toBe('/spaces/Notes/Plan.md')
  })

  test('makes nothing when the question is dismissed', async () => {
    workspace.openBlank('Untitled', '# Plan\n')

    await workspace.save()

    expect(sheet.asked).toBe(1)
    expect(sent).not.toContain('create_space')
    expect(workspace.spaces).toEqual([])
  })
})
