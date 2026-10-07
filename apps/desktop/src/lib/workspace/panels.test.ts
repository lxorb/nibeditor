import { describe, expect, test } from 'vitest'
import {
  closing,
  moving,
  openOn,
  PANELS,
  panelsOn,
  rightFrom,
  showing,
  sideOf,
  splitTabs,
  type Sides,
  STARTS_RIGHT,
  tabsShown,
} from './panels'

/** Which side each panel sits on, as arithmetic.
 *
 *  The workspace's own tests take these through the store; see 'the two sides of
 *  the window' in workspace.test.ts. What is here is the rules themselves, which is
 *  where the awkward cases live: a panel moved while it was open, the last panel
 *  leaving the right side, and a session written by a build that had only one. */

const EVERY = ['tree', 'outline', 'search', 'links'] as const

/** Nothing open and nothing moved over, which is where every window starts. */
function fresh(): Sides {
  return { panel: null, rightPanel: null, right: [] }
}

describe('which side a panel is on', () => {
  test('is the left unless it was moved', () => {
    expect(sideOf([], 'tree')).toBe('left')
    expect(sideOf(['outline'], 'tree')).toBe('left')
    expect(sideOf(['outline'], 'outline')).toBe('right')
  })

  test('and a session with no right side at all reads as all on the left', () => {
    // What a session written by a build that had one side looks like.
    for (const panel of EVERY) expect(sideOf([], panel)).toBe('left')
  })
})

describe('which panels a side holds', () => {
  test('the left keeps the app’s own order, less whatever moved over', () => {
    expect(panelsOn(['search'], 'left', EVERY)).toEqual(['tree', 'outline', 'links'])
  })

  test('the right keeps the order they were moved over in', () => {
    expect(panelsOn(['search', 'outline'], 'right', EVERY)).toEqual(['search', 'outline'])
  })

  test('and a panel this build has never heard of is on neither', () => {
    expect(panelsOn(['ghost' as never], 'right', EVERY)).toEqual([])
    expect(panelsOn(['ghost' as never], 'left', EVERY)).toEqual(EVERY)
  })
})

describe('showing a panel', () => {
  test('opens it on its own side', () => {
    expect(showing(fresh(), 'tree')).toEqual({ panel: 'tree', rightPanel: null, right: [] })

    const moved: Sides = { panel: 'tree', rightPanel: null, right: ['outline'] }
    expect(showing(moved, 'outline')).toEqual({
      panel: 'tree',
      rightPanel: 'outline',
      right: ['outline'],
    })
  })

  test('and shuts it where it is already the one showing', () => {
    const open: Sides = { panel: 'tree', rightPanel: null, right: [] }
    expect(showing(open, 'tree').panel).toBeNull()
  })

  test('and leaves the other side alone either way', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(showing(both, 'search')).toEqual({ panel: 'tree', rightPanel: null, right: ['search'] })
    expect(showing(both, 'tree')).toEqual({ panel: null, rightPanel: 'search', right: ['search'] })
  })
})

describe('shutting a side', () => {
  test('closes whichever panel is in it', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(closing(both, 'left')).toEqual({ panel: null, rightPanel: 'search', right: ['search'] })
    expect(closing(both, 'right')).toEqual({ panel: 'tree', rightPanel: null, right: ['search'] })
  })

  test('and leaves what has been moved over where it is', () => {
    const both: Sides = { panel: null, rightPanel: 'search', right: ['search'] }
    expect(closing(both, 'right').right).toEqual(['search'])
  })
})

describe('moving a panel to the other side', () => {
  test('takes its open state with it', () => {
    const open: Sides = { panel: 'outline', rightPanel: null, right: [] }
    expect(moving(open, 'outline', 'right')).toEqual({
      panel: null,
      rightPanel: 'outline',
      right: ['outline'],
    })
  })

  test('and a panel that was not being read arrives shut', () => {
    const other: Sides = { panel: 'tree', rightPanel: null, right: [] }
    expect(moving(other, 'outline', 'right')).toEqual({
      panel: 'tree',
      rightPanel: null,
      right: ['outline'],
    })
  })

  test('and back again the same way', () => {
    const over: Sides = { panel: null, rightPanel: 'outline', right: ['outline'] }
    expect(moving(over, 'outline', 'left')).toEqual({
      panel: 'outline',
      rightPanel: null,
      right: [],
    })
  })

  test('and the last one leaving means a right side with nothing to draw', () => {
    const two: Sides = { panel: null, rightPanel: 'search', right: ['outline', 'search'] }
    const after = moving(two, 'outline', 'left')
    expect(after.right).toEqual(['search'])

    const one = moving(after, 'search', 'left')
    expect(one.right).toEqual([])
    expect(one.rightPanel).toBeNull()
  })

  test('and moving it where it already is changes nothing at all', () => {
    const over: Sides = { panel: null, rightPanel: 'outline', right: ['outline'] }
    expect(moving(over, 'outline', 'right')).toBe(over)
    expect(moving(fresh(), 'tree', 'left')).toEqual(fresh())
  })
})

describe('what each side shows', () => {
  test('is the panel open on it, or none', () => {
    const both: Sides = { panel: 'tree', rightPanel: 'search', right: ['search'] }
    expect(openOn(both, 'left')).toBe('tree')
    expect(openOn(both, 'right')).toBe('search')
    expect(openOn(fresh(), 'left')).toBeNull()
    expect(openOn(fresh(), 'right')).toBeNull()
  })
})

describe('where a panel lives until somebody moves it', () => {
  test('is the space on the left and the note in front on the right, as Obsidian has it', () => {
    expect(rightFrom(undefined)).toEqual([
      'outline',
      'links',
      'properties',
      'footnotes',
      'ask',
      'agents',
    ])
    expect(panelsOn(rightFrom(undefined), 'left', PANELS)).toEqual([
      'tree',
      'search',
      'tasks',
      'chats',
    ])
  })

  test('and a window arranged before the homes keeps its own arrangement', () => {
    // A build with five panels wrote this: the outline moved over, the rest left.
    expect(rightFrom(['outline'])).toEqual(['outline', 'properties', 'ask', 'agents'])
    // And one that had everything on the left wrote nothing at all.
    expect(rightFrom(undefined)).toEqual(STARTS_RIGHT)
  })

  test('and the agents are homed on the right in a window that knew every panel before them', () => {
    const before = PANELS.filter((one) => one !== 'agents')
    expect(rightFrom(['ask'], before)).toEqual(['ask', 'agents'])
    expect(rightFrom([], before)).toEqual(['agents'])
  })

  test('while one that knew every panel is kept exactly, however empty', () => {
    expect(rightFrom([], PANELS)).toEqual([])
    expect(rightFrom(['ask'], PANELS)).toEqual(['ask'])
  })
})

/** The strip's room, in pixels: a tab at its narrowest is 26 (an 18 pixel mark and
 *  4 either side), 2 between tabs and 6 of groove. */
describe('how many tabs the strip draws', () => {
  test('all of them where nothing has been laid out yet', () => {
    expect(tabsShown(9, 0, 26)).toBe(9)
  })

  test('all of them where they fit at their narrowest', () => {
    // 6 x 26 + 5 x 2 + 6 = 172.
    expect(tabsShown(6, 172, 26)).toBe(6)
    expect(tabsShown(6, 840, 26)).toBe(6)
  })

  test('and where they do not, as many as fit beside More', () => {
    // A pixel short of six places is five: four tabs and More.
    expect(tabsShown(6, 171, 26)).toBe(4)
    expect(tabsShown(9, 172, 26)).toBe(5)
  })

  test('but never none: the one showing always has a place', () => {
    expect(tabsShown(9, 10, 26)).toBe(1)
  })
})

describe('which tabs go behind More', () => {
  const tabs = ['outline', 'links', 'properties', 'footnotes', 'ask', 'agents']

  test('none, where every one is drawn', () => {
    expect(splitTabs(tabs, 6, (one) => one === 'ask')).toEqual({ drawn: tabs, behind: [] })
  })

  test('the last ones, in the strip’s order', () => {
    expect(splitTabs(tabs, 3, (one) => one === 'links')).toEqual({
      drawn: ['outline', 'links', 'properties'],
      behind: ['footnotes', 'ask', 'agents'],
    })
  })

  test('except the one showing, which takes the last place drawn', () => {
    expect(splitTabs(tabs, 3, (one) => one === 'ask')).toEqual({
      drawn: ['outline', 'links', 'ask'],
      behind: ['properties', 'footnotes', 'agents'],
    })
  })
})
