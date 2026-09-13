import { describe, expect, test, vi } from 'vitest'

/** Giving a note a cover writes the note's own words, so it goes through
 *  everything a write goes through: the version before it is kept, a note open in a
 *  pane takes the words in its editor rather than off the disk, and the lot is one
 *  thing to undo. This stands a disk and a browser store in for the ones under node
 *  and imports the workspace after them, the way file-icon.test does beside it - and
 *  for the same reason.
 *
 *  The choosing is not here: a file chooser is a dialog the machine owns and a test
 *  has no way to answer one. `setCover` is the writing on its own. */

const SPACE: Record<string, string> = {
  '/space/plain.md': '# Plain\n\nwords\n',
  '/space/titled.md': '---\ntitle: Titled\n---\n\n# Titled\n',
  '/space/covered.md': '---\ncover: assets/old.jpg\ncover-position: 20\n---\n\n# Covered\n',
  '/space/only.md': '---\ncover: assets/only.jpg\n---\n\n# Only a cover\n',
}

let notes: Record<string, string> = { ...SPACE }

const pathOf = (args?: Record<string, unknown>) => (typeof args?.path === 'string' ? args.path : '')

const sent: { command: string; path: string; content: string }[] = []

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = pathOf(args)
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })

    if (command === 'write_note') {
      notes[path] = content
      return undefined
    }
    if (command !== 'read_note') return undefined

    const doc = notes[path]
    if (doc === undefined) throw new Error(`no such note: ${path}`)
    return doc
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

const { canHaveCover, removeCover, setCover } = await import('./note-cover')
const { workspace } = await import('./workspace.svelte')

function written(path: string): string | null {
  const write = sent.filter((one) => one.command === 'write_note' && one.path === path).pop()
  return write?.content ?? null
}

function fresh() {
  notes = { ...SPACE }
  workspace.tabs = []
  workspace.activeTabId = null
  workspace.undone.stack = []
  sent.length = 0
}

describe('the cover a note is given', () => {
  test('opens a front matter block on a note that had none', async () => {
    fresh()
    await setCover('/space/plain.md', 'assets/wide.jpg')

    expect(written('/space/plain.md')).toBe('---\ncover: assets/wide.jpg\n---\n# Plain\n\nwords\n')
  })

  test('joins the keys a note already had', async () => {
    fresh()
    await setCover('/space/titled.md', 'assets/wide.jpg')

    expect(written('/space/titled.md')).toBe(
      '---\ntitle: Titled\ncover: assets/wide.jpg\n---\n\n# Titled\n',
    )
  })

  test('replaces the picture that was there, and puts its band back in the middle', async () => {
    // A band is a place in one picture: keeping the old number over a new
    // photograph is a crop somebody chose of something they have not seen.
    fresh()
    await setCover('/space/covered.md', 'assets/new.jpg')

    expect(written('/space/covered.md')).toBe('---\ncover: assets/new.jpg\n---\n\n# Covered\n')
  })

  test('keeps the words that were there before it, and is one thing to undo', async () => {
    fresh()
    await setCover('/space/covered.md', 'assets/new.jpg')

    const touched = sent.filter((one) => one.path === '/space/covered.md')
    expect(touched.map((one) => one.command)).toEqual(['read_note', 'snapshot_note', 'write_note'])
    expect(touched[1]?.content).toContain('cover: assets/old.jpg')
    expect(workspace.undone.stack).toHaveLength(1)
  })

  test('choosing the cover a note already has writes nothing at all', async () => {
    fresh()
    await setCover('/space/only.md', 'assets/only.jpg')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

describe('taking a note’s cover away', () => {
  test('takes both keys with it', async () => {
    fresh()
    await removeCover('/space/covered.md')

    expect(written('/space/covered.md')).toBe('# Covered\n')
  })

  test('and the whole block where the cover was all it held', async () => {
    fresh()
    await removeCover('/space/only.md')

    expect(written('/space/only.md')).toBe('# Only a cover\n')
  })

  test('a note that never had one is not written to', async () => {
    fresh()
    await removeCover('/space/plain.md')

    expect(sent.filter((one) => one.command === 'write_note')).toEqual([])
  })
})

/** The half a file on disk cannot show: a note somebody is reading while its cover
 *  changes. The words arrive in the editor, and the note stays saved. */
describe('a note that is open while its cover changes', () => {
  test('takes the change in its own document, and stays saved', async () => {
    fresh()
    await workspace.open('/space/plain.md')
    await setCover('/space/plain.md', 'assets/wide.jpg')

    const tab = workspace.tabs.find((one) => one.path === '/space/plain.md')
    expect(tab?.doc).toBe('---\ncover: assets/wide.jpg\n---\n# Plain\n\nwords\n')
    expect(tab?.dirty).toBe(false)
  })

  test('and undoing puts the note back the way its reader had it', async () => {
    fresh()
    await workspace.open('/space/covered.md')
    await setCover('/space/covered.md', 'assets/new.jpg')
    await workspace.undoFileAction()

    expect(workspace.tabs.find((one) => one.path === '/space/covered.md')?.doc).toBe(
      SPACE['/space/covered.md'],
    )
  })
})

describe('what can have one', () => {
  test('is a note, and not a plane, a set of pages or a folder', () => {
    expect(canHaveCover('/space/note.md')).toBe(true)
    expect(canHaveCover('/space/Board.canvas')).toBe(false)
    expect(canHaveCover('/space/Deck.pages')).toBe(false)
    expect(canHaveCover('/space/folder')).toBe(false)
    expect(canHaveCover(null)).toBe(false)
  })
})
