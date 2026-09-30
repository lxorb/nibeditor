import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The space chooser's Create row, and the welcome note it puts in the first space.
 *
 *  Obsidian opens a new vault on a note of its own. nib does the same with the note
 *  the browser build has always given a first visit - once per device, by the same
 *  rule: a reader who has been introduced is not introduced again with their next
 *  space, and an untouched welcome never travels to an account. See welcome.ts. */

const notes = new Map<string, string>()
const made: { name: string; path: string }[] = []

const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('./tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    const path = text(args?.path)
    switch (command) {
      case 'create_space': {
        const space = { name: text(args?.name), path: `/spaces/${text(args?.name)}` }
        made.push(space)
        return space
      }
      case 'list_spaces':
        return made
      case 'read_tree': {
        const root = made.at(-1)?.path ?? '/spaces'
        const children = [...notes.keys()]
          .filter((one) => one.startsWith(`${root}/`))
          .map((one) => ({
            name: one.slice(root.length + 1),
            path: one,
            is_dir: false,
            modified: 0,
            created: 0,
            children: [],
          }))
        return { name: 'space', path: root, is_dir: true, modified: 0, created: 0, children }
      }
      case 'read_note':
        return notes.get(path) ?? ''
      case 'write_note':
        notes.set(path, text(args?.content))
        return undefined
      default:
        return undefined
    }
  },
}))

/** The name question, answered from here. */
const asked = { name: 'Journal' as string | null }

vi.mock('./prompt.svelte', () => ({
  prompt: { ask: () => Promise.resolve(asked.name) },
}))

// A pass is nudged once a space is made; nothing here is about syncing.
vi.mock('./sync.svelte', () => ({ sync: { nudge: () => undefined } }))

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

const { workspace } = await import('./workspace.svelte')
const { firstSpace, folderNamed, inside } = await import('./first-space.svelte')
const { WELCOME, WELCOME_NAME, isUntouchedWelcome } = await import('./welcome')

beforeEach(() => {
  notes.clear()
  made.length = 0
  asked.name = 'Journal'
  localStorage.clear()
  workspace.spaces = []
  workspace.activeSpaceId = null
  workspace.tree = null
  workspace.tabs = []
})

describe('creating the first space', () => {
  test('writes the welcome note into it and opens it', async () => {
    await firstSpace.create()

    expect(workspace.spaces.map((one) => one.name)).toEqual(['Journal'])
    expect(notes.get(`/spaces/Journal/${WELCOME_NAME}`)).toBe(WELCOME)
    expect(workspace.active?.path).toBe(`/spaces/Journal/${WELCOME_NAME}`)
  })

  test('once per device: the next space gets none', async () => {
    await firstSpace.create()
    workspace.tabs = []
    asked.name = 'Work'

    await firstSpace.create()

    expect(notes.has(`/spaces/Work/${WELCOME_NAME}`)).toBe(false)
  })

  test('and none on a device that was introduced before', async () => {
    localStorage.setItem('nib:seeded', 'yes')

    await firstSpace.create()

    expect(workspace.spaces).toHaveLength(1)
    expect(notes.size).toBe(0)
  })

  test('makes nothing when the name is not given', async () => {
    asked.name = null

    await firstSpace.create()

    expect(made).toEqual([])
    expect(localStorage.getItem('nib:seeded')).toBeNull()
  })
})

describe('the welcome note, untouched', () => {
  test('is not writing, so it never travels', () => {
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, WELCOME)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, `${WELCOME}mine\n`)).toBe(false)
  })

  /** A browser seeded before the words stopped saying "browser" still has the old
   *  ones, and they are no more the reader's writing now than they were then. */
  test('nor is the one an earlier version wrote', () => {
    const earlier = [
      '# Welcome to Nib',
      '',
      'This is the browser version. Your notes live in this browser until you sign in',
      'and turn on syncing, and then they follow you everywhere.',
      '',
      '- Everything is markdown, and nothing else',
      '- **Bold**, *italic*, ==highlight==, `code`',
      '- $E = mc^2$ renders as you type',
      '',
      '```js',
      "const hello = 'world'",
      '```',
      '',
      '| What | Where |',
      '| ---- | ----- |',
      '| Notes | this browser |',
      '| Synced notes | your account |',
      '',
    ].join('\n')

    expect(isUntouchedWelcome(`/Notes/${WELCOME_NAME}`, earlier)).toBe(true)
  })

  /** Every device seeded before the app was called nibeditor holds these words,
   *  and they are still the app's, not the reader's. */
  test('nor the one written under the old name', () => {
    const earlier = [
      '# Welcome to Nib',
      '',
      'Your notes live on this device until you sign in',
      'and turn on syncing, and then they follow you everywhere.',
      '',
      '- Everything is markdown, and nothing else',
      '- **Bold**, *italic*, ==highlight==, `code`',
      '- $E = mc^2$ renders as you type',
      '',
      '```js',
      "const hello = 'world'",
      '```',
      '',
      '| What | Where |',
      '| ---- | ----- |',
      '| Notes | this device |',
      '| Synced notes | your account |',
      '',
    ].join('\n')

    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, earlier)).toBe(true)
    expect(isUntouchedWelcome(`/spaces/Journal/${WELCOME_NAME}`, `${earlier}mine\n`)).toBe(false)
  })

  test('says nothing about which build it is in', () => {
    expect(WELCOME).not.toMatch(/browser/i)
  })

  test('says the name the app goes by', () => {
    expect(WELCOME.split('\n')[0]).toBe('# Welcome to nibeditor')
  })
})

describe('a folder brought in as a space', () => {
  const picked = (path: string) => ({
    name: path.split('/').at(-1) ?? path,
    webkitRelativePath: path,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  })

  test('is named after the folder', () => {
    expect(folderNamed([picked('Vault/Plan.md'), picked('Vault/a/b.md')])).toBe('Vault')
    expect(folderNamed([])).toBeNull()
  })

  test('holds what was inside it rather than a folder of the same name', () => {
    expect(
      inside([picked('Vault/Plan.md'), picked('Vault/a/b.md')]).map(
        (one) => one.webkitRelativePath,
      ),
    ).toEqual(['Plan.md', 'a/b.md'])
  })
})
