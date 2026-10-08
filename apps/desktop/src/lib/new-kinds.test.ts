import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** The one list of kinds a new tab can be.
 *
 *  Five places offered these and no two offered the same set: the strip's plus had
 *  four, the File menu the same four with no phone in mind, the sidebar's two menus
 *  three with page notes left out. Two places draw them now - a new tab under its
 *  address field and a pane with nothing open - so what this pins is that there is one
 *  list, in the lines Emil gave it (issue #213). */

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

/** An online terminal's maker asks the account for a session; here it only says it was
 *  asked. See online/open.ts. */
const online = vi.hoisted(() => ({ made: null as string[] | null }))
vi.mock('./online/open', () => ({
  openOnline: () => {
    online.made?.push('online')
    return Promise.resolve(null)
  },
}))

const { kindLines, newKinds } = await import('./new-kinds')
const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')

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
  online.made = made

  return made
}

describe('the kinds a new tab can be', () => {
  test('are the four, and an online terminal, in the order a reader is offered them', () => {
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages', 'online', 'web'])
  })

  /** *"Note, Canvas, Page Note | Terminal, Remote, Online Terminal | Web Note, Private Web
   *  Note"*: what is written, what runs, the web - with a line a page has nothing in left
   *  out rather than drawn empty. */
  test('stand in three lines: what is written, what runs, and the web', () => {
    expect(kindLines(newKinds()).map((line) => line.map((one) => one.kind))).toEqual([
      ['note', 'canvas', 'pages'],
      ['online'],
      ['web'],
    ])
  })

  test('read as the words every menu in the app already uses', () => {
    expect(newKinds().map((one) => one.label())).toEqual([
      'New note',
      'New canvas',
      'New page note',
      'Online terminal',
      'New web note',
    ])
  })

  /** The shape the file list and the tab strip already draw for the kind, so the
   *  buttons in an empty pane and the rows in a list say the same thing. */
  test('each wears the mark its own files wear', () => {
    expect(newKinds().map((one) => one.mark)).toEqual([
      'note',
      'canvas',
      'pages',
      'terminal',
      'web',
    ])
  })

  /** A website is a bookmark on a phone: it opens in the phone's own browser, so
   *  there is no tab to make and the row would answer nothing. */
  test('leave the website out on a phone', () => {
    viewport.device = 'phone'
    expect(newKinds().map((one) => one.kind)).toEqual(['note', 'canvas', 'pages', 'online'])
  })

  test('make one each', async () => {
    const made = makers()
    for (const one of newKinds()) one.make()

    // The online terminal's maker is fetched, so it arrives after the ones behind it.
    await vi.waitFor(() =>
      expect([...made].sort()).toEqual(['canvas', 'note', 'online', 'pages', 'web']),
    )
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

  /** A letter each on its card, and no two the same, or a key would have two kinds to
   *  make. See NewHere.svelte. */
  test('each answers a letter of its own', () => {
    const letters = newKinds().map((one) => one.letter)

    expect(letters).toEqual(['n', 'c', 'p', 'o', 'w'])
    expect(new Set(letters).size).toBe(letters.length)
  })
})
