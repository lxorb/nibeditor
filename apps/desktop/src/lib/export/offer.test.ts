import { describe, expect, test, vi } from 'vitest'
import type { MenuItem } from '../menu-item'
import { EXPORT_FORMATS, EXPORT_VARIANTS } from './formats'
import {
  EXPORT_EXTRAS,
  EXPORT_KEYS,
  type ExportId,
  type ExportKind,
  exportKindOf,
  isNoteFormat,
  labelOf,
  offeredBy,
} from './offer'

const TEN = EXPORT_FORMATS.map((format) => format.id)
const VARIANTS = EXPORT_VARIANTS.map((variant) => variant.id)
const KINDS: ExportKind[] = ['note', 'deck', 'canvas', 'file', 'none']

/** A note with a slide break in it, which is what makes a note a deck. */
const DECK = '# One\n\ntext\n\n---\n\n# Two\n\nmore\n'

describe('what each kind of document goes out as', () => {
  test('gives a note the ten formats and the two variants', () => {
    expect(offeredBy('note')).toEqual([...TEN, ...VARIANTS])
  })

  test('gives a deck the same, plus the slides the deck code writes', () => {
    expect(offeredBy('deck')).toEqual([...TEN, 'slides-html', 'slides-pdf', ...VARIANTS])
  })

  test('gives a canvas the three its own picture code draws', () => {
    expect(offeredBy('canvas')).toEqual(['png', 'svg', 'pdf'])
  })

  /** The bug this exists to prevent: a drawing offered as a Word file, an ePub or
   *  plain text, none of which a drawing has anything to put in. */
  test('never offers a canvas a format a drawing cannot be', () => {
    for (const id of ['txt', 'md', 'textbundle', 'rtf', 'jpg', 'html', 'docx', 'epub'] as const) {
      expect(offeredBy('canvas'), id).not.toContain(id)
    }
  })

  test('offers a file the app is only showing its own bytes and nothing else', () => {
    expect(offeredBy('file')).toEqual(['copy'])
  })

  test('offers nothing for a document there is nothing to export', () => {
    expect(offeredBy('none')).toEqual([])
  })

  /** Each kind has one order and keeps it. A note and a deck take the list's own,
   *  so a row sits where somebody last saw it; a canvas takes the order its own
   *  menu on the plane already lists, which is the row above this test. */
  test('keeps the ten in the list own fixed order for the kinds that have them', () => {
    for (const kind of ['note', 'deck'] as const) {
      const ten = offeredBy(kind).filter((id) => TEN.some((one) => one === id))
      expect(ten, kind).toEqual(TEN)
    }
  })

  test('offers a row at most once per kind', () => {
    for (const kind of KINDS) {
      const ids = offeredBy(kind)
      expect(new Set(ids).size, kind).toBe(ids.length)
    }
  })
})

describe('which kind the thing on screen is', () => {
  test('is nothing at all with no tab open', () => {
    expect(exportKindOf(null)).toBe('none')
  })

  test('is a note for a note', () => {
    expect(exportKindOf({ kind: 'note', path: '/s/a.md', text: '# Head\n' })).toBe('note')
  })

  test('is a deck for a note with slide breaks in it', () => {
    expect(exportKindOf({ kind: 'note', path: '/s/talk.md', text: DECK })).toBe('deck')
  })

  test('is a canvas for a canvas', () => {
    expect(exportKindOf({ kind: 'canvas', path: '/s/b.canvas', text: '{"nodes":[]}' })).toBe(
      'canvas',
    )
  })

  test('is a file for a paper with a path to read its bytes off', () => {
    expect(exportKindOf({ kind: 'pdf', path: '/s/paper.pdf', text: '' })).toBe('file')
  })

  /** No path is no bytes, and a row that cannot answer is worse than no row. */
  test('is nothing for a paper with no path behind it', () => {
    expect(exportKindOf({ kind: 'pdf', path: null, text: '' })).toBe('none')
  })

  test('is nothing for the graph of a space', () => {
    expect(exportKindOf({ kind: 'graph', path: null, text: '' })).toBe('none')
  })
})

describe('the rows themselves', () => {
  test('know which of them run.ts writes', () => {
    for (const id of [...TEN, ...VARIANTS]) expect(isNoteFormat(id), id).toBe(true)
    for (const extra of EXPORT_EXTRAS) expect(isNoteFormat(extra.id), extra.id).toBe(false)
  })

  test('each say something other than their own id', () => {
    for (const kind of KINDS) {
      for (const id of offeredBy(kind)) {
        expect(labelOf(id), id).not.toBe(id)
        expect(labelOf(id).trim(), id).not.toBe('')
      }
    }
  })

  test('can each be put on a key, but for the variants', () => {
    const bindable = new Set<ExportId>(EXPORT_KEYS)
    const offered = new Set(KINDS.flatMap((kind) => offeredBy(kind)))

    for (const id of offered) {
      if (VARIANTS.some((variant) => variant === id)) continue
      expect(bindable.has(id), id).toBe(true)
    }
  })

  test('are the only rows a key is offered for', () => {
    const offered = new Set(KINDS.flatMap((kind) => offeredBy(kind)))
    for (const id of EXPORT_KEYS) expect(offered.has(id), id).toBe(true)
  })
})

/** The other half: that the File menu, the command palette and the shortcut
 *  settings all read the offer above rather than each keeping a list.
 *
 *  The stores are the real ones, with the platform and the browser stood in for,
 *  because what is being tested is that three readers of one list agree - and a
 *  mock of the list would agree with itself. */
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

const CANVAS = '{"nodes":[],"edges":[]}'

vi.mock('../tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tauri')>()),
  invoke: (command: string) => Promise.resolve(command === 'read_note' ? CANVAS : undefined),
}))

vi.stubGlobal('localStorage', memoryStorage())
vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

/** Loaded once, at module scope: the command list and the menu reach half the
 *  app, and compiling that belongs to no one test. See docs/conventions.md. */
const { workspace } = await import('../workspace.svelte')
const { exportCommands } = await import('../commands')
const { appMenu } = await import('../app-menu')
const { isSubmenu } = await import('../menu-item')
const { SHORTCUTS } = await import('../shortcuts/registry')

/** Every row of Export, which is a submenu of File: rule rows left out. */
function menuRows(): MenuItem[] {
  const file = appMenu({ onpalette: () => undefined, onhistory: () => undefined }).find(
    (one) => one.id === 'file',
  )

  const submenu = file?.rows.find((row) => row !== null && isSubmenu(row))
  if (!submenu || !isSubmenu(submenu)) throw new Error('Export is not a submenu of File')

  return submenu.rows.filter((row): row is MenuItem => row !== null && !isSubmenu(row))
}

/** The same rows as labels. */
function menuLabels(): string[] {
  return menuRows().map((row) => row.label)
}

/** The ids of the format rows the palette offers, in order. */
function offeredIds(): string[] {
  return exportCommands()
    .map((command) => command.id)
    .filter((id) => id.startsWith('export-'))
    .map((id) => id.slice('export-'.length))
}

/** Closes whatever the last test opened, so each starts from an empty window. */
async function only(open: () => Promise<void> | void) {
  for (const tab of [...workspace.tabs]) workspace.close(tab.id)
  await open()
}

describe('the menu, the palette and the shortcut settings', () => {
  test('offer a note what the offer says, in that order', async () => {
    await only(() => workspace.openBlank('Note.md', '# Head\n'))
    expect(offeredIds()).toEqual([...offeredBy('note')])
  })

  test('offer a deck the slides as well', async () => {
    await only(() => workspace.openBlank('Talk.md', DECK))
    expect(offeredIds()).toEqual([...offeredBy('deck')])
  })

  test('offer a canvas its three, and nothing a note has', async () => {
    await only(() => workspace.openCanvas('/space/board.canvas'))
    expect(offeredIds()).toEqual([...offeredBy('canvas')])
    expect(menuLabels()).toEqual(['Export as PNG', 'Export as SVG', 'Export as PDF'])
  })

  /** A paper has no tab of its own: it opens the page note beside it, so what
   *  Export offers is what a set of pages offers. */
  test('offer a paper what its page note offers', async () => {
    await only(() => workspace.openPdf('/space/paper.pdf'))
    expect(offeredIds()).toEqual([...offeredBy('pages')])
  })

  /** Greying out rather than vanishing: the menu keeps its shape, and the reason
   *  a row cannot run is the row itself. */
  test('keep the Export menu with every row greyed out when nothing can go out', async () => {
    await only(() => workspace.openGraph())

    expect(offeredIds()).toEqual([...offeredBy('note')])
    expect(menuRows().length).toBeGreaterThan(0)
    expect(menuRows().filter((row) => row.label !== 'Page setup for export')).toSatisfy(
      (rows: { disabled?: boolean }[]) => rows.every((row) => row.disabled === true),
    )
  })

  test('show the same rows in the same order in the menu as in the palette', async () => {
    for (const open of [
      () => workspace.openBlank('Note.md', '# Head\n'),
      () => workspace.openBlank('Talk.md', DECK),
      () => workspace.openCanvas('/space/board.canvas'),
      () => workspace.openPdf('/space/paper.pdf'),
    ]) {
      await only(open)
      expect(menuLabels()).toEqual(exportCommands().map((command) => command.label))
    }
  })

  test('put a key within reach of every row the palette offers', async () => {
    const bound = new Set(SHORTCUTS.map((one) => one.id))

    for (const open of [
      () => workspace.openBlank('Talk.md', DECK),
      () => workspace.openCanvas('/space/board.canvas'),
      () => workspace.openPdf('/space/paper.pdf'),
    ]) {
      await only(open)
      for (const id of offeredIds()) {
        if (VARIANTS.some((variant) => variant === id)) continue
        expect(bound.has(`export.${id}`), id).toBe(true)
      }
    }
  })

  /** A key bound to a format this document does not go out as finds no row, which
   *  is how it comes to do nothing rather than to fail. */
  test('leave a key for a format this document has not got nothing to run', async () => {
    await only(() => workspace.openCanvas('/space/board.canvas'))

    for (const id of ['docx', 'epub', 'txt', 'slides-html']) {
      expect(
        exportCommands().find((command) => command.id === `export-${id}`),
        id,
      ).toBeUndefined()
    }
  })
})
