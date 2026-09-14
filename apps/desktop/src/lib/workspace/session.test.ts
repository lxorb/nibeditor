import { describe, expect, test, vi } from 'vitest'
import { pane } from './pane-tree'
import {
  type Draft,
  frameDraft,
  frameOf,
  type FrameDraft,
  type Layout,
  panesOf,
  readClosed,
  readDraft,
  readLayout,
  readPosition,
  readSession,
  type Session,
  withoutText,
  writeSession,
} from './session'

describe('reading a session that was written down', () => {
  test('brings back the spaces, the strip and where each note was', () => {
    const session = readSession({
      spaces: [{ id: 's', name: 'Notes', root: '/Notes' }],
      activeSpace: 's',
      panel: 'tree',
      active: 1,
      tabs: [
        { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false, cursor: 4, scroll: 20 },
        { path: null, name: 'Untitled', doc: '# draft', dirty: true, cursor: 0, scroll: 0 },
      ],
      positions: { '/Notes/a.md': { cursor: 4, scroll: 20, anchor: 2, at: 7 } },
    })

    expect(session?.spaces).toHaveLength(1)
    expect(session?.tabs?.map((tab) => tab.name)).toEqual(['a.md', 'Untitled'])
    expect(session?.active).toBe(1)
    expect(session?.positions?.['/Notes/a.md']).toEqual({ cursor: 4, scroll: 20, anchor: 2, at: 7 })
  })

  test('answers nothing for an entry that is not one', () => {
    expect(readSession(null)).toBeNull()
    expect(readSession('{}')).toBeNull()
    expect(readSession([])).toBeNull()
  })

  test('keeps the notes an entry does hold when a field is unreadable', () => {
    const session = readSession({
      spaces: [{ id: 's', name: 'Notes', root: '/Notes' }, { id: 'broken' }],
      activeSpace: 12,
      panel: 'nowhere',
      tabs: [
        { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false },
        { name: 42, doc: '' },
      ],
      positions: { '/Notes/a.md': { cursor: 'four', scroll: 0 } },
    })

    expect(session?.spaces.map((space) => space.id)).toEqual(['s'])
    expect(session?.activeSpace).toBeNull()
    expect(session?.panel).toBeNull()
    expect(session?.tabs?.map((tab) => tab.name)).toEqual(['a.md'])
    expect(session?.positions).toEqual({})
  })

  test('still reads the open paths an older version wrote', () => {
    const session = readSession({
      spaces: [],
      activeSpace: null,
      panel: null,
      openPaths: ['/Notes/a.md', '/Notes/b.md'],
      activePath: '/Notes/b.md',
    })

    expect(session?.openPaths).toEqual(['/Notes/a.md', '/Notes/b.md'])
    expect(session?.activePath).toBe('/Notes/b.md')
    expect(session?.tabs).toBeUndefined()
  })
})

describe('reading one tab', () => {
  test('needs a name and some text to be a tab at all', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ name: 'a' })
    expect(readDraft({ path: null, doc: '' })).toBeNull()
    expect(readDraft({ path: 7, name: 'a', doc: '' })).toBeNull()
  })

  test('fills in a caret and a scroll that were never written', () => {
    expect(readDraft({ path: null, name: 'a', doc: '' })).toMatchObject({ cursor: 0, scroll: 0 })
    // Absent, not undefined: the anchor is what tells an older session apart
    // from one that simply sat at the top.
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('anchor')
  })

  test('brings back which face of the note was up', () => {
    expect(readDraft({ path: null, name: 'a', doc: '', reading: true })).toMatchObject({
      reading: true,
    })
  })

  test('is being written in unless it says otherwise', () => {
    // Absent rather than false, so a tab that was being written in - which is
    // nearly every tab - costs the entry nothing.
    expect(readDraft({ path: null, name: 'a', doc: '' })).not.toHaveProperty('reading')
    expect(readDraft({ path: null, name: 'a', doc: '', reading: 'yes' })).not.toHaveProperty(
      'reading',
    )
  })

  /** What a tab holds is the file's, not the entry's. An entry written before there
   *  were canvases, one whose kind was lost, or one naming a kind this version has
   *  never heard of used to come back as a note whatever its name said - and a
   *  canvas restored as a note joins the room of a file the service serves as a
   *  plane, which is the two ends of one file building different shapes for it. */
  test('reads the kind off the file’s name, whatever the entry claims', () => {
    for (const claimed of [undefined, 'note', 'pdf', 'graph', 'nonsense', 7]) {
      expect(
        readDraft({ kind: claimed, path: '/Notes/Board.canvas', name: 'Board.canvas', doc: '' }),
        JSON.stringify(claimed ?? null),
      ).toMatchObject({ kind: 'canvas' })
    }
  })

  test('and does not leave a canvas over a file whose name says words', () => {
    expect(
      readDraft({ kind: 'canvas', path: '/Notes/plan.md', name: 'plan.md', doc: '' }),
    ).toMatchObject({ kind: 'note' })
  })

  /** A website is a shortcut file and its name is the whole of what it is. A session
   *  written before websites had a name of their own says `note` for one, and a
   *  shortcut restored as a note would put three lines of INI in front of somebody in
   *  an editor. */
  test('a website comes back as one, whatever the entry claims', () => {
    for (const claimed of [undefined, 'note', 'canvas', 'nonsense']) {
      expect(
        readDraft({
          kind: claimed,
          path: '/Notes/Svelte docs.url',
          name: 'Svelte docs.url',
          doc: '',
        }),
        JSON.stringify(claimed ?? null),
      ).toMatchObject({ kind: 'web' })
    }

    expect(
      readDraft({
        kind: 'note',
        path: '/Notes/Safari page.webloc',
        name: 'Safari page.webloc',
        doc: '',
      }),
    ).toMatchObject({ kind: 'web' })
  })

  test('leaves a tab no file names alone, which is the graph', () => {
    expect(readDraft({ kind: 'graph', path: null, name: 'Graph', doc: '' })).toMatchObject({
      kind: 'graph',
    })
    // And a paper is still a paper: its name says words, and `pdf` is not a kind
    // the name can argue with.
    expect(
      readDraft({ kind: 'pdf', path: '/Notes/paper.pdf', name: 'paper.pdf', doc: '' }),
    ).toMatchObject({ kind: 'pdf' })
  })
})

describe('reading a closed tab', () => {
  test('brings back the tab, its pane and its place', () => {
    const back = readClosed({
      draft: { path: '/Notes/a.md', name: 'a.md', doc: '', dirty: false },
      paneId: 'left',
      at: 3,
    })

    expect(back?.draft.name).toBe('a.md')
    expect(back?.paneId).toBe('left')
    expect(back?.at).toBe(3)
  })

  test('fills in a pane and a place that were never written', () => {
    const back = readClosed({ draft: { path: null, name: 'Untitled', doc: '# draft' } })

    expect(back?.paneId).toBe('')
    expect(back?.at).toBe(0)
  })

  test('is nothing at all without a tab in it', () => {
    expect(readClosed({ paneId: 'left', at: 0 })).toBeNull()
    expect(readClosed({ draft: { name: 42 } })).toBeNull()
    expect(readClosed(null)).toBeNull()
    expect(readClosed({ draft: { path: null, name: 'a', doc: '' }, at: -2 })?.at).toBe(0)
  })
})

describe('reading one place', () => {
  test('needs both a caret and a scroll', () => {
    expect(readPosition({ cursor: 1, scroll: 2 })).toEqual({ cursor: 1, scroll: 2, at: 0 })
    expect(readPosition({ cursor: 1 })).toBeNull()
    expect(readPosition({ cursor: Number.NaN, scroll: 2 })).toBeNull()
  })

  test('keeps the folds it was written with', () => {
    const place = readPosition({ cursor: 1, scroll: 2, folds: [[1, 9]] })
    expect(place?.folds).toEqual([[1, 9]])
  })

  test('drops a fold that names nothing a note could have', () => {
    // A line before the first, a pair that covers no line at all, a pair the
    // wrong way round, a pair that is not a pair, and a fold that is not a list.
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[0, 4]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[4, 4]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[9, 3]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[1, 2, 3]] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: [[1, '4']] })?.folds).toBeUndefined()
    expect(readPosition({ cursor: 1, scroll: 2, folds: 'all' })?.folds).toBeUndefined()
  })

  test('keeps the good folds and drops only the bad ones', () => {
    const place = readPosition({
      cursor: 1,
      scroll: 2,
      folds: [
        [1, 9],
        [7, 2],
      ],
    })

    expect(place?.folds).toEqual([[1, 9]])
  })
})

const draft = (path: string | null, doc: string, share?: string): Draft => ({
  kind: 'note',
  path,
  name: 'a.md',
  doc,
  dirty: true,
  cursor: 0,
  scroll: 0,
  ...(share ? { share } : {}),
})

const onePane = (tabs: Draft[], id = 'p1'): FrameDraft => ({
  kind: 'pane',
  pane: { id, tabs, active: 0, linked: false },
})

describe('reading an arrangement of panes', () => {
  test('brings back the panes, their strips and which one had the focus', () => {
    const layout = readLayout({
      focused: 'p2',
      panel: 'tree',
      frame: {
        kind: 'split',
        id: 's1',
        along: 'row',
        fraction: 0.4,
        sides: [
          onePane([draft('/Notes/a.md', '')]),
          {
            kind: 'pane',
            pane: { id: 'p2', tabs: [draft('/Notes/b.md', '')], active: 0, linked: true },
          },
        ],
      },
    })

    expect(layout?.focused).toBe('p2')
    expect(layout?.panel).toBe('tree')
    expect(layout?.frame.kind).toBe('split')
    expect(panesOf(layout?.frame ?? onePane([])).map((one) => one.id)).toEqual(['p1', 'p2'])
    expect(panesOf(layout?.frame ?? onePane([]))[1]?.linked).toBe(true)
  })

  test('fills in a direction and a share of the room that were never written', () => {
    const layout = readLayout({
      frame: { kind: 'split', sides: [onePane([]), onePane([], 'p2')] },
    })

    const frame = layout?.frame
    expect(frame?.kind === 'split' && frame.along).toBe('row')
    expect(frame?.kind === 'split' && frame.fraction).toBe(0.5)
    // A split with no id of its own still has to be one the divider can name.
    expect(frame?.kind === 'split' && frame.id.length).toBeGreaterThan(0)
  })

  test('reads a split that lost a side as the side it still has', () => {
    const layout = readLayout({
      frame: { kind: 'split', id: 's1', along: 'row', fraction: 0.5, sides: [onePane([]), null] },
    })

    expect(layout?.frame.kind).toBe('pane')
  })

  test('answers nothing for an arrangement with no panes in it', () => {
    expect(readLayout({ focused: 'p1' })).toBeNull()
    expect(readLayout(null)).toBeNull()
  })

  test('takes the sidebar from the arrangement rather than from beside it', () => {
    const session = readSession({
      spaces: [],
      activeSpace: null,
      panel: 'search',
      layout: { focused: 'p1', panel: 'outline', frame: onePane([]) },
    })

    expect(session?.panel).toBe('outline')
  })
})

describe('an arrangement, there and back', () => {
  test('keeps the tree, the tabs and the share of the room', () => {
    const first = pane('p1', 't1')
    const second = pane('p2', 't2')
    second.linked = true

    const written = frameDraft(
      { kind: 'split', id: 's1', along: 'column', fraction: 0.3, sides: [first, second] },
      (one) => ({ tabs: [draft(`/Notes/${one.id}.md`, '')], active: 0 }),
    )

    const back = frameOf(written, (one) => (one.id === 'p2' ? 't2' : 't1'))

    expect(back.kind === 'split' && back.along).toBe('column')
    expect(back.kind === 'split' && back.fraction).toBe(0.3)
    expect(back.kind === 'split' && back.sides[1].kind === 'pane' && back.sides[1].linked).toBe(
      true,
    )
    expect(
      back.kind === 'split' && back.sides[1].kind === 'pane' && back.sides[1].activeTabId,
    ).toBe('t2')
  })
})

describe('an arrangement kept under a name', () => {
  test('holds no words for a note that lives on disk', () => {
    const layout: Layout = {
      focused: 'p1',
      panel: null,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    }

    const bare = withoutText(layout)
    const tabs = panesOf(bare.frame)[0]?.tabs ?? []

    expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '', dirty: false })
    expect(tabs[1]).toMatchObject({ path: null, doc: '# nowhere else', dirty: true })
  })

  test('says which tabs were views of one note', () => {
    const shared = panesOf(
      readLayout({
        focused: 'p1',
        frame: {
          kind: 'split',
          id: 's1',
          along: 'row',
          fraction: 0.5,
          sides: [
            onePane([draft('/Notes/a.md', '', 'd1')]),
            onePane([draft('/Notes/a.md', '', 'd1')], 'p2'),
          ],
        },
      })?.frame ?? onePane([]),
    )

    expect(shared.map((one) => one.tabs[0]?.share)).toEqual(['d1', 'd1'])
  })
})

describe('writing the session down', () => {
  const session = (): Session => ({
    spaces: [],
    activeSpace: null,
    panel: null,
    closed: [{ draft: draft('/Notes/gone.md', '# closed'), paneId: 'p1', at: 0 }],
    layout: {
      focused: 'p1',
      panel: null,
      frame: onePane([draft('/Notes/a.md', '# on disk too'), draft(null, '# nowhere else')]),
    },
  })

  /** Storage that refuses the first `refusals` writes and keeps the rest. */
  function tightStorage(refusals: number): string[] {
    const written: string[] = []
    let left = refusals

    vi.stubGlobal('localStorage', {
      setItem: (_key: string, value: string) => {
        if (left-- > 0) throw new Error('quota exceeded')
        written.push(value)
      },
    })

    return written
  }

  test('gives up what was closed before what is open when storage is full', () => {
    const written = tightStorage(1)

    try {
      expect(writeSession('nib:workspace', session())).toBe(true)

      const saved = JSON.parse(written[0] ?? '{}') as Session
      const tabs = saved.layout ? (panesOf(saved.layout.frame)[0]?.tabs ?? []) : []
      expect(saved.closed).toEqual([])
      // What is still on screen has given up nothing yet.
      expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '# on disk too' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('gives up the copies of notes that live somewhere else next', () => {
    const written = tightStorage(2)

    try {
      expect(writeSession('nib:workspace', session())).toBe(true)

      const saved = JSON.parse(written[0] ?? '{}') as Session
      const tabs = saved.layout ? (panesOf(saved.layout.frame)[0]?.tabs ?? []) : []
      // The note that has a file keeps its path and gives up its text; the one
      // that exists nowhere but here keeps every word.
      expect(tabs[0]).toMatchObject({ path: '/Notes/a.md', doc: '', dirty: false })
      expect(tabs[1]).toMatchObject({ path: null, doc: '# nowhere else', dirty: true })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('brings the closed tabs back through a restart', () => {
    const written = tightStorage(0)

    try {
      writeSession('nib:workspace', session())
      const back = readSession(JSON.parse(written[0] ?? '{}'))

      expect(back?.closed).toHaveLength(1)
      expect(back?.closed?.[0]).toMatchObject({ paneId: 'p1', at: 0 })
      // Unsaved words travel with it, which is the whole point of writing the
      // stack down rather than keeping it for this run only.
      expect(back?.closed?.[0]?.draft).toMatchObject({ path: '/Notes/gone.md', doc: '# closed' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('says which shape it wrote', () => {
    const written = tightStorage(0)

    try {
      writeSession('nib:workspace', session())
      expect(JSON.parse(written[0] ?? '{}')).toMatchObject({ version: 2 })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('says so when there is nothing left to give up', () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota exceeded')
      },
    })

    try {
      expect(writeSession('nib:workspace', session())).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/** Whether a pane lays its notes out as columns is the pane's own answer, so it travels
 *  with the pane: a window put back after a restart is the arrangement it was left in.
 *  Absent in a session written by a build that had never heard of it, which reads back as
 *  off - and off is where every pane starts. */
describe('a pane that stacks its notes', () => {
  test('says so when it is read back', () => {
    const layout = readLayout({
      focused: 'p1',
      frame: {
        kind: 'pane',
        pane: {
          id: 'p1',
          tabs: [draft('/Notes/a.md', '')],
          active: 0,
          linked: false,
          stacked: true,
        },
      },
    })

    expect(panesOf(layout?.frame ?? onePane([]))[0]?.stacked).toBe(true)
  })

  test('and a session that never said reads back as one that does not', () => {
    const layout = readLayout({ focused: 'p1', frame: onePane([draft('/Notes/a.md', '')]) })

    expect(panesOf(layout?.frame ?? onePane([]))[0]?.stacked).toBe(false)
  })

  test('and it survives the round trip out and back', () => {
    const one = pane('p1', 't1')
    one.stacked = true

    const written = frameDraft(one, () => ({ tabs: [draft('/Notes/a.md', '')], active: 0 }))
    expect(written.kind === 'pane' && written.pane.stacked).toBe(true)

    const back = frameOf(written, () => 't1')
    expect(back.kind === 'pane' && back.stacked).toBe(true)
  })
})
