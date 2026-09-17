import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The one list of kinds a new tab can be.
 *
 *  Five places offered these and no two offered the same set: the strip's plus had
 *  four, the File menu the same four with no phone in mind, the sidebar's two menus
 *  three with page notes left out. There are three ways in now - the plus, Ctrl+T and
 *  the buttons an empty pane shows - so what this pins is that there is one list and
 *  they all read it. */

/** The store reads the browser's storage the moment it is made, and there is none
 *  under node - which is why it is imported below rather than at the top. */
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

const { newKindMenu, newKinds } = await import('./new-kinds')
const { standingAt } = await import('./last-kind')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')
const { isSubmenu } = await import('./menu-item')

let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  localStorage.clear()
})

afterEach(() => {
  viewport.device = was
  vi.restoreAllMocks()
})

/** Every maker stood in for, and a note of which one was asked. Nothing here writes
 *  a file: what a kind does is its own test, and what this asks is which of them a
 *  row reaches. */
function makers(): string[] {
  const made: string[] = []

  // The openers that make a tab and no file, which is what every row here does now;
  // `createCanvas` and the two beside it are the file list's own gesture and write a
  // named file. See newCanvas in workspace.svelte.ts.
  vi.spyOn(workspace, 'openBlank').mockImplementation(() => void made.push('note'))
  vi.spyOn(workspace, 'newCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'openWebsite').mockImplementation(() => void made.push('web'))
  vi.spyOn(workspace, 'newPages').mockImplementation(async () => void made.push('pages'))

  return made
}

describe('the kinds a new tab can be', () => {
  test('are the four, in the order a reader is offered them', () => {
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'web', 'pages'])
  })

  test('read as the words every menu in the app already uses', () => {
    expect(newKinds().map((one) => one.label())).toEqual([
      'New note',
      'New canvas',
      'New web note',
      'New page note',
    ])
  })

  /** The shape the file list and the tab strip already draw for the kind, so the
   *  buttons in an empty pane and the rows in a list say the same thing. */
  test('each wears the mark its own files wear', () => {
    expect(newKinds().map((one) => one.mark)).toEqual(['note', 'canvas', 'web', 'pages'])
  })

  /** A website is a bookmark on a phone: it opens in the phone's own browser, so
   *  there is no tab to make and the row would answer nothing. */
  test('leave the website out on a phone', () => {
    viewport.device = 'phone'
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages'])
  })

  test('make one each', () => {
    const made = makers()
    for (const one of newKinds()) one.make()

    expect(made).toEqual(['note', 'canvas', 'web', 'pages'])
  })

  /** The pane whose plus was pressed takes the keyboard first, so a plus in the other
   *  pane does not open its note over here. */
  test('in the pane that asked', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

    newKinds()[0]?.make('a-pane')
    expect(focused).toHaveBeenCalledWith('a-pane')
  })

  test('and in whichever pane has the keyboard when nobody names one', () => {
    makers()
    const focused = vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

    newKinds()[0]?.make()
    expect(focused).not.toHaveBeenCalled()
  })

  test('are the rows of the chooser, in the same order and the same words', () => {
    const rows = newKindMenu().map((one) => (one !== null && !isSubmenu(one) ? one.label : null))
    expect(rows).toEqual(newKinds().map((one) => one.label()))
  })

  test('and a row of it makes its kind', () => {
    const made = makers()
    for (const row of newKindMenu()) {
      if (row !== null && !isSubmenu(row)) row.run()
    }

    expect(made).toEqual(['note', 'canvas', 'web', 'pages'])
  })
})

/** Emil, 2026-09-17: *"The last chosen one should be selected already."* Which kind
 *  that is is written down by the maker rather than by the door, so the plus, Ctrl+T,
 *  the File menu and the buttons in an empty pane all agree about it; see
 *  last-kind.ts. */
describe('the kind that was chosen last', () => {
  test('is written down by whichever way in made one', () => {
    makers()
    newKinds()[1]?.make()

    expect(standingAt(newKinds().map((one) => one.kind))).toBe(1)
  })

  test('is the row the chooser opens on', () => {
    makers()
    newKinds()[2]?.make()

    const rows = newKindMenu()
    expect(rows.map((one) => (one !== null && !isSubmenu(one) ? !!one.stands : null))).toEqual([
      false,
      false,
      true,
      false,
    ])
  })

  test('and the first row stands until something has been', () => {
    const rows = newKindMenu()
    expect(rows.map((one) => (one !== null && !isSubmenu(one) ? !!one.stands : null))).toEqual([
      true,
      false,
      false,
      false,
    ])
  })
})
