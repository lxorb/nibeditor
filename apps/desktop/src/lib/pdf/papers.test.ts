import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Searching the papers that have been read.
 *
 *  A page's words arrive as pdf.js hands them over - a list of runs, one per span
 *  it drew - and a row is a window on the page rather than a line of it, because a
 *  page has no lines.
 *
 *  The store under the second half of this is a Map: what is asserted there is that
 *  a paper read in one sitting answers in the next, and that a file which has
 *  changed under its words does not. */

const store = vi.hoisted(() => ({
  records: new Map<string, string>(),
  /** How many records have been read out of it, so "once per space" is a number
   *  rather than a hope. */
  reads: 0,
  /** Run as each record is read back, after the store has answered and before the
   *  answer lands. Which is what lets a test move a paper under a walk that is
   *  already in the air - the shape of this bug and the only way to drive it. */
  reading: null as ((path: string) => void) | null,
}))

vi.mock('../tauri', () => ({
  isNative: false,
  invoke: (command: string, args: Record<string, unknown> = {}) => {
    const at = args.path as string

    switch (command) {
      case 'read_paper_text': {
        // The store answers as it stood when it was asked, which is the whole of
        // the race: whatever happens next happens while this is on its way back.
        store.reads += 1
        const content = store.records.get(at) ?? ''
        store.reading?.(at)
        return Promise.resolve(content)
      }
      case 'write_paper_text': {
        const content = args.content as string
        if (content) store.records.set(at, content)
        else store.records.delete(at)
        return Promise.resolve(undefined)
      }
      case 'list_paper_texts':
        return Promise.resolve(
          [...store.records].map(([path, content]) => ({ path, size: content.length })),
        )
      default:
        return Promise.reject(new Error(`no such command: ${command}`))
    }
  },
}))

const {
  forgetPapers,
  paperGone,
  paperMoved,
  paperOpened,
  paperRead,
  papersFor,
  papersHeld,
  papersListed,
  papersRead,
  searchPapers,
  writePapers,
} = await import('./papers')
const { parseQuery } = await import('../search/query')

const ROOT = '/space'

/** One page, as the viewer would have read it: the words broken into the spans a
 *  PDF is actually drawn in. */
const page = (text: string) => text.split(' ')

const found = (source: string, excluded: readonly string[] = []) =>
  searchPapers(ROOT, parseQuery(source), 20, excluded)

beforeEach(() => {
  forgetPapers()
  store.records.clear()
  store.reads = 0
  store.reading = null
})

// The viewer writes a paper down a moment after the last page was read, so the
// timer it sets goes with the sitting the test was.
afterEach(() => {
  forgetPapers()
})

describe('a paper that has been read', () => {
  beforeEach(() => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 1, page('a study of ink on paper and its wear'))
    paperRead(`${ROOT}/papers/Ink.pdf`, 4, page('the kestrel hangs on the wind above the field'))
  })

  test('answers a query about its words', () => {
    const hits = found('kestrel')

    expect(hits).toHaveLength(1)
    expect(hits[0]?.page).toBe(4)
    expect(hits[0]?.name).toBe('Ink.pdf')
    expect(hits[0]?.path).toBe(`${ROOT}/papers/Ink.pdf`)
  })

  test('and the row is the words around the match, with the match in it', () => {
    const [hit] = found('kestrel')
    const range = hit?.ranges[0]

    expect(hit?.text).toContain('kestrel')
    expect(hit?.text.slice(range?.from, range?.to)).toBe('kestrel')
  })

  test('and answers once per page rather than once per word', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 7, page('ink ink ink ink ink'))

    expect(found('ink').map((hit) => hit.page)).toEqual([1, 7])
  })

  test('and its pages come in the order they are in the paper', () => {
    paperRead(`${ROOT}/papers/Ink.pdf`, 2, page('wind again'))

    expect(found('wind').map((hit) => hit.page)).toEqual([2, 4])
  })

  test('and a run is not joined to the next into a word neither says', () => {
    paperRead(`${ROOT}/papers/Odd.pdf`, 1, ['some', 'thing'])

    expect(found('something')).toEqual([])
    expect(found('some thing')).toHaveLength(1)
  })

  test('and the operators mean what they mean in a note', () => {
    expect(found('file:Ink').map((hit) => hit.page)).toEqual([1, 4])
    expect(found('path:papers').length).toBeGreaterThan(0)
    expect(found('kestrel -wind')).toEqual([])
  })

  test('and a paper the space leaves out answers nothing', () => {
    expect(found('kestrel', ['papers'])).toEqual([])
    expect(found('kestrel', ['papers/Ink.pdf'])).toEqual([])
    expect(found('kestrel', ['paper'])).toHaveLength(1)
  })

  test('and a paper in another space is not this space s to answer', () => {
    paperRead('/elsewhere/Other.pdf', 1, page('kestrel again'))

    expect(found('kestrel').map((hit) => hit.path)).toEqual([`${ROOT}/papers/Ink.pdf`])
  })

  test('and one that has gone answers nothing', () => {
    paperGone(`${ROOT}/papers/Ink.pdf`)

    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })
})

describe('a space where nothing has been read', () => {
  test('answers nothing, and costs nothing to ask', () => {
    expect(found('kestrel')).toEqual([])
    expect(papersRead()).toBe(0)
  })

  test('and a page with no words in it is not an answer', () => {
    paperRead(`${ROOT}/Blank.pdf`, 1, ['', '  '])

    expect(found('anything')).toEqual([])
  })
})

describe('a paper read in an earlier sitting', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`

  /** What the file list says about the paper: one path, one moment. */
  const listed = (modified: number) => new Map([[PAPER, modified]])

  /** The launch's own pass: the file list says what it says, and then the store is
   *  read back against it. */
  const readBack = async (modified: number) => {
    papersListed(ROOT, listed(modified))
    await papersFor(ROOT)
  }

  test('is written down and answers again after everything is forgotten', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 3, page('a study of ink on paper and its wear'))
    await writePapers()

    // The restart: nothing in memory, and the store still holding the words.
    forgetPapers()
    expect(found('ink')).toEqual([])

    await readBack(10)
    const hits = found('ink')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.page).toBe(3)
    expect(papersHeld().papers).toBe(1)
  })

  test('is read back once per space however often a search asks', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink again'))
    await writePapers()
    forgetPapers()

    await readBack(10)
    store.reads = 0

    // The same space again is the promise that was kept, not a second read.
    await papersFor(ROOT)
    await papersFor(ROOT)
    expect(store.reads).toBe(0)
    expect(papersHeld().papers).toBe(1)
  })

  test('is not trusted when the file has been written since', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink as it was'))
    await writePapers()
    forgetPapers()

    await readBack(11)
    expect(found('ink')).toEqual([])
  })

  test('and a paper whose bytes are now something else loses the words that were its', () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink as it was'))
    expect(found('ink')).toHaveLength(1)

    // The same path, another file.
    paperOpened(PAPER, 'def', 12)
    expect(found('ink')).toEqual([])
  })

  test('and a paper nobody has named is held for the sitting and written nowhere', async () => {
    paperRead(PAPER, 1, page('ink from nowhere'))
    await writePapers()

    // It answers, because its words are here.
    expect(found('ink')).toHaveLength(1)
    // And nothing was written down, because nothing could say which file it was.
    expect(store.records.size).toBe(0)
  })

  test('and one that has gone takes its words out of the store as well', async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink'))
    await writePapers()
    expect(store.records.size).toBe(1)

    paperGone(PAPER)
    await Promise.resolve()
    expect(store.records.size).toBe(0)
  })
})

/** A space still being read back.
 *
 *  The read-back is a walk of the store with a round trip per paper, and the space
 *  does not hold still for it: a PDF can be deleted, renamed, or moved with the
 *  folder it sits in while the walk is in the air. What it read is the store as it
 *  stood when it asked, so landing it as it comes puts a paper back under a path
 *  that has nothing at it - and a search then answers with its pages, on a row that
 *  opens nothing, for the rest of the sitting. */
describe('a paper that changes while the store is being read back', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`
  const listed = (modified: number) => new Map([[PAPER, modified]])

  const readBack = async (modified: number) => {
    papersListed(ROOT, listed(modified))
    await papersFor(ROOT)
  }

  /** One paper taken down in an earlier sitting and nothing in memory, which is
   *  the state a read-back starts from. */
  const takenDown = async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('a study of ink on paper and its wear'))
    await writePapers()
    forgetPapers()
  }

  test('is not put back when it was deleted while the walk was in the air', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(PAPER)
    }
    await readBack(10)

    expect(found('ink')).toEqual([])
    expect(papersRead()).toBe(0)
  })

  test('and is not put back under the name a rename took away', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperMoved(PAPER, `${ROOT}/papers/Wear.pdf`)
    }
    await readBack(10)

    expect(found('ink').map((one) => one.path)).toEqual([])
  })

  test('and not under it when the folder it sat in is what moved', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperMoved(`${ROOT}/papers`, `${ROOT}/shelf`)
    }
    await readBack(10)

    expect(found('ink').map((one) => one.path)).toEqual([])
  })

  test('and a paper nothing touched still lands', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(`${ROOT}/papers/Other.pdf`)
    }
    await readBack(10)

    expect(found('ink')).toHaveLength(1)
  })

  test('and the next read-back of the space is not held to what the last one missed', async () => {
    await takenDown()

    store.reading = (path) => {
      if (path === PAPER) paperGone(PAPER)
    }
    await readBack(10)
    expect(found('ink')).toEqual([])

    // The paper is back at that path, with its words taken down again. Nothing
    // that was written down while the last walk was in the air is still in the way.
    store.reading = null
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('ink once more'))
    expect(found('ink')).toHaveLength(1)
  })
})

/** Which of the two reads of the store actually runs.
 *
 *  It is read back once per space, and two callers ask for it: the launch's own
 *  pass, which has the file list in hand, and a search, which has only the root. A
 *  query fence in the note the app opens is a search before the launch's pass has
 *  had its turn, so whichever of them got there first used to decide whether a
 *  record was held against the file at all. */
describe('a space read back before the file list has said anything', () => {
  const PAPER = `${ROOT}/papers/Ink.pdf`
  const listed = (modified: number) => new Map([[PAPER, modified]])

  beforeEach(async () => {
    paperOpened(PAPER, 'abc', 10)
    paperRead(PAPER, 1, page('a study of ink on paper and its wear'))
    await writePapers()
    forgetPapers()
  })

  test('answers from the store, because nothing has said what the file looks like now', async () => {
    await papersFor(ROOT)
    expect(found('ink')).toHaveLength(1)
  })

  test('and lets go of the words once the listing says the file has been written since', async () => {
    await papersFor(ROOT)
    expect(found('ink')).toHaveLength(1)

    papersListed(ROOT, listed(11))
    expect(found('ink')).toEqual([])

    // And the store is not read back into memory behind it either.
    await papersFor(ROOT)
    expect(found('ink')).toEqual([])
  })

  test('and keeps them where the listing says the file is the one they came from', async () => {
    await papersFor(ROOT)
    papersListed(ROOT, listed(10))
    await papersFor(ROOT)

    expect(found('ink')).toHaveLength(1)
  })

  test('and the listing landing first is what the search is held to', async () => {
    papersListed(ROOT, listed(11))
    await papersFor(ROOT)

    expect(found('ink')).toEqual([])
  })

  test('and one that lands while the walk is in the air is held against it too', async () => {
    store.reading = (path) => {
      if (path === PAPER) papersListed(ROOT, listed(11))
    }
    await papersFor(ROOT)

    expect(found('ink')).toEqual([])
  })
})
