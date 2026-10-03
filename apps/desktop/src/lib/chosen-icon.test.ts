import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The icon a file chose, asked by the space the file is in.
 *
 *  Emil, 2026-10-03: a note's custom icon only showed while its own space was the open
 *  one. The link index is a scan of the open space, so a tab from another space asked
 *  it and got nothing. Here are two spaces with a tab each, and both tabs wear their
 *  own icons whichever space is open - the open one's out of the index, the other's
 *  out of its file. See chosen-icon.ts and marks-elsewhere.svelte.ts. */

const FILES: Record<string, string> = {
  '/Work/Plan.md': '---\nicon: rocket\nicon-color: violet\n---\n# Plan\n',
  '/Home/Plan.md': '---\nicon: house\n---\n# Plan\n',
  '/Home/Docs.url':
    '[InternetShortcut]\r\nURL=https://docs.dev/\r\nTitle=Docs\r\nNib-Icon=data:image/png;base64,AA\r\n',
}

/** What the open space's index says, by the path as that space speaks it - which
 *  is all the index ever holds. */
const index: { root: string; icons: Record<string, string>; tints: Record<string, string> } = {
  root: '/Work',
  icons: {},
  tints: {},
}
const reads: string[] = []

const relative = (path: string) =>
  path.startsWith(`${index.root}/`) ? path.slice(index.root.length + 1) : path

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  invoke: (command: string, args: { path?: string } = {}) => {
    if (command !== 'read_note') return Promise.resolve(undefined)
    reads.push(String(args.path))
    const held = FILES[String(args.path)]
    return held === undefined ? Promise.reject(new Error('no such note')) : Promise.resolve(held)
  },
}))

vi.mock('./link-index.svelte', () => ({
  links: {
    rootOf: () => index.root,
    iconOf: (path: string) => index.icons[relative(path)] ?? null,
    tintOf: (path: string) => index.tints[relative(path)] ?? null,
    faviconOf: () => null,
    shortcutOf: () => null,
  },
}))

/** The marks open tabs' pages show, by tab. */
const live: Record<string, string> = {}

vi.mock('./web-tab/pages.svelte', () => ({
  pages: { iconOf: (tab: string) => live[tab] ?? null },
  siteMark: (shown: string | null, _url: string | null, written?: string | null) =>
    shown ?? written ?? null,
}))

/** The tabs open in the window. */
const tabs: { kind: string; path: string | null; id: string }[] = []

vi.mock('./workspace.svelte', () => ({
  workspace: {
    spaces: [
      { id: 'w', name: 'Work', root: '/Work' },
      { id: 'h', name: 'Home', root: '/Home' },
    ],
    get activeSpace() {
      return { root: index.root }
    },
    folderIcons: { iconOf: () => null, tintOf: () => null },
    tabs,
  },
}))

const { chosenIcon, chosenTint, faviconFor } = await import('./chosen-icon')
const { elsewhere } = await import('./marks-elsewhere.svelte')
const { NoteDoc, Tab } = await import('./workspace/documents.svelte')

function tabAt(path: string) {
  const doc = new NoteDoc(
    { kind: 'note', path, name: 'Plan.md', text: '', dirty: false },
    () => undefined,
  )
  return new Tab(doc, 'pane')
}

/** The open space, as the index would be built for it. */
function open(root: string) {
  index.root = root
  index.icons = root === '/Work' ? { 'Plan.md': 'rocket' } : { 'Plan.md': 'house' }
  index.tints = root === '/Work' ? { 'Plan.md': 'violet' } : {}
  elsewhere.clear()
}

/** Asked once, read, and asked again: what a mark redrawn by the read lands on. */
async function settled<T>(ask: () => T): Promise<T> {
  ask()
  await vi.waitFor(() => expect(ask()).not.toBeNull())
  return ask()
}

beforeEach(() => {
  reads.length = 0
})

describe('two spaces with a tab each', () => {
  const work = tabAt('/Work/Plan.md')
  const home = tabAt('/Home/Plan.md')

  test('each tab wears its own icon while Work is open', async () => {
    open('/Work')

    expect(chosenIcon(work.path ?? '')).toBe('rocket')
    expect(chosenTint(work.path ?? '')).toBe('violet')
    expect(await settled(() => chosenIcon(home.path ?? ''))).toBe('house')
    // Out of the file, never out of the open space's note of the same name.
    expect(reads).toEqual(['/Home/Plan.md'])
  })

  test('and the same while Home is open', async () => {
    open('/Home')

    expect(chosenIcon(home.path ?? '')).toBe('house')
    expect(await settled(() => chosenIcon(work.path ?? ''))).toBe('rocket')
    expect(chosenTint(work.path ?? '')).toBe('violet')
  })

  test('a file of another space is read once, however often it is asked about', async () => {
    open('/Work')

    await settled(() => chosenIcon(home.path ?? ''))
    chosenIcon(home.path ?? '')
    chosenTint(home.path ?? '')

    expect(reads).toEqual(['/Home/Plan.md'])
  })

  test('a website of another space wears the mark its file wrote down', async () => {
    open('/Work')

    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,AA')
  })

  test('a website open in a tab wears the mark the tab wears now', async () => {
    open('/Work')
    tabs.push({ kind: 'web', path: '/Home/Docs.url', id: 't1' })
    live.t1 = 'data:image/png;base64,BADGE'

    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,BADGE')
    tabs.length = 0
    expect(await settled(() => faviconFor('/Home/Docs.url'))).toBe('data:image/png;base64,AA')
  })

  test('a save in another space is what its mark says next', async () => {
    open('/Work')
    await settled(() => chosenIcon(home.path ?? ''))

    elsewhere.saved('/Home/Plan.md', '---\nicon: tree\n---\n')

    await vi.waitFor(() => expect(chosenIcon(home.path ?? '')).toBe('tree'))
  })
})
