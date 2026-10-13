import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The store writes to the browser's storage and offers every change to the
 *  account, so both are stood in for before it is imported. */

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

const pushed: string[] = []
vi.mock('../sync.svelte', () => ({
  sync: {
    pushBookmarks: (root: string) => {
      pushed.push(root)
      return Promise.resolve()
    },
  },
}))

const {
  BOOKMARK_KINDS,
  Bookmarks,
  bookmarkList,
  isBookmark,
  mergeBookmarks,
  MOST_BOOKMARKS,
  sameBookmark,
} = await import('./bookmarks.svelte')

type Bookmark = import('./bookmarks.svelte').Bookmark

const note = (path: string): Bookmark => ({ kind: 'note', path, text: '' })
const folder = (path: string): Bookmark => ({ kind: 'folder', path, text: '' })
const heading = (path: string, text: string): Bookmark => ({ kind: 'heading', path, text })
const search = (text: string): Bookmark => ({ kind: 'search', path: '', text })

/** A store on one space, made fresh so nothing carries over between tests. */
function store(root: string | null = '/Notes') {
  return new Bookmarks(() => root)
}

beforeEach(() => {
  localStorage.clear()
  pushed.length = 0
})

describe('what counts as a bookmark', () => {
  test('is one of the four kinds, with a path and a text', () => {
    for (const kind of BOOKMARK_KINDS) {
      expect(isBookmark({ kind, path: 'a.md', text: '' }), kind).toBe(true)
    }

    expect(isBookmark({ kind: 'tag', path: 'a.md', text: '' })).toBe(false)
    expect(isBookmark({ kind: 'note', path: 'a.md' })).toBe(false)
    expect(isBookmark({ kind: 'note', text: '' })).toBe(false)
    expect(isBookmark(null)).toBe(false)
    expect(isBookmark(['note'])).toBe(false)
  })

  test('is read out of a stored list one entry at a time', () => {
    // A list written by a newer build may hold a kind this one cannot draw.
    const read = bookmarkList([note('a.md'), { kind: 'tag', path: '', text: 'x' }, 7, null])
    expect(read).toEqual([note('a.md')])
  })

  test('is nothing at all when the stored value is not a list', () => {
    expect(bookmarkList('a.md')).toEqual([])
    expect(bookmarkList({ 0: note('a.md') })).toEqual([])
    expect(bookmarkList(undefined)).toEqual([])
  })

  test('keeps only the fields a bookmark has', () => {
    const read = bookmarkList([{ kind: 'note', path: 'a.md', text: '', colour: 'red' }])
    expect(read).toEqual([note('a.md')])
  })

  test('is capped, however long the stored list is', () => {
    const many = Array.from({ length: MOST_BOOKMARKS + 20 }, (_, at) => note(`${at}.md`))
    expect(bookmarkList(many)).toHaveLength(MOST_BOOKMARKS)
  })

  test('is the same one when it points at the same thing', () => {
    expect(sameBookmark(note('a.md'), note('a.md'))).toBe(true)
    expect(sameBookmark(note('a.md'), folder('a.md'))).toBe(false)
    expect(sameBookmark(heading('a.md', 'Why'), heading('a.md', 'How'))).toBe(false)
    expect(sameBookmark(search('tea'), search('tea'))).toBe(true)
  })
})

describe('merging what a machine had into what the account holds', () => {
  test("keeps the account's order and adds what only the machine had", () => {
    const theirs = [note('a.md'), search('tea')]
    const mine = [search('tea'), folder('Work')]

    expect(mergeBookmarks(theirs, mine)).toEqual([note('a.md'), search('tea'), folder('Work')])
  })

  test('adds nothing twice', () => {
    const both = [note('a.md'), heading('b.md', 'Why')]
    expect(mergeBookmarks(both, both)).toEqual(both)
  })

  test('is capped like every other list', () => {
    const theirs = Array.from({ length: MOST_BOOKMARKS }, (_, at) => note(`t${at}.md`))
    const mine = [note('mine.md')]

    const merged = mergeBookmarks(theirs, mine)
    expect(merged).toHaveLength(MOST_BOOKMARKS)
    expect(merged).not.toContainEqual(note('mine.md'))
  })
})

describe('bookmarking', () => {
  test('turns the thing in and out again with the one call', () => {
    const marks = store()

    marks.toggle(note('a.md'))
    expect(marks.list).toEqual([note('a.md')])
    expect(marks.has(note('a.md'))).toBe(true)

    marks.toggle(note('a.md'))
    expect(marks.list).toEqual([])
    expect(marks.has(note('a.md'))).toBe(false)
  })

  test('takes a selection in with one press, and out again once all of it is in', () => {
    const marks = store()
    marks.toggle(note('a.md'))

    marks.toggleAll([note('a.md'), folder('B')])
    expect(marks.list).toEqual([note('a.md'), folder('B')])

    marks.toggleAll([note('a.md'), folder('B')])
    expect(marks.list).toEqual([])
  })

  test('offers the space to the account on every change', async () => {
    const marks = store()
    marks.toggle(search('tea'))

    // Told after the click rather than during it: the syncing store is fetched
    // when it is wanted, so the row answers first and the account hears next.
    // What the store is waiting on is the offer itself, so that is what is waited
    // for here - a machine with the other suites on it can take as long as it
    // likes over the import, and this test measures nothing.
    await marks.offered

    expect(pushed).toEqual(['/Notes'])
  })

  test('does nothing without a space to keep it in', () => {
    const marks = store(null)
    marks.toggle(note('a.md'))

    expect(marks.list).toEqual([])
    expect(pushed).toEqual([])
  })

  test('keeps one list per space', () => {
    let root = '/Notes'
    const marks = new Bookmarks(() => root)

    marks.toggle(note('a.md'))
    root = '/Other'
    expect(marks.list).toEqual([])

    marks.toggle(search('tea'))
    expect(marks.of('/Notes')).toEqual([note('a.md')])
    expect(marks.of('/Other')).toEqual([search('tea')])
  })

  test('is remembered for the next run', () => {
    store().toggle(heading('a.md', 'Why'))
    expect(store().list).toEqual([heading('a.md', 'Why')])
  })

  test('stops at the cap rather than growing without end', () => {
    const marks = store()
    for (let at = 0; at < MOST_BOOKMARKS + 5; at++) marks.toggle(note(`${at}.md`))

    expect(marks.list).toHaveLength(MOST_BOOKMARKS)
  })
})

describe('what a row stands for', () => {
  test('is a note or a folder, named the way the space names it', () => {
    const marks = store()

    expect(marks.forEntry({ path: '/Notes/Work/Plan.md', is_dir: false })).toEqual(
      note('Work/Plan.md'),
    )
    expect(marks.forEntry({ path: '/Notes/Work', is_dir: true })).toEqual(folder('Work'))
  })

  test('is nothing for a row outside the open space', () => {
    expect(store().forEntry({ path: '/Other/a.md', is_dir: false })).toBeNull()
    expect(store(null).forEntry({ path: '/Notes/a.md', is_dir: false })).toBeNull()
  })

  test('is a heading of the note it was read from', () => {
    expect(store().forHeading('a.md', ' Why it works ')).toEqual(heading('a.md', 'Why it works'))
    expect(store().forHeading(null, 'Why')).toBeNull()
    expect(store().forHeading('a.md', '   ')).toBeNull()
  })

  test('is the words in the search box, once there are any', () => {
    expect(store().forSearch('  tea  ')).toEqual(search('tea'))
    expect(store().forSearch('   ')).toBeNull()
  })
})

describe('dragging a row somewhere else', () => {
  function three() {
    const marks = store()
    marks.toggle(note('a.md'))
    marks.toggle(note('b.md'))
    marks.toggle(note('c.md'))
    return marks
  }

  test('puts it where it was dropped', () => {
    const marks = three()
    marks.move(2, 0)

    expect(marks.list).toEqual([note('c.md'), note('a.md'), note('b.md')])
  })

  test('moves one down as well as up', () => {
    const marks = three()
    marks.move(0, 2)

    expect(marks.list).toEqual([note('b.md'), note('c.md'), note('a.md')])
  })

  test('leaves the order alone when the drop landed on nothing', () => {
    const marks = three()
    marks.move(0, 9)
    marks.move(-1, 0)
    marks.move(1, 1)

    expect(marks.list).toEqual([note('a.md'), note('b.md'), note('c.md')])
  })
})
