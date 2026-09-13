import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** Turning a website that was written as a note into a `.url` shortcut, driven by a
 *  stand-in store.
 *
 *  This had almost no coverage while it lived in the workspace: the drives open a
 *  note, they do not migrate a format. What is held here is every branch the
 *  conversion owns - a note that is a website, one that is not, one somebody also
 *  wrote in, a name already taken, and signed in against signed out - because each is
 *  a different thing done to the files on disk. */

const sent: { command: string; path: string; content: string }[] = []
const disk = new Map<string, string>()
const told: string[] = []
let signedIn = true

vi.mock('../tauri', () => ({
  invoke: (command: string, args?: Record<string, unknown>) => {
    const path = typeof args?.path === 'string' ? args.path : ''
    const content = typeof args?.content === 'string' ? args.content : ''
    sent.push({ command, path, content })

    if (command === 'read_note') {
      const held = disk.get(path)
      return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
    }
    if (command === 'write_note') disk.set(path, content)
    if (command === 'delete_note' || command === 'trash_item') disk.delete(path)
    return Promise.resolve('')
  },
  joinPath: (dir: string, relative: string) => (dir ? `${dir}/${relative}` : relative),
}))

vi.mock('../account.svelte', () => ({
  account: {
    get signedIn() {
      return signedIn
    },
  },
}))

vi.mock('../link-index.svelte', () => ({
  links: {
    noteGone: (path: string) => void told.push(`gone ${path}`),
    // The `url:` of a note, for convertWebsites' own filter. A note is a website
    // when its text has a url line; the fixtures below carry one.
    urlOf: (path: string) => (disk.get(path)?.includes('url:') ? 'https://x' : null),
  },
}))

const { asShortcut, convertWebsites } = await import('./convert')
type Converts = import('./convert').Converts
type Entry = import('../workspace.svelte').Entry

const SPACE = '/space'

/** A note with a `url:` line, as the old format wrote one. `extra` is whatever the
 *  reader also put in the body. */
function urlNote(url: string, title: string, extra = ''): string {
  const front = `---\nurl: ${url}\ntitle: ${title}\n---\n`
  const body = `# ${title}\n\n<${url}>\n`
  return front + body + extra
}

/** A store over the disk, with the tree-edit calls recorded. */
function store(notes: Record<string, string>) {
  disk.clear()
  for (const [path, text] of Object.entries(notes)) disk.set(path, text)

  const shown: string[] = []
  const ws = {
    notes: Object.keys(notes).map((path) => ({ path, name: path.split('/').pop() ?? path })),
    activeSpace: { id: 's', name: 'Space', root: SPACE },
    entryAt: (path: string) => (disk.has(path) ? ({ path } as Entry) : null),
    freeName: (dir: string, wanted: string) => {
      // The store's own numbering, in one line: `Name 2.url`, `Name 3.url`.
      let at = 1
      let name = wanted
      while (disk.has(dir ? `${dir}/${name}` : name)) {
        at += 1
        name = wanted.replace(/(\.[^.]+)?$/, ` ${at}$1`)
      }
      return name
    },
    showEntry: (entry: Entry) => void shown.push(entry.path),
    freshEntry: (path: string, isFolder: boolean) => ({ path, is_dir: isFolder }) as Entry,
    loadTree: () => Promise.resolve(),
  }

  return { ws: ws as unknown as Converts, shown }
}

beforeEach(() => {
  sent.length = 0
  told.length = 0
  signedIn = true
})

afterEach(() => vi.restoreAllMocks())

describe('a note that is a website', () => {
  const NOTE = `${SPACE}/Svelte docs.md`

  test('is written as a shortcut beside it, and the note goes', async () => {
    const { ws, shown } = store({ [NOTE]: urlNote('https://svelte.dev', 'Svelte docs') })

    const target = await asShortcut(ws, NOTE)

    expect(target).toBe(`${SPACE}/Svelte docs.url`)
    expect(disk.get(target ?? '')).toContain('URL=https://svelte.dev')
    expect(disk.has(NOTE)).toBe(false)
    // The row appears before the filesystem has answered.
    expect(shown).toEqual([`${SPACE}/Svelte docs.url`])
    expect(told).toEqual([`gone ${NOTE}`])
  })

  test('and its file is deleted when signed in, trashed when not', async () => {
    const made = store({ [NOTE]: urlNote('https://svelte.dev', 'Svelte docs') })
    await asShortcut(made.ws, NOTE)
    expect(sent.map((one) => one.command)).toContain('delete_note')

    signedIn = false
    const again = store({ [NOTE]: urlNote('https://svelte.dev', 'Svelte docs') })
    await asShortcut(again.ws, NOTE)
    expect(sent.map((one) => one.command)).toContain('trash_item')
  })
})

describe('a note that only looks like one', () => {
  test('is left alone when it has no url', async () => {
    const NOTE = `${SPACE}/Plan.md`
    const { ws, shown } = store({ [NOTE]: '# Plan\n\njust words\n' })

    expect(await asShortcut(ws, NOTE)).toBeNull()
    expect(disk.get(NOTE)).toBe('# Plan\n\njust words\n')
    expect(shown).toEqual([])
    expect(told).toEqual([])
  })

  test('and a note that is not there at all', async () => {
    const { ws } = store({})
    expect(await asShortcut(ws, `${SPACE}/gone.md`)).toBeNull()
  })
})

describe('a note somebody also wrote in', () => {
  const NOTE = `${SPACE}/Svelte.md`

  test('stays a note with the url line taken out, beside its new shortcut', async () => {
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte', '\nMy own notes on it.\n'),
    })

    const target = await asShortcut(ws, NOTE)

    // Both come out of the one file: the shortcut, and the note that is still a note.
    expect(disk.has(target ?? '')).toBe(true)
    expect(disk.has(NOTE)).toBe(true)
    expect(disk.get(NOTE)).toContain('My own notes on it.')
    expect(disk.get(NOTE)).not.toContain('url: https://svelte.dev')
  })
})

describe('a shortcut name already taken', () => {
  test('the note keeps its own name, stepped aside', async () => {
    const NOTE = `${SPACE}/Svelte docs.md`
    const { ws } = store({
      [NOTE]: urlNote('https://svelte.dev', 'Svelte docs'),
      [`${SPACE}/Svelte docs.url`]: 'a shortcut somebody else put here',
    })

    const target = await asShortcut(ws, NOTE)

    expect(target).toBe(`${SPACE}/Svelte docs 2.url`)
    expect(disk.get(`${SPACE}/Svelte docs.url`)).toBe('a shortcut somebody else put here')
  })
})

describe('converting a whole space', () => {
  test('turns every url-note into a shortcut and counts them', async () => {
    const { ws } = store({
      [`${SPACE}/A.md`]: urlNote('https://a.dev', 'A'),
      [`${SPACE}/B.md`]: urlNote('https://b.dev', 'B'),
      [`${SPACE}/Plan.md`]: '# Plan\n\nwords\n',
    })

    expect(await convertWebsites(ws)).toBe(2)
    expect(disk.has(`${SPACE}/A.url`)).toBe(true)
    expect(disk.has(`${SPACE}/B.url`)).toBe(true)
    expect(disk.has(`${SPACE}/Plan.md`)).toBe(true)
  })

  test('and does nothing where there is no open space', async () => {
    const { ws } = store({ [`${SPACE}/A.md`]: urlNote('https://a.dev', 'A') })
    ;(ws as { activeSpace: unknown }).activeSpace = null

    expect(await convertWebsites(ws)).toBe(0)
    expect(sent).toEqual([])
  })
})
