import { describe, expect, test, vi } from 'vitest'
import type { MenuGroup, MenuRow } from './menu-item'
import type { MenuItem } from './menu-item'
import { de } from '../locales/de'

/** The stores write to the browser's storage and ask the browser what kind of
 *  machine this is, and there is neither under node. */
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
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded once, at module scope: the menu and the command list reach half the app,
 *  and compiling that belongs to no one test. See docs/conventions.md. */
const { appMenu, ISSUES_URL, RELEASES_URL, SOURCE_URL } = await import('./app-menu')
const { isSubmenu, walkableRows } = await import('./menu-item')
const { appCommands } = await import('./commands')
const { BY_ID } = await import('./shortcuts/registry')
const { i18n } = await import('./i18n.svelte')

const menu = (): MenuGroup[] => appMenu({ onpalette: () => undefined, onhistory: () => undefined })

function group(id: string): MenuGroup {
  const found = menu().find((one) => one.id === id)
  if (!found) throw new Error(`no ${id} group in the menu`)
  return found
}

/** The rows of a group, rules left out. */
function rows(id: string): MenuRow[] {
  return group(id).rows.filter((row) => row !== null)
}

function actions(id: string): MenuItem[] {
  return rows(id).filter((row): row is MenuItem => row !== null && !isSubmenu(row))
}

const labels = (id: string): string[] => actions(id).map((row) => row.label)

describe('the shape of the menu', () => {
  test('has the six groups a menu bar has, and no seventh for exporting', () => {
    expect(menu().map((one) => one.id)).toEqual([
      'file',
      'edit',
      'paragraph',
      'format',
      'view',
      'help',
    ])
  })

  /** Export was a group of its own beside File, which put the formats a note goes
   *  out as in the same strip as File, Edit and View. A person looking for "export"
   *  looks under File, because that is where every other editor keeps it. */
  test('keeps Export under File, as one row with rows of its own', () => {
    const submenus = rows('file').filter(isSubmenu)

    expect(submenus.map((one) => one.label)).toEqual(['Export'])
    expect(submenus[0]?.rows.length).toBeGreaterThan(5)
  })

  test('never goes deeper than one submenu', () => {
    for (const one of menu()) {
      for (const row of one.rows.filter((row) => row !== null && isSubmenu(row))) {
        if (!isSubmenu(row)) continue
        expect(row.rows.filter(isSubmenu), one.id).toEqual([])
      }
    }
  })
})

describe('File', () => {
  test('offers printing', () => {
    // Only where the machine has a print dialog at all; under node it has none,
    // so the row is absent and that is the row doing its job.
    const printing = labels('file').includes('Print')
    expect(printing).toBe(typeof window !== 'undefined' && typeof window.print === 'function')
  })

  test('offers Save as, greyed out with nothing of the reader’s own open', () => {
    const row = actions('file').find((one) => one.label === 'Save as')
    expect(row).toBeDefined()
    expect(row?.disabled).toBe(true)
  })

  /** It used to be offered only where pandoc was installed, which answered
   *  "can this be read" before the reader had said what they had. The sheet asks
   *  for the file first and answers it afterwards, so the row is always here. */
  test('offers Import wherever it runs', () => {
    expect(labels('file')).toContain('Import')
    expect(labels('file')).not.toContain('Import a document')
  })
})

describe('Edit', () => {
  test('offers both pastes and both ways of finding', () => {
    expect(labels('edit')).toEqual([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Paste as plain text',
      'Select all',
      'Find',
      'Replace',
      'Find next',
      'Find previous',
      'Search',
    ])
  })

  /** The keys every editor walks its matches with were nowhere to be read: Cmd+G
   *  worked, and no row said so. */
  test('and the rows that walk from one match to the next, on their keys', () => {
    const edit = menu().find((group) => group.id === 'edit')?.rows ?? []
    const commands = edit.flatMap((row) => (row && 'command' in row ? [row.command] : []))

    expect(commands).toContain('edit.find-next')
    expect(commands).toContain('edit.find-previous')
  })
})

describe('Paragraph and Format', () => {
  test('offer the blocks a note is written out of', () => {
    for (const label of [
      'Task list',
      'Callout',
      'Footnote',
      'Table of contents',
      'Front matter',
      'Picture',
      'One heading level up',
      'One heading level down',
    ]) {
      expect(labels('paragraph'), label).toContain(label)
    }
  })

  test('offer a comment, which is the one mark that is not for the reader', () => {
    expect(labels('format')).toContain('Comment')
  })
})

describe('View and Help', () => {
  /** A page in a browser has no window of its own to raise, and this is not a
   *  desktop build, so the row is not there. */
  test('leaves Always on top to the desktop', () => {
    expect(labels('view')).not.toContain('Always on top')
  })

  test('sends a bug and a release note to the repository the app is written in', () => {
    expect(labels('help')).toContain('Report an issue')
    expect(labels('help')).toContain('What is new')
    expect(ISSUES_URL.startsWith(SOURCE_URL)).toBe(true)
    expect(RELEASES_URL.startsWith(SOURCE_URL)).toBe(true)
  })
})

/** A row in a menu, a row in the palette and a row in the shortcut settings are
 *  three ways to the same thing, and a person who knows what it is called should
 *  not have to know which of the three to look in. */
describe('the menu, the palette and the shortcut settings agree', () => {
  const shared = [
    ['paragraph.task-list', 'Task list'],
    ['paragraph.callout', 'Callout'],
    ['paragraph.footnote', 'Footnote'],
    ['paragraph.toc', 'Table of contents'],
    ['paragraph.front-matter', 'Front matter'],
    ['paragraph.heading-up', 'One heading level up'],
    ['paragraph.heading-down', 'One heading level down'],
    ['format.comment', 'Comment'],
    ['view.fold', 'Fold'],
    ['view.fold-all', 'Fold everything'],
    ['view.unfold-all', 'Unfold everything'],
    ['edit.replace', 'Replace'],
    ['app.print', 'Print'],
  ] as const

  test('every one of them has an entry a key can be put on', () => {
    for (const [id, label] of shared) {
      expect(BY_ID.get(id), id).toBeDefined()
      expect(BY_ID.get(id)?.label(), id).toBe(label)
    }
  })

  test('every block the Paragraph and Format menus offer is in the palette too', () => {
    const offered = new Set(appCommands().map((one) => one.label))
    // Replace is a row of Edit rather than a block, and Print is only there on a
    // machine that has a print dialog; both are their own tests above.
    const elsewhere = new Set(['Replace', 'Print'])

    for (const [, label] of shared) {
      if (elsewhere.has(label)) continue
      expect(offered.has(label), label).toBe(true)
    }
  })

  test('a row that carries a key carries the one the registry holds', () => {
    for (const one of menu()) {
      for (const row of actions(one.id)) {
        if (!row.hint) continue
        // A hint is only ever `shortcuts.hint(id)`, so any hint at all means the
        // registry answered; an id that is not in it answers undefined.
        expect(row.hint.length, `${one.id}: ${row.label}`).toBeGreaterThan(0)
      }
    }
  })
})

/** The palette is the way in for somebody who has not learned the menus, so
 *  every row of it has to read in the language the app is set to. A row built by
 *  pasting a name onto an English word reads as English in all four. */
describe('the palette in another language', () => {
  /** The catalogue is fetched when a language is chosen, so the reading happens
   *  once it has landed. Through `choice` and `load()` rather than `select()`,
   *  which writes to storage a test has none of. */
  const inGerman = async <T>(read: () => T): Promise<T> => {
    const was = i18n.choice
    i18n.choice = 'de'
    await i18n.load()
    try {
      return read()
    } finally {
      i18n.choice = was
      await i18n.load()
    }
  }

  test('says nothing in English', async () => {
    // The words that used to be pasted on: `Theme: Sepia`, `Code theme: One`,
    // `Mode: Dark`, `Recent: Note`. Each is a key with a `{name}` in it now.
    const english = await inGerman(() =>
      appCommands()
        .map((one) => one.label)
        .filter((label) => /^(Theme|Code theme|Mode|Recent):/.test(label)),
    )

    expect(english).toEqual([])
  })

  test('leaves no row standing in its English wording', async () => {
    // A label that is still an English key the German dictionary translates to
    // something else never went through `t()`. A word German keeps as it is -
    // Graph, Code - is its own translation and is not one of these.
    const unchanged = await inGerman(() =>
      appCommands()
        .map((one) => one.label)
        .filter((label) => typeof de[label] === 'string' && de[label] !== label),
    )

    expect(unchanged).toEqual([])
  })

  /** The one already in force is marked, not described: a word in the key's
   *  place would be a word to read where a shape says it. */
  test('ticks the theme in use rather than writing a word beside it', () => {
    const themes = appCommands().filter((one) => one.id.startsWith('theme:'))
    expect(themes.length).toBeGreaterThan(0)

    for (const row of themes) expect(row.hint, row.id).toBeUndefined()
    expect(themes.filter((one) => one.checked).length).toBe(1)
  })

  /** The scheme is its own choice, so it is its own three rows: the keyboard
   *  reaches the same ones the Appearance pane offers. */
  test('offers the three the scheme can be, one of them ticked', () => {
    const modes = appCommands().filter((one) => one.id.startsWith('scheme:'))

    expect(modes.map((one) => one.id)).toEqual(['scheme:system', 'scheme:dark', 'scheme:light'])
    expect(modes.filter((one) => one.checked).length).toBe(1)
  })
})

describe('where a key may stand in a menu', () => {
  const act = (label: string, disabled = false): MenuItem => ({
    label,
    disabled,
    run: () => undefined,
  })

  test('is every row there is, in the order they are drawn', () => {
    expect(walkableRows([act('one'), act('two'), act('three')])).toEqual([0, 1, 2])
  })

  test('is never a rule between groups', () => {
    expect(walkableRows([act('one'), null, act('two')])).toEqual([0, 2])
  })

  /** A greyed row does nothing when it is clicked, so landing on it would be a
   *  press that went nowhere and a cursor that looked stuck. */
  test('is never a row that is greyed out', () => {
    expect(walkableRows([act('one'), act('two', true), act('three')])).toEqual([0, 2])
  })

  test('is a row that leads to more rows, which is where it leads', () => {
    const rows: MenuRow[] = [act('one'), { label: 'Export', rows: [act('as a PDF')] }]
    expect(walkableRows(rows)).toEqual([0, 1])
  })

  test('has nowhere at all in an empty list', () => {
    expect(walkableRows([])).toEqual([])
    expect(walkableRows([null, null])).toEqual([])
  })

  test('is somewhere in the File group, which is live whatever is open', () => {
    expect(walkableRows(group('file').rows).length).toBeGreaterThan(0)
  })

  /** A group whose every row is greyed - Paragraph, with no note in front - has
   *  nowhere for a key to stand at all, which is why the cursor starts on
   *  nothing rather than on the first row. */
  test('is nowhere in a group where every row is greyed out', () => {
    const paragraph = group('paragraph')
    expect(paragraph.rows.length).toBeGreaterThan(0)
    expect(walkableRows(paragraph.rows)).toEqual([])
  })
})
