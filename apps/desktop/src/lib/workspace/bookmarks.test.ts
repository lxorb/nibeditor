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
  bookmarksFromPins,
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

describe('the pins an older build kept', () => {
  test('become the bookmarks of the space each one is in', () => {
    const found = bookmarksFromPins(
      ['/Notes/Read me.md', '/Notes/Work', '/Notes/Work/Plan.markdown', '/Other/x.md'],
      ['/Notes', '/Other'],
    )

    expect(found).toEqual({
      '/Notes': [note('Read me.md'), folder('Work'), note('Work/Plan.markdown')],
      '/Other': [note('x.md')],
    })
  })

  test('go when they belong to no space this machine has', () => {
    expect(bookmarksFromPins(['/Gone/a.md'], ['/Notes'])).toEqual({})
  })

  test('are not claimed by a space that merely starts the same way', () => {
    expect(bookmarksFromPins(['/Notebook/a.md'], ['/Note'])).toEqual({})
  })

  test('go to the innermost space that holds them', () => {
    const found = bookmarksFromPins(['/Notes/Inner/a.md'], ['/Notes', '/Notes/Inner'])
    expect(found).toEqual({ '/Notes/Inner': [note('a.md')] })
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

describe('signing in', () => {
  test("folds this machine's bookmarks into the account's, once", () => {
    const marks = store()
    marks.toggle(folder('Work'))

    const send = marks.adopt('/Notes', [note('a.md')], 'u1')
    expect(send).toEqual([note('a.md'), folder('Work')])
    expect(marks.list).toEqual([note('a.md'), folder('Work')])
  })

  test('sends nothing back when the account already had it all', () => {
    const marks = store()
    marks.toggle(note('a.md'))

    expect(marks.adopt('/Notes', [note('a.md')], 'u1')).toBeNull()
  })

  test('lets the account win on every pass after the first', () => {
    const marks = store()
    marks.toggle(folder('Work'))
    marks.adopt('/Notes', [], 'u1')

    // Another machine dropped the folder. Adopting again has to take that,
    // rather than handing the bookmark back from this machine's own copy.
    expect(marks.adopt('/Notes', [], 'u1')).toBeNull()
    expect(marks.list).toEqual([])
  })

  test('shows what another machine added', () => {
    const marks = store()
    marks.adopt('/Notes', [], 'u1')
    marks.adopt('/Notes', [search('tea')], 'u1')

    expect(marks.list).toEqual([search('tea')])
  })

  test('merges again for a different account on the same machine', () => {
    const marks = store()
    marks.toggle(folder('Work'))
    marks.adopt('/Notes', [], 'u1')

    expect(marks.adopt('/Notes', [note('a.md')], 'u2')).toEqual([note('a.md'), folder('Work')])
  })

  test('reads a listing from a service that knows nothing of bookmarks', () => {
    const marks = store()
    marks.toggle(note('a.md'))

    // An older deployment answers with no list at all, which is not the same
    // as an account that holds none.
    expect(marks.adopt('/Notes', undefined as unknown as Bookmark[], 'u1')).toEqual([note('a.md')])
    expect(marks.list).toEqual([note('a.md')])
  })
})

describe('the migration from pins', () => {
  test('runs once and takes the old entry with it', () => {
    localStorage.setItem('nib:pinned', JSON.stringify(['/Notes/a.md', '/Notes/Work']))

    const marks = store()
    marks.migrate(['/Notes'])
    expect(marks.list).toEqual([note('a.md'), folder('Work')])
    expect(localStorage.getItem('nib:pinned')).toBeNull()

    // A second run has nothing left to read, so nothing is doubled.
    marks.migrate(['/Notes'])
    expect(marks.list).toEqual([note('a.md'), folder('Work')])
  })

  test('leaves bookmarks that are already there in front', () => {
    localStorage.setItem('nib:pinned', JSON.stringify(['/Notes/a.md']))

    const marks = store()
    marks.toggle(search('tea'))
    marks.migrate(['/Notes'])

    expect(marks.list).toEqual([search('tea'), note('a.md')])
  })

  test('is silent when there were never any pins', () => {
    const marks = store()
    marks.migrate(['/Notes'])

    expect(marks.list).toEqual([])
  })

  test('drops a pin whose folder is not a space any more', () => {
    localStorage.setItem('nib:pinned', JSON.stringify(['/Gone/a.md']))

    const marks = store()
    marks.migrate(['/Notes'])
    expect(marks.list).toEqual([])
    expect(localStorage.getItem('nib:pinned')).toBeNull()
  })
})

describe('groups', () => {
  test('a group is a bookmark with a name of its own', () => {
    const marks = store()
    const group = marks.addGroup('  Work  ')

    expect(group?.kind).toBe('group')
    expect(group?.text).toBe('Work')
    expect(marks.list).toEqual([group])
    // Two groups called the same thing are two groups: what tells them apart is
    // the name each is filed under, which is what the rows in them point at.
    expect(marks.addGroup('Work')?.path).not.toBe(group?.path)
  })

  test('a group with no name is not a group', () => {
    const marks = store()
    expect(marks.addGroup('   ')).toBeNull()
    expect(marks.list).toEqual([])
  })

  test('a bookmark goes into a group and comes back out', () => {
    const marks = store()
    const group = marks.addGroup('Work')
    marks.toggle(note('a.md'))

    marks.moveInto(note('a.md'), group?.path ?? null)
    expect(marks.list.at(-1)?.parent).toBe(group?.path)

    marks.moveInto(note('a.md'), null)
    expect(marks.list.at(-1)?.parent).toBeUndefined()
  })

  test('a group cannot be put inside itself or inside what it holds', () => {
    const marks = store()
    const outer = marks.addGroup('Outer')
    const inner = marks.addGroup('Inner')
    if (!outer || !inner) throw new Error('no groups')

    marks.moveInto(inner, outer.path)
    marks.moveInto(outer, outer.path)
    expect(marks.list[0]?.parent).toBeUndefined()

    marks.moveInto(outer, inner.path)
    expect(marks.list[0]?.parent).toBeUndefined()
  })

  test('renaming one changes what it is called and nothing else', () => {
    const marks = store()
    const group = marks.addGroup('Work')
    if (!group) throw new Error('no group')

    marks.toggle(note('a.md'))
    marks.moveInto(note('a.md'), group.path)

    marks.rename(group, 'Later')
    expect(marks.list[0]?.text).toBe('Later')
    // The rows in it point at the name it is filed under, which does not change.
    expect(marks.list[1]?.parent).toBe(group.path)
  })

  test('a group taken out leaves what was in it', () => {
    const marks = store()
    const group = marks.addGroup('Work')
    if (!group) throw new Error('no group')

    marks.toggle(note('a.md'))
    marks.moveInto(note('a.md'), group.path)

    marks.remove(group)
    expect(marks.list).toEqual([note('a.md')])
  })

  test('a group inside a group leaves its rows where the group was', () => {
    const marks = store()
    const outer = marks.addGroup('Outer')
    const inner = marks.addGroup('Inner')
    if (!outer || !inner) throw new Error('no groups')

    marks.moveInto(inner, outer.path)
    marks.toggle(note('a.md'))
    marks.moveInto(note('a.md'), inner.path)

    marks.remove(inner)
    expect(marks.list.find((one) => one.kind === 'note')?.parent).toBe(outer.path)
  })

  test('which group a bookmark is in is not what makes it that bookmark', () => {
    const marks = store()
    const group = marks.addGroup('Work')
    if (!group) throw new Error('no group')

    marks.toggle(note('a.md'))
    marks.moveInto(note('a.md'), group.path)

    // The row in the tree still says the note is bookmarked, and pressing it
    // again takes the one bookmark away rather than making a second.
    expect(marks.has(note('a.md'))).toBe(true)
    marks.toggle(note('a.md'))
    expect(marks.list).toEqual([group])
  })

  test('the group travels with the bookmark', () => {
    const marks = store()
    const group = marks.addGroup('Work')
    if (!group) throw new Error('no group')

    marks.toggle(note('a.md'))
    marks.moveInto(note('a.md'), group.path)

    expect(bookmarkList(JSON.parse(JSON.stringify(marks.list)))).toEqual(marks.list)
  })
})

describe('a bookmark of one block', () => {
  test('keeps the whole of what a link to it would say, and words to read it by', () => {
    const marks = store()
    const mark = marks.forBlock('Plan.md', '#^a1b2c3', 'The first words')

    expect(mark).toEqual({ kind: 'block', path: 'Plan.md#^a1b2c3', text: 'The first words' })
    expect(marks.forBlock('Plan.md', '#The plan', 'The plan')?.path).toBe('Plan.md#The plan')
  })

  test('is nothing without a note or a target', () => {
    const marks = store()
    expect(marks.forBlock(null, '#^a1', 'words')).toBeNull()
    expect(marks.forBlock('Plan.md', 'a1', 'words')).toBeNull()
  })

  test('falls back to the target where the block says nothing', () => {
    const marks = store()
    expect(marks.forBlock('Plan.md', '#^a1b2c3', '   ')?.text).toBe('#^a1b2c3')
  })
})

describe('a bookmark of one graph view', () => {
  test('carries the whole of how the picture is drawn, under a name', () => {
    const marks = store()
    const mark = marks.forGraph('  Work  ', { filter: 'tag:work', arrows: true, depth: 2 })

    expect(mark?.kind).toBe('graph')
    expect(mark?.text).toBe('Work')
    // Nothing on disk: a view is a way of looking at the space, not a file in it.
    expect(mark?.path).toBe('')
    expect(JSON.parse(mark?.view ?? '{}')).toEqual({ filter: 'tag:work', arrows: true, depth: 2 })
  })

  test('is nothing without a name', () => {
    const marks = store()
    expect(marks.forGraph('   ', { filter: '' })).toBeNull()
  })

  test('or with more in it than a view ever holds', () => {
    const marks = store()
    expect(marks.forGraph('Work', { filter: 'x'.repeat(500) })).toBeNull()
  })

  test('and survives the trip to the account and back', () => {
    const marks = store()
    marks.toggle(marks.forGraph('Work', { filter: 'tag:work' }))

    expect(bookmarkList(JSON.parse(JSON.stringify(marks.list)))).toEqual(marks.list)
    expect(marks.list[0]?.view).toBe('{"filter":"tag:work"}')
  })
})

/** A bookmark keeps the path it was made with, so a file renamed or moved took its
 *  row with it: the bookmark pointed at a name nothing answered to, and the list
 *  drew nothing for it. */
describe('a file that changes its name', () => {
  test('takes its bookmark with it, and the group it sits in', () => {
    const marks = store()
    marks.toggle(note('Plan.md'))
    const group = marks.addGroup('Work')
    if (!group) throw new Error('no group')
    marks.moveInto(note('Plan.md'), group.path)

    marks.moved('/Notes/Plan.md', '/Notes/Roadmap.md')

    expect(marks.list).toEqual([{ ...note('Roadmap.md'), parent: group.path }, group])
  })

  test('a folder takes everything under it, headings and blocks included', () => {
    const marks = store()
    marks.toggle(folder('Work'))
    marks.toggle(note('Work/Plan.md'))
    marks.toggle(heading('Work/Deep/Plan.md', 'Why'))
    marks.toggle(marks.forBlock('Work/Plan.md', '#^a1b2c3', 'first words'))
    marks.toggle(note('Working.md'))
    marks.toggle(search('Work'))

    marks.moved('/Notes/Work', '/Notes/Archive/Work')

    expect(marks.list.map((one) => one.path)).toEqual([
      'Archive/Work',
      'Archive/Work/Plan.md',
      'Archive/Work/Deep/Plan.md',
      'Archive/Work/Plan.md#^a1b2c3',
      'Working.md',
      '',
    ])
  })

  test('and back again, which is what undoing the rename asks for', () => {
    const marks = store()
    marks.toggle(note('Plan.md'))

    marks.moved('/Notes/Plan.md', '/Notes/Roadmap.md')
    marks.moved('/Notes/Roadmap.md', '/Notes/Plan.md')

    expect(marks.list).toEqual([note('Plan.md')])
  })

  test('is offered to the account, and only when something moved', async () => {
    const marks = store()
    marks.toggle(note('Plan.md'))
    await marks.offered
    pushed.length = 0

    marks.moved('/Notes/Other.md', '/Notes/Else.md')
    await marks.offered
    expect(pushed).toEqual([])

    marks.moved('/Notes/Plan.md', '/Notes/Roadmap.md')
    await marks.offered
    expect(pushed).toEqual(['/Notes'])
  })

  /** A bookmark left behind by a file that was deleted, and a file renamed onto its
   *  name: one bookmark, not the same one twice. */
  test('landing on a bookmark already held leaves one of them', () => {
    const marks = store()
    marks.toggle(note('Roadmap.md'))
    marks.toggle(note('Plan.md'))

    marks.moved('/Notes/Plan.md', '/Notes/Roadmap.md')

    expect(marks.list).toEqual([note('Roadmap.md')])
  })

  test('a space renamed takes its whole list along', () => {
    const marks = store('/Notes')
    marks.toggle(note('Plan.md'))

    marks.spaceMoved('/Notes', '/Studio')

    expect(marks.of('/Studio')).toEqual([note('Plan.md')])
    expect(marks.of('/Notes')).toEqual([])
  })
})
