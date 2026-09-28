import { beforeEach, describe, expect, test, vi } from 'vitest'

/** Rows of the file list as links, which is what a row dragged into a note and a
 *  row's Copy link both write. The store reads storage the moment it is made, so
 *  that is stood in for before it is imported, and the clipboard is caught. */

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

const copied: string[] = []
vi.mock('./clipboard', () => ({
  copyText: (text: string) => {
    copied.push(text)
    return Promise.resolve()
  },
}))

const { carriedNotes, copyRowLinks, linkedPaths } = await import('./row-links')
const { carry, carriedNothing } = await import('./drag-paths')
const { workspace } = await import('./workspace.svelte')
type Entry = import('./workspace.svelte').Entry

function note(path: string): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: false,
    modified: 0,
    created: 0,
    children: [],
  }
}

function folder(path: string, children: Entry[] = []): Entry {
  return {
    name: path.split('/').pop() ?? path,
    path,
    is_dir: true,
    modified: 0,
    created: 0,
    children,
  }
}

const tree = folder('/s', [
  folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md')]),
  folder('/s/Trips', [note('/s/Trips/Rome.md')]),
  note('/s/paper.pdf'),
])

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
  workspace.tree = tree
  copied.length = 0
  carriedNothing()
})

describe('a row as the file a link names', () => {
  test('is the file itself, as the space speaks of it', () => {
    expect(linkedPaths(tree, '/s', ['/s/A/B.md', '/s/paper.pdf'])).toEqual(['A/B.md', 'paper.pdf'])
  })

  /** What opening the row opens, written or not. */
  test('is the note a folder is drawn as, or the one it will be', () => {
    expect(linkedPaths(tree, '/s', ['/s/A', '/s/Trips'])).toEqual(['A/A.md', 'Trips/Trips.md'])
  })

  test('and is nothing for a path outside the space', () => {
    expect(linkedPaths(tree, '/s', ['/elsewhere/x.md'])).toEqual([])
  })
})

describe('a drag over a note', () => {
  /** A browser hides the transfer until the drop, so the rows are the ones this
   *  window remembers carrying; a drag that is not the list's carries none. */
  test('carries the rows the list said it was carrying', () => {
    const data = new Map<string, string>()
    const transfer = {
      types: [] as string[],
      setData(type: string, value: string) {
        data.set(type, value)
        this.types.push(type)
      },
      getData: () => '',
      effectAllowed: 'none',
    }
    carry(transfer as unknown as DataTransfer, ['/s/A', '/s/paper.pdf'])

    expect(carriedNotes(transfer as unknown as DataTransfer)).toEqual(['A/A.md', 'paper.pdf'])
    expect(carriedNotes({ types: ['Files'] } as unknown as DataTransfer)).toEqual([])
  })
})

describe('Copy link', () => {
  test('copies a line per row, in the spelling the Links setting asks for', async () => {
    await copyRowLinks(['/s/A/B.md', '/s/Trips'])

    expect(copied).toEqual(['[[B]]\n[[Trips]]'])
  })
})
