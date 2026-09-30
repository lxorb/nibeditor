import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { flushSync } from 'svelte'

/** A note keeps its room while its space is renamed, and while it is renamed itself.
 *
 *  A space rename keeps every id: the same files in a folder with another name. What
 *  decides which room an open note is in is the app's own effect over the open notes,
 *  which asks the sync store what the account calls each of them by path (see
 *  App.svelte). The rename used to be two halves a round trip apart - the workspace
 *  moved the notes' paths, and the mirror was re-keyed onto the new folder afterwards -
 *  and an effect that ran in between asked about a path nothing answered to, so the
 *  note left its room and joined it again a moment later. space-rename.py met it as
 *  `rooms.carries` answering no straight after the rename (hunt-7, 8a6ef426).
 *
 *  A note renamed had the same moment, longer: the account's table is re-keyed only
 *  once the account has taken the new name (see `movedHere` in sync/pass.ts), and
 *  until it had, the note at its new name had no id and so no room.
 *
 *  In the effects project because the fault is an effect running at the wrong moment. */

/** The account's answer to a rename, held until the test lets it go. */
const answer = vi.hoisted(() => {
  let release: () => void = () => undefined
  const given = new Promise<void>((done) => {
    release = done
  })
  return { held: () => given, release: () => release() }
})

vi.mock('../../src/lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/lib/api')>()
  return {
    ...real,
    api: {
      ...real.api,
      writeNote: async (_token: string, id: string, path: string) => {
        await answer.held()
        return { note: { id, path, version: 2, hash: 'h2' } }
      },
    },
  }
})

const OLD = '/Notes'
const NEW = '/Renamed'
const NOTE = 'together.md'

vi.mock('../../src/lib/tauri', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/tauri')>()),
  isDesktop: true,
  isNative: true,
  invoke: async (command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case 'read_note':
        return '# Together\n'
      case 'rename_space':
        return { name: 'Renamed', path: NEW }
      case 'read_tree':
        return {
          name: '',
          path: args?.root,
          is_dir: true,
          modified: 0,
          created: 0,
          children: [],
        }
      default:
        return undefined
    }
  },
}))

const { account } = await import('../../src/lib/account.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { sync } = await import('../../src/lib/sync.svelte')
const { commitSpaceName } = await import('../../src/lib/space-actions')
const { root, watch } = await import('./runes.svelte')

let stop: (() => void) | undefined

beforeAll(async () => {
  workspace.spaces = [{ id: 'notes', name: 'Notes', root: OLD }]
  workspace.activeSpaceId = 'notes'
  await workspace.open(`${OLD}/${NOTE}`)

  localStorage.setItem(
    'nib:mirrors',
    JSON.stringify({
      account: null,
      seen: true,
      mirrors: {
        [OLD]: {
          spaceId: 'space-1',
          cursor: 1,
          notes: { [NOTE]: { id: 'note-1', version: 1, hash: 'h' } },
          files: {},
          offered: {},
        },
      },
    }),
  )
  sync.reread()
})

afterEach(() => stop?.())

test('the note is the account’s note at every moment of a space rename', async () => {
  const answered: (string | null)[] = []
  stop = root(() => {
    watch(() => {
      for (const one of workspace.openNotes) answered.push(sync.tracked(one.path)?.id ?? null)
    })
  })
  flushSync()
  expect(answered).toEqual(['note-1'])

  const space = workspace.spaces[0]
  if (!space) throw new Error('the space')
  await commitSpaceName(space, 'Renamed')
  flushSync()

  expect(workspace.documents[0]?.path).toBe(`${NEW}/${NOTE}`)
  expect(answered).not.toContain(null)
  expect(answered.at(-1)).toBe('note-1')
})

test('and at every moment of its own rename, while the account is being told', async () => {
  account.token = 'a session'
  const answered: (string | null)[] = []
  stop = root(() => {
    watch(() => {
      for (const one of workspace.openNotes) answered.push(sync.tracked(one.path)?.id ?? null)
    })
  })
  flushSync()

  const renaming = workspace.rename(`${NEW}/${NOTE}`, 'apart.md')
  await vi.waitFor(() => expect(workspace.documents[0]?.path).toBe(`${NEW}/apart.md`))
  flushSync()
  expect(answered).not.toContain(null)

  answer.release()
  await renaming
  flushSync()

  expect(answered).not.toContain(null)
  expect(sync.tracked(`${NEW}/apart.md`)?.version).toBe(2)
})
