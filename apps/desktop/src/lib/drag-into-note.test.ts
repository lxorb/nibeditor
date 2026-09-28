import { beforeEach, describe, expect, test } from 'vitest'
import { carriedNothing, carriedRows, carry } from './drag-paths'
import { linkedFiles } from './folder-notes'
import type { Entry } from './workspace.svelte'

/** A row of the file list dragged into a note's words: which rows the drag carries,
 *  and the file a link to each of them names. The editor's half, the link at the
 *  drop, is wikilink/note-links.test.ts in @nib/editor. */

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

/** A transfer as a `dragover` sees it: the types, and no data. */
function hidden() {
  const types: string[] = []
  return {
    types,
    effectAllowed: 'none',
    setData: (type: string) => void types.push(type),
    getData: () => '',
  }
}

beforeEach(() => {
  carriedNothing()
})

describe('the file a link to a row names', () => {
  test('is the file itself, as the space speaks of it', () => {
    expect(linkedFiles(tree, '/s', ['/s/A/B.md', '/s/paper.pdf'])).toEqual(['A/B.md', 'paper.pdf'])
  })

  /** What opening the row opens, written or not. */
  test('is the note a folder is drawn as, or the one it will be', () => {
    expect(linkedFiles(tree, '/s', ['/s/A', '/s/Trips'])).toEqual(['A/A.md', 'Trips/Trips.md'])
  })

  test('and is nothing for a path outside the space', () => {
    expect(linkedFiles(tree, '/s', ['/elsewhere/x.md'])).toEqual([])
  })
})

describe('what a drag carries over a note', () => {
  /** A browser hides the transfer until the drop, so the rows are the ones this
   *  window remembers carrying. */
  test('is the rows the list said it was carrying', () => {
    const transfer = hidden() as unknown as DataTransfer
    carry(transfer, ['/s/A', '/s/paper.pdf'])

    expect(carriedRows(transfer)).toEqual(['/s/A', '/s/paper.pdf'])
  })

  test('and nothing for a drag that did not start in the list', () => {
    carry(hidden() as unknown as DataTransfer, ['/s/A'])

    expect(carriedRows({ types: ['Files'] } as unknown as DataTransfer)).toEqual([])
  })
})
