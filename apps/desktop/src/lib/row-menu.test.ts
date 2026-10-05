import { beforeEach, describe, expect, test, vi } from 'vitest'
import { de } from '../locales/de'

/** What a row of the file list offers, read as a list of labels.
 *
 *  The point of the test is what is not there: no row anywhere offers to make a
 *  folder, because nothing in the interface is one. What is there is one menu for
 *  every row - a note, a note that holds notes, a folder out of somebody's vault,
 *  a PDF - differing only in the entries that mean something for it.
 *
 *  The store reads storage the moment it is made, so that is stood in for before
 *  it is imported; the entries run here keep what they change in memory, so
 *  nothing reaches a disk. */

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

/** Whether the file the row stands for is one the account could hand to somebody:
 *  its space is the account's own and the account has a copy of the file. That is
 *  sharing.svelte.ts's to work out from an account and a sync that a unit test has
 *  neither of, so it is stood in for - and both answers are worth a menu, because
 *  a row offers the word only while there is something to share. */
const shareable = { yes: false }

/** Whether the space may be written in, which is what archiving asks: a space shared
 *  to be read keeps its archive as its owner left it. */
const writable = { yes: true }

vi.mock('./sharing.svelte', () => ({
  canShareItem: () => shareable.yes,
  canWriteAt: () => writable.yes,
  shareThisFile: () => undefined,
}))

const copied: string[] = []
vi.mock('./clipboard', () => ({
  copyText: (text: string) => {
    copied.push(text)
    return Promise.resolve()
  },
}))

const { rowMenu } = await import('./row-menu')
const { workspace } = await import('./workspace.svelte')
// Copy link fetches the code that spells a link the first time it is pressed. Fetched
// here, so the press waits on no module's first load: on a busy machine that alone is
// longer than a wait for the clipboard.
await (await import('@nib/editor')).noteLinksCode()
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

/** A space holding all four kinds of row: a note, a note that holds notes, a
 *  folder nobody has written a note in, and a paper. */
const nested = folder('/s/A', [note('/s/A/A.md'), note('/s/A/B.md')])
const plain = folder('/s/Projects', [note('/s/Projects/plan.md')])
const loose = note('/s/loose.md')
const paper = note('/s/paper.pdf')
const tree = folder('/s', [nested, plain, loose, paper])

/** The labels the menu offers, dividers left out. */
function labels(entry: Entry): string[] {
  return rowMenu(entry).flatMap((one) => (one === null ? [] : [one.label]))
}

beforeEach(() => {
  workspace.spaces = [{ id: 's', name: 'Notes', root: '/s' }]
  workspace.activeSpaceId = 's'
  workspace.tree = tree
  workspace.clearSelection()
  shareable.yes = false
  writable.yes = true
  workspace.archive.forget('/s')
})

describe('every row', () => {
  const rows = [nested, plain, loose, paper]

  test('offers no folder, anywhere, under any name', () => {
    for (const entry of rows) {
      for (const label of labels(entry)) {
        expect(label.toLowerCase(), entry.path).not.toContain('folder')
      }
    }
  })

  /** Which is also the whole of the German dictionary's word for one: a label that
   *  came back saying "Ordner" would be a folder in the interface in another
   *  language. */
  test('and the word is gone from the dictionaries too', () => {
    expect(Object.keys(de)).not.toContain('New folder')
    expect(Object.keys(de)).not.toContain('Folder')
  })

  test('opens, renames, moves and deletes, in that order', () => {
    for (const entry of rows) {
      const said = labels(entry)

      expect(said[0], entry.path).toBe('Open')
      expect(said, entry.path).toContain('Rename')
      expect(said, entry.path).toContain('Move')
      expect(said.at(-1), entry.path).toBe('Delete')
    }
  })
})

describe('a note', () => {
  test('can hold a note, and can be copied', () => {
    expect(labels(loose)).toEqual([
      'Open',
      'Open in new tab',
      'Open to the side',
      'New note inside',
      'Rename',
      'Move',
      'Choose an icon',
      'Set cover',
      'Bookmark',
      'Leave out of search',
      'Archive',
      'Copy link',
      'Duplicate',
      'Delete',
    ])
  })
})

describe('a note that holds notes', () => {
  /** A copy of the folder, with its note renamed to match; see copying.ts. */
  test('is the same menu', () => {
    expect(labels(nested)).toEqual(labels(loose))
  })
})

describe('a folder nobody has written a note in', () => {
  /** The same menu, less the things that need a file: a cover, and a pane to show
   *  it in beside another. An icon it can still have, because a folder with no note
   *  keeps one in the space's own map; front matter needs somewhere to be written. */
  test('offers exactly what a note offers, less the cover and the side', () => {
    expect(labels(plain)).toEqual(
      labels(nested).filter((one) => one !== 'Set cover' && one !== 'Open to the side'),
    )
  })
})

describe('a paper', () => {
  /** Nowhere to keep an icon, and a paper cannot hold a note. It copies as the
   *  bytes it is. So the menu is what every row can do and nothing else. */
  test('holds nothing, wears nothing and duplicates as a paper', () => {
    expect(labels(paper)).toEqual([
      'Open',
      'Open in new tab',
      'Open to the side',
      'Rename',
      'Move',
      'Bookmark',
      'Leave out of search',
      'Archive',
      'Copy link',
      'Duplicate',
      'Delete',
    ])
  })
})

/** A file on an account the reader owns, which is the only row that has anybody
 *  to be handed to; see sharing.svelte.ts. */
describe('a file the account has a copy of', () => {
  test('says who else may have it, beside what the space says about it', () => {
    shareable.yes = true

    expect(labels(loose)).toEqual([
      'Open',
      'Open in new tab',
      'Open to the side',
      'New note inside',
      'Rename',
      'Move',
      'Choose an icon',
      'Set cover',
      'Bookmark',
      'Leave out of search',
      'Archive',
      'Share',
      'Copy link',
      'Duplicate',
      'Delete',
    ])
  })

  /** The row is the folder and the note in one, and the note is the file: the
   *  share is about that, which is the same path the icon is written in. */
  test('and a note that holds notes is shared as the note it is drawn as', () => {
    shareable.yes = true

    expect(labels(nested)).toEqual([
      'Open',
      'Open in new tab',
      'Open to the side',
      'New note inside',
      'Rename',
      'Move',
      'Choose an icon',
      'Set cover',
      'Bookmark',
      'Leave out of search',
      'Archive',
      'Share',
      'Copy link',
      'Duplicate',
      'Delete',
    ])
  })

  test('and so can a paper', () => {
    shareable.yes = true

    expect(labels(paper)).toEqual([
      'Open',
      'Open in new tab',
      'Open to the side',
      'Rename',
      'Move',
      'Bookmark',
      'Leave out of search',
      'Archive',
      'Share',
      'Copy link',
      'Duplicate',
      'Delete',
    ])
  })
})

describe('a row that is part of a selection of several', () => {
  test('stands for the lot, and offers only what makes sense for a lot', () => {
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/paper.pdf')

    expect(labels(loose)).toEqual([
      'Open all',
      'Move',
      'Bookmark',
      'Archive',
      'Copy link',
      'Delete 2 items',
    ])
  })

  test('and bookmarks the lot with one press, or takes the lot out once all are in', () => {
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/A')

    const press = (label: string) =>
      rowMenu(loose)
        .find((one) => one?.label === label)
        ?.run()
    press('Bookmark')

    expect(workspace.bookmarks.list.map((one) => one.path)).toEqual(['loose.md', 'A/A.md'])
    expect(labels(loose)).toContain('Remove bookmark')

    press('Remove bookmark')
    expect(workspace.bookmarks.list).toEqual([])
  })

  test('and copies a link a line, in the spelling the Links setting asks for', async () => {
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/A')
    copied.length = 0

    rowMenu(loose)
      .find((one) => one?.label === 'Copy link')
      ?.run()
    await vi.waitFor(() => {
      expect(copied).toEqual(['[[loose]]\n[[A]]'])
    })
  })

  test('while a selection of one is an ordinary row', () => {
    workspace.select('/s/loose.md')
    expect(labels(loose)[0]).toBe('Open')
  })
})

describe('the archive', () => {
  test('is offered on every row, and not in a space shared to be read', () => {
    for (const entry of [nested, plain, loose, paper]) expect(labels(entry)).toContain('Archive')

    writable.yes = false
    expect(labels(loose)).not.toContain('Archive')
  })

  test('and a folder holding something archived is not deleted from its menu', async () => {
    await workspace.archive.change('/s', ['Projects/plan.md'], [])

    expect(workspace.keepsArchived('/s/Projects')).toBe(true)
    expect(workspace.keepsArchived('/s/loose.md')).toBe(false)
  })

  test('and a selection counts only the rows that can go', async () => {
    await workspace.archive.change('/s', ['Projects/plan.md'], [])
    workspace.select('/s/loose.md')
    workspace.toggleSelect('/s/Projects')

    expect(labels(loose)).toContain('Delete 1 item')
  })
})
