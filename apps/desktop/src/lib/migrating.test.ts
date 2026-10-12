import { beforeEach, describe, expect, test, vi } from 'vitest'

import { sourceOf, type Source } from './import/sources'

interface Entry {
  path: string
  name: string
  is_dir: boolean
  children: Entry[]
}

const wrote = new Set<string>()
const opened: string[] = []
const ROOT = '/spaces/Brain'

/** What the disk tree lists after the import: folders first, by name, and only the
 *  files a tab can hold, as tree.rs does. */
function treeOf(paths: Iterable<string>): Entry {
  const root: Entry = { path: ROOT, name: 'Brain', is_dir: true, children: [] }
  for (const full of paths) {
    const rel = full.slice(ROOT.length + 1)
    if (rel.split('/').some((part) => part.startsWith('.'))) continue
    if (!/\.(md|pdf|canvas|base)$/i.test(rel)) continue
    let at = root
    const parts = rel.split('/')
    parts.forEach((part, i) => {
      let child = at.children.find((one) => one.name === part)
      if (!child) {
        child = {
          path: `${at.path}/${part}`,
          name: part,
          is_dir: i < parts.length - 1,
          children: [],
        }
        at.children.push(child)
      }
      at = child
    })
  }
  const sort = (entry: Entry) => {
    entry.children.sort((a, b) =>
      a.is_dir !== b.is_dir ? (a.is_dir ? -1 : 1) : a.name.localeCompare(b.name),
    )
    entry.children.forEach(sort)
  }
  sort(root)
  return root
}

const ws = {
  tree: null as Entry | null,
  activeSpaceId: 'old',
  added: 0,
  /** Whether the disk refuses to make the space, as a read-only one does. */
  refusing: false,
  get files() {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (child.is_dir) walk(child)
        else out.push(child)
      }
    }
    if (this.tree) walk(this.tree)
    return out
  },
  get notes() {
    return this.files.filter((one) => !/\.(pdf|canvas|base)$/i.test(one.name))
  },
  undone: { record: () => undefined },
  addSpace: async (name: string) => {
    if (ws.refusing) return undefined
    ws.added += 1
    return { id: 'new', name, root: ROOT }
  },
  loadTree: async () => {
    ws.tree = treeOf(wrote)
  },
  showSpace: async (id: string) => {
    ws.activeSpaceId = id
  },
  openEntry: async (path: string) => void opened.push(path),
  showPanel: () => undefined,
}

vi.mock('./tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    if (command === 'write_note' || command === 'write_bytes') wrote.add(String(args.path))
    return Promise.resolve()
  },
  joinPath: (dir: string, relative: string) => `${dir}/${relative}`,
  isNative: false,
  isDesktop: true,
}))
vi.mock('./workspace.svelte', () => ({ workspace: ws }))
vi.mock('./link-index.svelte', () => ({
  links: { noteSaved: () => undefined, cameBack: async () => undefined },
}))
vi.mock('./sync.svelte', () => ({ sync: { nudge: () => undefined } }))
vi.mock('./viewport.svelte', () => ({ viewport: { drawer: false } }))
vi.mock('./settings.svelte', () => ({ settings: { open: true } }))
vi.mock('./first-visit.svelte', () => ({
  firstVisit: { asking: false, answered: () => undefined },
}))
vi.mock('./carry-over', () => ({ carryOver: async () => undefined }))

const { importAsSpace, arrive } = await import('./migrating.svelte')

function file(path: string, body: string | Uint8Array = 'x'): Source {
  return sourceOf(path, typeof body === 'string' ? new TextEncoder().encode(body) : body)
}

beforeEach(() => {
  wrote.clear()
  opened.length = 0
  ws.tree = null
  ws.activeSpaceId = 'old'
  ws.added = 0
  ws.refusing = false
})

describe('a vault brought in as a space', () => {
  test('opens on its first note, not a PDF or canvas in a folder that sorts first', async () => {
    const space = await importAsSpace('Brain', [
      file('.obsidian/app.json', '{}'),
      file('Attachments/Paper.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])),
      file('Boards/Map.canvas', '{"nodes":[],"edges":[]}'),
      file('Welcome.md', '# Welcome\n\nStart here.'),
    ])
    await arrive(space)

    expect(opened).toEqual([`${ROOT}/Welcome.md`])
  })

  test('holding nothing but Obsidian housekeeping makes no empty space', async () => {
    await expect(
      importAsSpace('Brain', [
        file('.obsidian/app.json', '{}'),
        file('.obsidian/workspace.json', '{}'),
        file('.trash/Old.md', 'gone'),
      ]),
    ).rejects.toThrow('Nothing in there can be read as notes.')
    expect(ws.added).toBe(0)
  })

  test('says it was not written when its space cannot be made', async () => {
    ws.refusing = true
    await expect(
      importAsSpace('Brain', [file('.obsidian/app.json', '{}'), file('Home.md', '# Home')]),
    ).rejects.toThrow('That import could not be written.')
    expect(wrote.size).toBe(0)
  })
})
