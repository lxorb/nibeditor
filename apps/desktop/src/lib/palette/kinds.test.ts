import { describe, expect, test } from 'vitest'
import { candidates, headingCandidates, resting, rowKey } from './kinds'
import { ranked } from './rank'
import { command, file, named, NOW, ROOT, setting, tab, visit, world } from './world.fixture'

const FILES = [
  file('Plan.md'),
  file('Uni/Lecture 3.md'),
  file('Uni/Plan.md'),
  file('Home/Tax.md'),
  file('Print shop.md'),
  file('Board.canvas'),
  file('Paper.pdf'),
  file('Moodle.url'),
]

const COMMANDS = [
  command('print', 'Print'),
  command('new', 'New note', { hint: 'Ctrl+N' }),
  command('reopen', 'Reopen closed tab'),
  command('reading', 'Reading'),
  command('web-find', 'Find in page'),
  command('split-right', 'Split right', { disabled: true }),
]

const SETTINGS = [
  setting('Text size', 'Editor', { names: ['font', 'zoom'] }),
  setting('Check spelling', 'Spelling', { section: 'spelling', names: ['spellcheck'] }),
  setting('Mode', 'Appearance', { section: 'appearance', names: ['Dark', 'Light', 'theme'] }),
]

const everything = (more: Parameters<typeof world>[0] = {}) =>
  candidates(world({ files: FILES, commands: COMMANDS, settings: SETTINGS, ...more }))

const top = (term: string, more: Parameters<typeof world>[0] = {}, count = 3) =>
  ranked(term, everything(more)).slice(0, count).map(named)

describe('one list of everything', () => {
  test('finds notes, commands, pages and settings from one field', () => {
    const found = ranked('print', everything()).map(named)
    expect(found).toContain('Print shop')
    expect(found).toContain('> Print')

    expect(top('spelling', {}, 1)).toEqual(['setting Check spelling'])
    expect(
      top('moodle', { pages: [visit('https://moodle-app2.let.ethz.ch/', 'Moodle ETH')] }),
    ).toContain('page Moodle ETH')
  })

  test('puts a note before a command that matches as well, for a letter or two', () => {
    expect(top('p', {}, 2)).toEqual(['Plan', 'Plan'])
    expect(top('pr', {}, 1)).toEqual(['Print shop'])
  })

  test('lets the exact name of a command win', () => {
    expect(top('print', {}, 1)).toEqual(['> Print'])
    expect(top('reading', {}, 1)).toEqual(['> Reading'])
  })

  test('holds a setting back unless the words are its own', () => {
    // Text size holds a t, an e and an x; it is not what somebody typing `tax` wants.
    expect(ranked('tax', everything()).map(named)).not.toContain('setting Text size')
    expect(top('text size', {}, 1)).toEqual(['setting Text size'])
    // Its other words find it, below its own name.
    expect(ranked('font', everything()).map(named)).toContain('setting Text size')
  })

  test('finds words in any order', () => {
    expect(top('spelling check', {}, 1)).toEqual(['setting Check spelling'])
    expect(top('tab closed', {}, 1)).toEqual(['> Reopen closed tab'])
  })

  test('forgives one slip in a longer word, when little else was found', () => {
    expect(top('reopne', {}, 1)).toEqual(['> Reopen closed tab'])
    expect(ranked('pln', everything()).map(named)).toContain('Plan')
  })

  test('sinks a command that cannot run now, and lifts one about the tab in front', () => {
    const split = ranked('split', everything())
    expect(split.map(named)).toEqual(['> Split right'])

    const find = (focused: 'web' | 'note') =>
      ranked('find', everything({ focused, files: [...FILES, file('Findings.md')] })).map(named)
    expect(find('note')[0]).toBe('Findings')
    expect(find('web')[0]).toBe('> Find in page')
  })

  test('lets use carry a thing up, but not past a better match', () => {
    const used = (key: string) => (key === 'setting:editor/Text size' ? 12 : 0)
    // Used every day, the setting is the first thing `te` finds.
    expect(top('te', { worth: used }, 1)).toEqual(['setting Text size'])
    // But not what `tax` finds, which it barely holds.
    expect(top('tax', { worth: used }, 1)).toEqual(['Tax'])
  })
})

describe('one row per place', () => {
  test('a note that is open is its tab, switched to', () => {
    const open = tab('t1', 'Tax', { path: `${ROOT}/Home/Tax.md` })
    const found = ranked('tax', everything({ tabs: [open] })).map(named)

    expect(found).toEqual(['tab Tax'])
  })

  test('a page that is open is its tab', () => {
    const url = 'https://moodle-app2.let.ethz.ch/'
    const found = ranked(
      'moodle',
      everything({
        tabs: [tab('w', 'Moodle ETH', { kind: 'web', url })],
        pages: [visit(url, 'Moodle ETH')],
      }),
    ).map(named)

    expect(found.filter((one) => one.includes('Moodle ETH'))).toEqual(['tab Moodle ETH'])
  })

  test('the tab in front is found, but not first', () => {
    const here = tab('t1', 'Plan', { path: `${ROOT}/Plan.md` })
    expect(top('plan', { tabs: [here], active: 't1' }, 2)).toEqual(['Plan', 'tab Plan'])
  })

  test('a bookmarked note is the note, raised; a heading is a row of its own', () => {
    const found = ranked(
      'plan',
      everything({
        bookmarks: [
          { kind: 'note', path: 'Uni/Plan.md', text: '' },
          { kind: 'heading', path: 'Plan.md', text: 'Plan B' },
        ],
      }),
    )

    const [first] = found
    expect(first?.kind === 'note' && first.entry.path).toBe(`${ROOT}/Uni/Plan.md`)
    expect(found.map(named)).toContain('bookmark Plan B')
  })

  test('a setting a command already opens is the command', () => {
    const found = candidates(
      world({
        commands: [command('shortcuts', 'Shortcuts')],
        settings: [setting('Shortcuts', 'Settings')],
      }),
    )
    expect(found.map((one) => named(one.item))).toEqual(['> Shortcuts'])
  })
})

describe('a field with nothing typed', () => {
  test('lists what was used lately, notes and commands together, newest first', () => {
    const at: Record<string, number> = {
      'command:reopen': NOW - 1000,
      [`note:${ROOT}/Home/Tax.md`]: NOW - 2000,
      'command:print': NOW - 3000,
    }
    const all = everything({ recent: [`${ROOT}/Home/Tax.md`, `${ROOT}/Plan.md`] })
    const rows = resting(
      all,
      { recent: [`${ROOT}/Home/Tax.md`, `${ROOT}/Plan.md`], active: null },
      (key) => at[key] ?? null,
      6,
    )

    expect(rows.map(named)).toEqual([
      '> Reopen closed tab',
      'Tax',
      '> Print',
      // The notes opened lately that the curve has no time for, then the rest.
      'Plan',
      'Lecture 3',
      'Plan',
    ])
  })

  test('leaves out the tab in front', () => {
    const here = tab('t1', 'Tax', { path: `${ROOT}/Home/Tax.md` })
    const recent = [`${ROOT}/Home/Tax.md`, `${ROOT}/Plan.md`]
    const all = everything({ tabs: [here], active: 't1', recent })
    const rows = resting(all, { recent, active: 't1' }, () => null, 2)

    expect(rows.map(named)).toEqual(['Plan', 'Lecture 3'])
  })
})

describe('what a row is counted under', () => {
  test('is the same for a note open or not', () => {
    const note = file('Plan.md')
    expect(rowKey({ kind: 'note', entry: note, folder: null, shared: false })).toBe(
      rowKey({
        kind: 'tab',
        tab: tab('x', 'Plan', { path: note.path }),
        folder: null,
        shared: false,
      }),
    )
  })

  test('is nothing for a place in the note or a note not made yet', () => {
    expect(rowKey({ kind: 'place', line: 1, text: 'Intro', depth: 0, hint: null })).toBeNull()
    expect(rowKey({ kind: 'make', make: { folder: '', name: 'X.md' } })).toBeNull()
  })
})

describe('the rows built again while the palette is open', () => {
  /** What a note's row was read out of, which is the same array for as long as the
   *  row was not read again. */
  const readOf = (all: ReturnType<typeof candidates>, path: string) =>
    all.find((one) => one.item.kind === 'note' && one.item.entry.path === path)?.also

  test('read only the notes whose entries changed', () => {
    const [plan, lecture, tax] = [file('Plan.md'), file('Uni/Lecture 3.md'), file('Home/Tax.md')]
    const before = candidates(world({ files: [plan, lecture, tax] }))

    // A tree read again replaces what changed and keeps the rest: here a rename.
    const renamed = file('Home/Taxes.md')
    const after = candidates(world({ files: [plan, lecture, renamed] }))

    expect(readOf(after, plan.path)).toBe(readOf(before, plan.path))
    expect(readOf(after, lecture.path)).toBe(readOf(before, lecture.path))
    expect(readOf(after, renamed.path)).toEqual(['home/taxes'])
  })

  test('still say which names two notes share, and the notes used lately still lead', () => {
    const files = [file('Uni/Plan.md'), file('Home/Tax.md'), file('Plan.md')]
    candidates(world({ files }))

    const again = candidates(world({ files, recent: [`${ROOT}/Plan.md`, `${ROOT}/Home/Tax.md`] }))
    const notes = again.flatMap((one) => (one.item.kind === 'note' ? [one.item] : []))

    expect(notes.map((one) => one.entry.name)).toEqual(['Plan.md', 'Tax.md', 'Plan.md'])
    expect(notes.map((one) => one.shared)).toEqual([true, false, true])
  })
})

describe('the headings of the note in front', () => {
  const HEADINGS = [
    { line: 0, text: 'Introduction', level: 1 },
    { line: 4, text: 'Method', level: 2 },
  ]

  test('come in only when typed for closely', () => {
    const all = [...everything(), ...headingCandidates(HEADINGS, false)]
    expect(ranked('introduction', all).map(named)).toContain('# Introduction')
    expect(ranked('ion', all).map(named)).not.toContain('# Introduction')
  })

  test('sit under one another behind `#`', () => {
    const rows = headingCandidates(HEADINGS, true).map((one) => one.item)
    expect(rows.map((row) => (row.kind === 'place' ? row.depth : -1))).toEqual([0, 1])
  })
})
