import { describe, expect, test } from 'vitest'
import {
  columnsOf,
  essentialTab,
  nearestTile,
  pastMiddle,
  placed,
  released,
  slotFor,
  stepInGrid,
} from './essentials.svelte'
import { faceOf, initialOf } from './file-mark'
import { type Bookmark, isTile, MOST_BOOKMARKS } from './workspace/bookmarks.svelte'

const mark = (kind: Bookmark['kind'], parent?: string): Bookmark => ({
  kind,
  path: kind === 'search' || kind === 'graph' ? '' : 'a.md',
  text: '',
  ...(parent ? { parent } : {}),
})

describe('which bookmarks are tiles', () => {
  test('a file at the top of the list', () => {
    expect(isTile(mark('note'))).toBe(true)
  })

  test('and nothing that is only words, or that sits in a group', () => {
    for (const kind of ['folder', 'heading', 'block', 'search', 'graph', 'group'] as const) {
      expect(isTile(mark(kind)), kind).toBe(false)
    }
    expect(isTile(mark('note', 'g1'))).toBe(false)
  })
})

describe('what a tile wears', () => {
  test('a note that chose nothing wears its letter', () => {
    expect(faceOf('note', false)).toBe('letter')
  })

  test('a note that chose an icon, and every other kind, wears its mark', () => {
    expect(faceOf('note', true)).toBe('mark')
    for (const kind of ['web', 'canvas', 'pdf', 'pages', 'base', 'chat', 'picture'] as const) {
      expect(faceOf(kind, false), kind).toBe('mark')
    }
  })
})

describe('the letter on a tile', () => {
  test('is the first letter, in capitals', () => {
    expect(initialOf('plan')).toBe('P')
    expect(initialOf('  über alles')).toBe('Ü')
  })

  test('skips what is not a letter or a digit in front of it', () => {
    expect(initialOf('_inbox')).toBe('I')
    expect(initialOf('(draft) notes')).toBe('D')
    expect(initialOf('2026 plan')).toBe('2')
  })

  test('is one whole character, wherever it is written', () => {
    expect(initialOf('東京')).toBe('東')
    expect(initialOf('ﻣﺸﺮﻭﻉ')).toHaveLength(1)
    // A letter with its mark written after it, which is one character to a reader.
    expect(initialOf('été')).toBe('É')
  })

  test('is the first character of a name with no letter in it', () => {
    expect(initialOf('???')).toBe('?')
    expect(initialOf('')).toBe('')
  })
})

describe('where a tile let go of lands', () => {
  test('in front of the tile, or after it past its middle', () => {
    expect(slotFor(null, 2, false)).toBe(2)
    expect(slotFor(null, 2, true)).toBe(3)
  })

  test('moved down the list, in the list as it is once it has left', () => {
    // a b c d: a let go of in front of c lands between b and c.
    expect(slotFor(0, 2, false)).toBe(1)
    expect(slotFor(0, 2, true)).toBe(2)
  })

  test('moved up the list, where it was let go of', () => {
    expect(slotFor(3, 1, false)).toBe(1)
    expect(slotFor(3, 1, true)).toBe(2)
  })

  test('the far half of a tile is read the way the page runs', () => {
    expect(pastMiddle(80, 0, 100, false)).toBe(true)
    expect(pastMiddle(20, 0, 100, false)).toBe(false)
    expect(pastMiddle(20, 0, 100, true)).toBe(true)
  })
})

describe('a step up or down the grid', () => {
  // Four to a row and seven tiles: a full row, and a row of three under it.
  test('goes to the tile in the same column', () => {
    expect(stepInGrid(1, 7, 4, true)).toBe(5)
    expect(stepInGrid(5, 7, 4, false)).toBe(1)
  })

  test('lands on the last tile where the last row is too short', () => {
    expect(stepInGrid(3, 7, 4, true)).toBe(6)
  })

  test('leaves the grid off its top and its bottom', () => {
    expect(stepInGrid(2, 7, 4, false)).toBeNull()
    expect(stepInGrid(4, 7, 4, true)).toBeNull()
    expect(stepInGrid(0, 2, 4, true)).toBeNull()
  })
})

describe('how many tiles there are to a row', () => {
  test('as many as start where the first does', () => {
    expect(columnsOf([0, 0, 0, 0, 48, 48])).toBe(4)
    expect(columnsOf([0, 0])).toBe(2)
    expect(columnsOf([])).toBe(1)
  })
})

describe('the tile a pointer between tiles is nearest', () => {
  // Two to a row, 50 wide with a gap of 4, and one tile under them.
  const boxes = [
    { left: 0, right: 50, top: 0, bottom: 40 },
    { left: 54, right: 104, top: 0, bottom: 40 },
    { left: 0, right: 50, top: 44, bottom: 84 },
  ]

  test('is the tile it is on', () => {
    expect(nearestTile(boxes, 60, 20)).toBe(1)
  })

  test('is the closer side of a gap', () => {
    expect(nearestTile(boxes, 51, 20)).toBe(0)
    expect(nearestTile(boxes, 53, 20)).toBe(1)
  })

  test('is the last tile in the empty end of the last row', () => {
    expect(nearestTile(boxes, 90, 70)).toBe(2)
  })

  test('is none in a grid with no tiles', () => {
    expect(nearestTile([], 0, 0)).toBe(-1)
  })
})

const tab = (id: string, essential: string | null, paneId = 'p1') => ({ id, essential, paneId })

describe('the tab an essential is', () => {
  const tabs = [
    tab('strip', null),
    tab('away', '/s/Plan.md', 'aside'),
    tab('here', '/s/Plan.md', 'p1'),
    tab('other', '/s/Other.md'),
  ]
  const shown = (paneId: string) => paneId !== 'aside'

  test('is the one made for its file, on screen first', () => {
    expect(essentialTab(tabs, '/s/Plan.md', shown)?.id).toBe('here')
  })

  test('is one out of sight where there is no other', () => {
    expect(essentialTab([tabs[1] ?? tab('x', null)], '/s/Plan.md', shown)?.id).toBe('away')
  })

  test('is never a tab of the strip showing the same file', () => {
    expect(essentialTab([tab('strip', null)], '/s/Plan.md', shown)).toBeUndefined()
  })

  test('is found however the path is written', () => {
    expect(essentialTab(tabs, '\\s\\Other.md', shown)?.id).toBe('other')
  })
})

describe('an essential taken out of the Essentials', () => {
  test('goes back to the strip, and the rest stay', () => {
    const tabs = [tab('a', '/s/a.md'), tab('b', '/s/b.md'), tab('c', null)]
    expect(released(tabs, ['/s/b.md']).map((one) => one.id)).toEqual(['a'])
  })

  test('none go while every one is still kept', () => {
    expect(released([tab('a', '/s/a.md')], ['/s/a.md'])).toEqual([])
  })
})

describe('rows let go of over the bookmarks', () => {
  const note = (path: string, parent?: string): Bookmark => ({
    kind: 'note',
    path,
    text: '',
    ...(parent ? { parent } : {}),
  })
  const three = [note('a.md'), note('b.md'), note('c.md')]
  const paths = (list: Bookmark[]) => list.map((one) => one.path)

  test('are kept in front of the bookmark they landed on', () => {
    expect(paths(placed(three, [note('new.md')], 1))).toEqual(['a.md', 'new.md', 'b.md', 'c.md'])
  })

  test('at the end past the last, and at the start before the first', () => {
    expect(paths(placed(three, [note('end.md')], 3)).at(-1)).toBe('end.md')
    expect(paths(placed(three, [note('start.md')], -4))[0]).toBe('start.md')
  })

  test('move one already kept rather than keeping it twice', () => {
    // In front of c, which is where c is once a has left the front.
    expect(paths(placed(three, [note('a.md')], 2))).toEqual(['b.md', 'a.md', 'c.md'])
  })

  test('bring one out of its group', () => {
    const list = placed([note('a.md'), note('c.md', 'g1')], [note('c.md')], 0)
    expect(list[0]).toEqual(note('c.md'))
  })

  test('take a selection in once, in its own order', () => {
    const list = placed(three, [note('x.md'), note('y.md'), note('x.md')], 0)
    expect(paths(list)).toEqual(['x.md', 'y.md', 'a.md', 'b.md', 'c.md'])
  })

  test('leave out what does not fit, and never what was already there', () => {
    const full = Array.from({ length: MOST_BOOKMARKS - 1 }, (_, at) => note(`${String(at)}.md`))
    const list = placed(full, [note('fits.md'), note('over.md')], 0)

    expect(list).toHaveLength(MOST_BOOKMARKS)
    expect(list[0]).toEqual(note('fits.md'))
    expect(list.at(-1)).toEqual(note(`${String(MOST_BOOKMARKS - 2)}.md`))
  })
})
