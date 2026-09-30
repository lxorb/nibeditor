import { describe, expect, test, vi } from 'vitest'
import type { Row } from './rows'

/** What the palette puts first for the things a person actually types into it.
 *
 *  A space shaped like Emil's - lecture notes, a tax folder, a roadmap, a canvas, a
 *  paper - with two pages open and a history behind them, and the app's real commands
 *  and real settings, so the question is the one the palette is asked: for these
 *  letters, is the thing meant the first row, or at least in the first three? Each
 *  case is a query and the row it should find, and the whole set is held to a rate
 *  rather than case by case, because a ranking is a trade: moving one row up moves
 *  another down, and what matters is how often Enter is right.
 *
 *  `NIB_EVAL=1` prints every case with where its row landed, beside where the palette
 *  before this one put it: notes by name and nothing else without a `>`. */

function memoryStorage(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (index) => [...held.keys()][index] ?? null,
    getItem: (key) => held.get(key) ?? null,
    setItem: (key, value) => void held.set(key, value),
    removeItem: (key) => void held.delete(key),
    clear: () => held.clear(),
  }
}

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded at module scope: the commands and the settings reach half the app, and
 *  compiling that belongs to no single test. See docs/conventions.md. */
const { appCommands } = await import('../commands')
const { preferences } = await import('../preferences')
const { places } = await import('../settings/places')
const { sectionGroups } = await import('../settings/sections')
const { t } = await import('../i18n.svelte')
const { rank, recentFirst } = await import('../fuzzy')
const { shownName } = await import('../note-name')
const { candidates } = await import('./kinds')
const { ranked } = await import('./rank')
const { settingsOf } = await import('./settings')
const { file, named, NOW, ROOT, tab, visit, world } = await import('./world.fixture')

const FILES = [
  'Plan.md',
  'Ideas.md',
  'Groceries.md',
  'Reading list.md',
  'Meeting notes.md',
  'Uni/Lecture 3.md',
  'Uni/PProg exam review.md',
  'Uni/Analysis II.md',
  'Uni/Exchange application.md',
  'Home/Tax 2026.md',
  'Home/Flat.md',
  'Projects/nib roadmap.md',
  'Projects/Battlecode art.md',
  'Journal/2026-09-29.md',
  'Journal/2026-09-30.md',
  'Board.canvas',
  'Attention is all you need.pdf',
  'Moodle.url',
].map(file)

const MOODLE = 'https://moodle-app2.let.ethz.ch/'

const WORLD = world({
  files: FILES,
  tabs: [
    tab('t1', 'nib roadmap', { path: `${ROOT}/Projects/nib roadmap.md` }),
    tab('t2', 'Moodle', { kind: 'web', url: MOODLE }),
    tab('t3', 'YouTube', { kind: 'web', url: 'https://www.youtube.com/' }),
    tab('t4', 'Plan', { path: `${ROOT}/Plan.md` }),
  ],
  active: 't4',
  focused: 'note',
  recent: [`${ROOT}/Plan.md`, `${ROOT}/Home/Tax 2026.md`, `${ROOT}/Uni/Lecture 3.md`],
  bookmarks: [
    { kind: 'heading', path: 'Plan.md', text: 'Goals' },
    { kind: 'search', path: '', text: 'tag:work' },
  ],
  commands: appCommands(),
  pages: [
    visit(MOODLE, 'Moodle', { visits: 30, typed: 4 }),
    visit('https://github.com/lxorb/nibeditor', 'lxorb/nibeditor: a Typora-style editor', {
      visits: 12,
    }),
    visit('https://chatgpt.com/', 'ChatGPT', { visits: 20, typed: 2 }),
    visit('https://docs.rs/tauri/latest/tauri/', 'tauri - Rust', { visits: 3 }),
    visit('https://www.polybox.ethz.ch/', 'polybox', { visits: 2 }),
  ],
  settings: settingsOf(sectionGroups().flat(), preferences(), places(), t('Settings')),
  now: NOW,
})

/** A query, the row it should find, and whether that row has to be the first one or
 *  only among the first three. */
const CASES: [string, string, 1 | 3][] = [
  // Notes, by their names and their folders.
  ['plan', 'tab Plan', 3],
  ['lecture', 'Lecture 3', 1],
  ['lec', 'Lecture 3', 1],
  ['pprog', 'PProg exam review', 1],
  ['exam', 'PProg exam review', 1],
  ['tax', 'Tax 2026', 1],
  ['groc', 'Groceries', 1],
  ['ideas', 'Ideas', 1],
  ['uni/ana', 'Analysis II', 1],
  ['exchange', 'Exchange application', 1],
  ['flat', 'Flat', 1],
  ['meeting', 'Meeting notes', 1],
  ['attention', 'Attention is all you need.pdf', 1],
  ['board', 'Board.canvas', 1],
  ['09-30', '2026-09-30', 1],
  // Open tabs, switched to.
  ['roadmap', 'tab nib roadmap', 1],
  ['moodle', 'tab Moodle', 1],
  ['youtube', 'tab YouTube', 1],
  // Commands.
  ['new', '> New note', 1],
  ['new note', '> New note', 1],
  ['new canvas', '> New canvas', 1],
  ['reopen', '> Reopen closed tab', 1],
  ['close all', '> Close all tabs', 1],
  ['split', '> Split right', 1],
  ['word', '> Export as Word', 1],
  ['settings', '> Settings', 1],
  ['shortcuts', '> Shortcuts', 1],
  ['sidebar', '> Show sidebar', 1],
  ['focus', '> Focus mode', 1],
  ['typewriter', '> Typewriter mode', 1],
  ['zoom in', '> Zoom in', 1],
  ['graph', '> Graph', 1],
  ['outline', '> Outline', 1],
  ['rename', '> Rename', 1],
  ['move pane', '> Move to other pane', 1],
  ['fold', '> Fold', 1],
  ['heading 2', '> Heading 2', 1],
  ['dark', '> Mode: Dark', 1],
  ['export pdf', '> Export as PDF', 1],
  // Pages from the history.
  ['github', 'page lxorb/nibeditor: a Typora-style editor', 1],
  ['chatgpt', 'page ChatGPT', 1],
  ['polybox', 'page polybox', 1],
  ['tauri', 'page tauri - Rust', 3],
  // Settings, which have to be asked for by name.
  ['spelling', 'setting Spelling', 1],
  ['spell check', 'setting Check spelling', 1],
  ['check spelling', 'setting Check spelling', 1],
  ['font', 'setting Text size', 1],
  ['text size', 'setting Text size', 1],
  ['line width', 'setting Line width', 1],
  ['language', 'setting Language', 1],
  ['vim', 'setting Vim keys', 1],
  ['ligatures', 'setting Ligatures', 1],
  ['dark', 'setting Mode', 3],
  // Bookmarks.
  ['goals', 'bookmark Goals', 1],
  ['tag:work', 'bookmark tag:work', 1],
  // Slips.
  ['reopne', '> Reopen closed tab', 1],
  ['lectrue', 'Lecture 3', 1],
  ['setings', '> Settings', 1],
]

const ALL = candidates(WORLD)

/** Where a row lands for a query, from one, or null where it is not in the list. */
function placeOf(expected: string, rows: readonly Row[]): number | null {
  const at = rows.map(named).indexOf(expected)
  return at < 0 ? null : at + 1
}

/** The palette before this one: without a `>`, notes by name and path, the ones
 *  opened lately winning ties, and nothing else. */
function before(query: string): Row[] {
  const where = (path: string) => path.slice(ROOT.length + 1)
  return rank(
    query,
    recentFirst(FILES, WORLD.recent, (one) => one.path),
    (one) => [shownName(one.name), shownName(where(one.path))],
  ).map((entry): Row => ({ kind: 'note', entry, folder: null, shared: false }))
}

describe('what the palette puts first', () => {
  const results = CASES.map(([query, expected, within]) => {
    const now = placeOf(expected, ranked(query, ALL))
    // A note that is open was a note row before there were tab rows.
    const then = placeOf(expected.replace(/^tab /, ''), before(query))
    return { query, expected, within, now, then }
  })

  if (process.env.NIB_EVAL === '1') {
    const shown = (at: number | null) => (at === null ? '-' : String(at))
    for (const one of results) {
      console.log(
        `${one.query.padEnd(14)} ${one.expected.padEnd(48)} now ${shown(one.now).padStart(2)}  before ${shown(one.then).padStart(2)}`,
      )
    }
    const rate = (key: 'now' | 'then', within: number) =>
      results.filter((one) => one[key] !== null && one[key] <= within).length / results.length
    console.log(
      `top 1: now ${rate('now', 1).toFixed(2)} before ${rate('then', 1).toFixed(2)}; top 3: now ${rate('now', 3).toFixed(2)} before ${rate('then', 3).toFixed(2)}`,
    )
  }

  test.each(results)('$query finds $expected', ({ now, within }) => {
    expect(now).not.toBeNull()
    expect(now).toBeLessThanOrEqual(within)
  })
})
