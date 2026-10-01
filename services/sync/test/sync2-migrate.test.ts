/** A device moving from sync v1 to v2, against this Worker (docs/sync-v2.md section 11,
 *  step 2): one test per row of the table, each asserting that no word is lost and no
 *  file appears that nobody made, and the way back to v1 meeting every note agreeing.
 *
 *  The device is the app's own engine (apps/desktop/src/lib/sync2, through
 *  `test-device.ts`), reached by its path for the reason sync2-engine.test.ts gives; v1's
 *  state is the mirror v1 would have written: each note's id, version and the hash of
 *  the words it last agreed on. */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sha256 } from '../src/crypto'
import { keepVersionNow } from '../src/versions'
import app from '../src/index'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

/** What these tests use of the engine, as it is shaped there. */
interface Tracked {
  id: string
  version: number
  hash: string
}

interface V1Space {
  cursor: number
  notes: Record<string, Tracked>
}

interface Entry {
  id: string
  local_path: string
}

interface SpaceState {
  id: string
  entries: Map<string, Entry>
}

interface Core {
  spaces: Map<string, SpaceState>
  held: Map<string, unknown>
  addSpace(id: string, root: string, role: string): unknown[]
  commit(changes: unknown[]): Promise<void>
}

interface Device {
  root: string
  disk: { files: Map<string, string>; read(path: string): Promise<string | null> }
  engine: { core: Core; pass(space: string): Promise<{ finished: boolean } | null> }
  asked: string[]
}

interface Engine {
  testDevice(making: {
    fetch: (request: Request) => Promise<Response>
    token: string
    files?: Record<string, string>
  }): Promise<Device>
  firstPass(core: Core, space: SpaceState, v1: V1Space | null): Promise<boolean>
  mirrorsFrom(core: Core): Promise<Record<string, { notes: Record<string, Tracked> }>>
}

async function engine(): Promise<Engine> {
  const at = (file: string) =>
    new URL(`../../../apps/desktop/src/lib/sync2/${file}`, import.meta.url).href
  const [device, migrate] = await Promise.all([
    import(/* @vite-ignore */ at('test-device.ts')),
    import(/* @vite-ignore */ at('migrate.ts')),
  ])
  return { ...(device as object), ...(migrate as object) } as Engine
}

let env: TestEnv
let rooms: Live
let token: string
let space: string

beforeEach(async () => {
  env = testEnv()
  rooms = live(env)
  token = await signIn(env, 'mover@example.com')
  other = await signIn(env, 'mover@example.com')
  space = (await call(env, '/v1/spaces', { token, body: { name: 'Moving' } })).json.space.id
})

afterEach(() => env.close())

/** A note written the way a v1 app writes one; answers its id and version. */
async function v1Note(path: string, content: string): Promise<{ id: string; version: number }> {
  const made = await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  expect(made.status).toBe(201)
  return { id: made.json.note.id, version: made.json.note.version }
}

/** Another device of the account, writing the way a v1 app writes. */
let other: string

async function v1Write(id: string, path: string, content: string, baseVersion: number) {
  const written = await call(env, `/v1/notes/${id}`, {
    token: other,
    method: 'PUT',
    body: { path, content, baseVersion },
  })
  expect(written.status).toBe(200)
}

async function textOnAccount(id: string): Promise<string> {
  return (await call(env, `/v1/notes/${id}`, { token })).json.content
}

async function liveNames(): Promise<string[]> {
  const rows = env.db
    .prepare('select path from notes where space_id = ? and deleted = 0 order by path')
    .all(space) as { path: string }[]
  return rows.map((row) => row.path)
}

/** Where v1's last pass left this device's cursor: what a mirror written now says. */
async function v1Cursor(): Promise<number> {
  return (await call(env, `/v1/spaces/${space}/changes?since=0`, { token })).json.cursor
}

/** The device, its first v2 pass with the mirror given, and one pass after it. `cursor`
 *  is where v1's last pass left it: the mirror's cursor. */
async function migrated(
  files: Record<string, string>,
  notes: Record<string, Tracked>,
  cursor = 0,
) {
  const kit = await engine()
  const device = await kit.testDevice({
    fetch: (request) => app.fetch(request, env),
    token,
    files,
  })
  const core = device.engine.core
  await core.commit(core.addSpace(space, device.root, 'owner'))
  const state = core.spaces.get(space)
  if (!state) throw new Error('the space was not added')

  const first = await kit.firstPass(core, state, { cursor, notes })
  expect(first).toBe(true)
  const asked = [...device.asked]
  await rooms.settle()
  const passed = await device.engine.pass(space)
  expect(passed?.finished).toBe(true)
  await rooms.settle()
  return { kit, device, asked, file: (path: string) => device.disk.files.get(`${device.root}/${path}`) }
}

describe('a device moving to v2', () => {
  test('a note v1 left as the account has it is seeded here, nothing downloaded', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const { asked, file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(asked.some((one) => one.endsWith('/v2/docs/pull'))).toBe(false)
    expect(file('Plan.md')).toBe('We ship on Monday.\n')
    expect(await textOnAccount(note.id)).toBe('We ship on Monday.\n')
  })

  test('a note v1 left behind the account takes the account’s words', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    await v1Write(note.id, 'Plan.md', 'We ship on Tuesday, after the review.\n', note.version)
    const { file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(file('Plan.md')).toBe('We ship on Tuesday, after the review.\n')
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('words written under v1 that never went up go up, and nothing is copied', async () => {
    const note = await v1Note('Plan.md', 'We ship on Monday.\n')
    const { file } = await migrated(
      { 'Plan.md': 'We ship on Monday.\n\n- written offline under v1\n' },
      { 'Plan.md': { ...note, hash: await sha256('We ship on Monday.\n') } },
    )

    expect(await textOnAccount(note.id)).toBe('We ship on Monday.\n\n- written offline under v1\n')
    expect(file('Plan.md')).toBe('We ship on Monday.\n\n- written offline under v1\n')
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('both moved: merged against the version v1 last agreed on', async () => {
    const note = await v1Note('Plan.md', 'First line.\n\nSecond line.\n')
    // The version the account kept of it: one every five minutes, and this one is old.
    await keepVersionNow(env, note.id, 'First line.\n\nSecond line.\n', 'one')
    await v1Write(note.id, 'Plan.md', 'First line, edited elsewhere.\n\nSecond line.\n', note.version)
    const { file } = await migrated(
      { 'Plan.md': 'First line.\n\nSecond line, edited here.\n' },
      { 'Plan.md': { ...note, hash: await sha256('First line.\n\nSecond line.\n') } },
    )

    const merged = 'First line, edited elsewhere.\n\nSecond line, edited here.\n'
    expect(await textOnAccount(note.id)).toBe(merged)
    expect(file('Plan.md')).toBe(merged)
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('both moved with no ancestor to be had: the text holding the other whole wins', async () => {
    const note = await v1Note('Plan.md', 'One.\n')
    await v1Write(note.id, 'Plan.md', 'One.\nTwo.\n', note.version)
    const { file } = await migrated(
      { 'Plan.md': 'One.\nTwo.\nThree.\n' },
      { 'Plan.md': { ...note, hash: 'a hash no version has' } },
    )

    expect(await textOnAccount(note.id)).toBe('One.\nTwo.\nThree.\n')
    expect(file('Plan.md')).toBe('One.\nTwo.\nThree.\n')
  })

  test('both rewrote it with no ancestor: held for the question, nothing written over', async () => {
    const note = await v1Note('Plan.md', 'The release goes out on Monday morning.\n')
    await v1Write(
      note.id,
      'Plan.md',
      'The release waits until every reviewer has signed off on it.\n',
      note.version,
    )
    const { device, file } = await migrated(
      { 'Plan.md': 'We hold the release until Friday, whatever the review says.\n' },
      { 'Plan.md': { ...note, hash: 'a hash no version has' } },
    )

    expect(device.engine.core.held.has(note.id)).toBe(true)
    expect(file('Plan.md')).toBe('We hold the release until Friday, whatever the review says.\n')
    expect(await textOnAccount(note.id)).toBe(
      'The release waits until every reviewer has signed off on it.\n',
    )
    expect(await liveNames()).toEqual(['Plan.md'])
  })

  test('a file the account has never seen is made there', async () => {
    const note = await v1Note('Plan.md', 'Plan.\n')
    const { file } = await migrated(
      { 'Plan.md': 'Plan.\n', 'Ideas/New.md': 'A new idea.\n' },
      { 'Plan.md': { ...note, hash: await sha256('Plan.\n') } },
    )

    expect(await liveNames()).toEqual(['Ideas/New.md', 'Plan.md'])
    expect(file('Ideas/New.md')).toBe('A new idea.\n')
  })

  test('a note v1 tracked whose file is gone is deleted, unless written in elsewhere', async () => {
    const gone = await v1Note('Gone.md', 'Delete me.\n')
    const kept = await v1Note('Kept.md', 'Keep me.\n')
    const seen = await v1Cursor()
    // Written in by another device after this one's last v1 pass.
    await v1Write(kept.id, 'Kept.md', 'Keep me, I was written in.\n', kept.version)
    const { file } = await migrated(
      {},
      {
        'Gone.md': { ...gone, hash: await sha256('Delete me.\n') },
        'Kept.md': { ...kept, hash: await sha256('Keep me.\n') },
      },
      seen,
    )

    expect(await liveNames()).toEqual(['Kept.md'])
    expect(file('Kept.md')).toBe('Keep me, I was written in.\n')
  })
})

describe('the way back to v1', () => {
  test('the mirrors name every note by the hash the account holds for it', async () => {
    const one = await v1Note('Plan.md', 'Plan.\n')
    const two = await v1Note('Notes/Ideas.md', 'Ideas.\n')
    const { kit, device } = await migrated(
      { 'Plan.md': 'Plan.\n\nWritten under v2.\n', 'Notes/Ideas.md': 'Ideas.\n' },
      {
        'Plan.md': { ...one, hash: await sha256('Plan.\n') },
        'Notes/Ideas.md': { ...two, hash: await sha256('Ideas.\n') },
      },
    )

    const mirrors = await kit.mirrorsFrom(device.engine.core)
    const notes = mirrors[device.root]?.notes ?? {}
    for (const [path, tracked] of Object.entries(notes)) {
      const row = env.db.prepare('select hash from notes where id = ?').get(tracked.id) as {
        hash: string
      }
      // v1 reads a file that says what the account holds as a note it knows: no copy.
      expect(tracked.hash, path).toBe(row.hash)
      expect(await sha256(device.disk.files.get(`${device.root}/${path}`) ?? '')).toBe(row.hash)
    }
    expect(Object.keys(notes).sort()).toEqual(['Notes/Ideas.md', 'Plan.md'])
  })
})
