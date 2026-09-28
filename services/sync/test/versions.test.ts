import { beforeEach, afterEach, describe, expect, test } from 'vitest'

import { call, signIn, type TestEnv, testEnv } from './harness'
import {
  deviceIn,
  KEEP_FOR,
  MOST_KEPT,
  MOST_VERSION_BYTES,
  sweepVersions,
  versionKey,
} from '../src/versions'

interface VersionView {
  versions?: { at: number; size: number; by: string }[]
  at?: number
  content?: string
  notes?: number
  paths?: string[]
  more?: boolean
  /** Whether a rollback reached its ceiling, and how many notes are left. */
  partial?: boolean
  left?: number
  error?: string
  note?: { id: string; version: number; path: string }
  space?: { id: string }
}

/** A version is only kept every five minutes, so a test that wants two of them
 *  moves the rows back rather than waiting. */
function agedBy(env: TestEnv, ms: number): void {
  env.db.exec(`update note_versions set at = at - ${ms}`)
}

/** The versions of one note. A fresh space arrives with a note in it already, so
 *  a count of every row in the table counts that one too. */
function rows(env: TestEnv, noteId: string): { at: number; hash: string; by: string }[] {
  return env.db
    .prepare('select at, hash, by from note_versions where note_id = ? order by at')
    .all(noteId) as never
}

describe('the account keeps what a note said', () => {
  let env: TestEnv
  let token: string
  let space: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: '# One' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('from the moment it arrives', async () => {
    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })

    expect(held.status).toBe(200)
    expect(held.json.versions).toHaveLength(1)
    expect(env.keys()).toContain(versionKey(rows(env, note)[0]?.hash ?? ''))
  })

  test('and every push after it, at most one every five minutes', async () => {
    // Too soon: the note itself is the newest state, so a version of it says
    // nothing the file does not.
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Two', baseVersion: 1 },
    })

    expect(rows(env, note)).toHaveLength(1)

    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Three', baseVersion: 2 },
    })

    expect(rows(env, note)).toHaveLength(2)
  })

  test('but not the same words twice', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# One', baseVersion: 1 },
    })

    expect(rows(env, note)).toHaveLength(1)
  })

  test('and one body however many notes say it', async () => {
    await call(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'copy.md', content: '# One' },
    })

    // Both notes say the same five bytes, so both rows name one body.
    const said = env.db.prepare('select hash from note_versions where size = 5').all() as {
      hash: string
    }[]

    expect(said).toHaveLength(2)
    expect(new Set(said.map((one) => one.hash)).size).toBe(1)
    expect(env.keys().filter((key) => key === versionKey(said[0]?.hash ?? ''))).toHaveLength(1)
  })

  test('with the device that sent it, where it said', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Four', baseVersion: 1 },
      headers: { 'x-nib-device': 'the laptop' },
    })

    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })
    expect(held.json.versions?.[0]?.by).toBe('the laptop')
  })

  test('and hands one back when asked for it', async () => {
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# Five', baseVersion: 1 },
    })

    const list = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token })
    const oldest = list.json.versions?.at(-1)?.at ?? 0
    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/${oldest}`, { token })

    expect(said.status).toBe(200)
    expect(said.json.content).toBe('# One')
  })

  test('refuses a moment it has no version at', async () => {
    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/1`, { token })

    expect(said.status).toBe(404)
    expect(said.json.error).toBe('no such version')
  })

  test('and a note somebody else cannot reach', async () => {
    const other = await signIn(env, 'c@d.dev')
    const held = await call<VersionView>(env, `/v1/notes/${note}/versions`, { token: other })

    expect(held.status).toBe(404)
  })

  test('and says so when the body a row names has gone', async () => {
    // A row whose body is missing is a version the account cannot answer, and
    // answering it with no words at all is worse than answering nothing: the
    // history sheet shows an empty note and restoring it writes that emptiness
    // over the words somebody still has.
    const at = rows(env, note)[0]?.at ?? 0
    await env.NOTES.delete(versionKey(rows(env, note)[0]?.hash ?? ''))

    const said = await call<VersionView>(env, `/v1/notes/${note}/versions/${at}`, { token })

    expect(said.status).toBe(404)
    expect(said.json.content).toBeUndefined()
  })

  test('and keeps a bounded number of them per note', async () => {
    // One every five minutes is two hundred and eighty-eight a day, and the
    // thinning that answers for that runs nightly with a write budget of four
    // hundred for the whole service. So a note written in all day outruns the
    // sweep, and the ceiling has to hold where the version is written.
    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )

    // The one the note arrived with goes, so what is seeded below is the whole of
    // its history and the newest of those is old enough for the five minute rule
    // to let the save keep a version at all.
    env.db.exec(`delete from note_versions where note_id = '${note}'`)

    const oldest = Date.now() - (MOST_KEPT + 1) * 5 * 60 * 1000
    for (let at = 0; at < MOST_KEPT; at++) {
      insert.run(note, oldest + at * 5 * 60 * 1000, `seeded-${at}`, 5, '')
    }

    await call(env, `/v1/notes/${note}`, {
      method: 'PUT',
      token,
      body: { content: '# one more', baseVersion: 1 },
    })

    const held = rows(env, note)
    expect(held.length).toBeLessThanOrEqual(MOST_KEPT)
    // What went is the oldest, and what arrived is there.
    expect(held.some((one) => one.hash === 'seeded-0')).toBe(false)
    expect(held.at(-1)?.at).toBeGreaterThan(oldest + (MOST_KEPT - 1) * 5 * 60 * 1000)
  })

  test('and the sweep keeps up with a busy day rather than falling behind it', async () => {
    // Two notes written in all day is more versions a day than the sweep's write
    // budget, so the month thinned to one an hour was a promise the nightly job
    // could not keep: the rows it could not reach stayed, and every night it
    // started the same distance behind.
    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )

    const other = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'other.md', content: 'other' },
    })
    const second = other.json.note?.id ?? ''

    // A day of saves each, two days back, so the thinning is what applies.
    const from = Date.now() - 2 * 24 * 60 * 60 * 1000
    for (const which of [note, second]) {
      for (let at = 0; at < 288; at++) {
        insert.run(which, from + at * 5 * 60 * 1000, `${which}-${at}`, 5, '')
      }
    }

    await sweepVersions(env, Date.now())

    // One an hour is what is left of a day of saves, for both notes. Twenty-five
    // rather than twenty-four because the buckets are whole hours and a day of
    // saves that does not begin on one straddles one more of them.
    for (const which of [note, second]) {
      const held = rows(env, which).filter(
        (one) => one.at >= from && one.at < from + 24 * 60 * 60 * 1000,
      )
      expect(held.length).toBeLessThanOrEqual(25)
    }
  })
})

describe('putting a space back to a moment', () => {
  let env: TestEnv
  let token: string
  let space: string
  let first: string
  let second: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''

    const one = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'Plans/one.md', content: 'the first words' },
    })
    first = one.json.note?.id ?? ''

    const two = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'two.md', content: 'the other words' },
    })
    second = two.json.note?.id ?? ''

    // Both notes have a version from a while ago, and both have moved on since.
    agedBy(env, 6 * 60 * 1000)
    await call(env, `/v1/notes/${first}`, {
      method: 'PUT',
      token,
      body: { content: 'changed since', baseVersion: 1 },
    })
    await call(env, `/v1/notes/${second}`, {
      method: 'PUT',
      token,
      body: { content: 'changed as well', baseVersion: 1 },
    })
  })

  afterEach(() => env.close())

  /** Between the two versions each note has: the older one is what a rollback
   *  puts back, and the newer one is the change being undone. */
  const before = () => Date.now() - 60 * 1000

  test('says what would change before it changes anything', async () => {
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before(), dry: true },
    })

    expect(asked.status).toBe(200)
    expect(asked.json.notes).toBe(2)
    expect(asked.json.paths).toEqual(['Plans/one.md', 'two.md'])

    const still = await call<VersionView>(env, `/v1/notes/${first}`, { token })
    expect(still.json.content).toBe('changed since')
  })

  test('then writes the words back as a new version of each note', async () => {
    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before() },
    })

    expect(done.json.notes).toBe(2)

    const one = await call<VersionView>(env, `/v1/notes/${first}`, { token })
    expect(one.json.content).toBe('the first words')
    expect(one.json.note?.version).toBe(3)

    const two = await call<VersionView>(env, `/v1/notes/${second}`, { token })
    expect(two.json.content).toBe('the other words')
  })

  test('says so when there is more to put back than one request may', async () => {
    // Four hundred and one notes, each with one version that differs from what
    // the note now says - written as rows rather than through the API, because
    // what is being tested is the ceiling and a dry run reads no bodies at all.
    const at = Date.now() - 5 * 60 * 1000
    for (let made = 0; made < 401; made++) {
      const id = `big-${made}`
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
           values (?, ?, ?, ?, 1, ?, 0, 4, 'now')`,
        )
        .run(id, space, `Big/${made}.md`, 100 + made, at)
      env.db
        .prepare(
          "insert into note_versions (note_id, at, hash, size, by) values (?, ?, 'then', 4, '')",
        )
        .run(id, at - 1000)
    }

    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: Date.now(), under: 'Big', dry: true },
    })

    expect(asked.json.notes).toBe(400)
    expect(asked.json.partial).toBe(true)
    expect(asked.json.left).toBe(1)
  })

  test('and nothing of the sort when it fits', async () => {
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before(), dry: true },
    })

    expect(asked.json.partial).toBe(false)
    expect(asked.json.left).toBe(0)
  })

  test('and the version it writes says which device asked', async () => {
    // Far enough back that the five minute rule lets a version be kept at all:
    // a rollback is a write like any other and is kept like any other.
    agedBy(env, 6 * 60 * 1000)

    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: Date.now() - 9 * 60 * 1000 },
      headers: { 'x-nib-device': 'the laptop' },
    })

    expect(done.json.notes).toBe(2)
    expect(rows(env, first).at(-1)?.by).toBe('the laptop')
  })

  test('or only one folder of it', async () => {
    const done = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: before(), under: 'Plans' },
    })

    expect(done.json.notes).toBe(1)

    const outside = await call<VersionView>(env, `/v1/notes/${second}`, { token })
    expect(outside.json.content).toBe('changed as well')
  })

  test('and only that folder, whatever its name has in it', async () => {
    // A folder's name used to be read as a `like` pattern: `_` matched any one
    // character and case was ignored, so these three were all "under" `a_b`.
    const at = Date.now() - 5 * 60 * 1000
    for (const [id, path] of [
      ['wanted', 'a_b/x.md'],
      ['wild', 'aXb/y.md'],
      ['cased', 'A_B/z.md'],
    ] as const) {
      env.db
        .prepare(
          `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash)
           values (?, ?, ?, ?, 1, ?, 0, 4, 'now')`,
        )
        .run(id, space, path, 500, at)
      env.db
        .prepare(
          "insert into note_versions (note_id, at, hash, size, by) values (?, ?, 'then', 4, '')",
        )
        .run(id, at - 1000)
    }

    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token,
      body: { at: Date.now(), under: 'a_b', dry: true },
    })

    expect(asked.json.paths).toEqual(['a_b/x.md'])
  })

  test('refuses a moment nobody named', async () => {
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, { token, body: {} })

    expect(asked.status).toBe(400)
    expect(asked.json.error).toBe('when to go back to')
  })

  test('and somebody who may only read the space', async () => {
    const other = await signIn(env, 'c@d.dev')
    const asked = await call<VersionView>(env, `/v1/spaces/${space}/rollback`, {
      token: other,
      body: { at: Date.now() },
    })

    expect(asked.status).toBe(404)
  })
})

describe('the sweep', () => {
  let env: TestEnv
  let token: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const space = made.json.space?.id ?? ''
    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: 'first' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('takes a version older than the month, and its body with it', async () => {
    agedBy(env, KEEP_FOR + 1000)

    const held = rows(env, note)[0]?.hash ?? ''
    expect(env.keys()).toContain(versionKey(held))

    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(0)
    expect(env.keys()).not.toContain(versionKey(held))
  })

  test('keeps a version inside the month', async () => {
    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(1)
  })

  test('leaves a body another note still says', async () => {
    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Other' } })
    await call(env, `/v1/spaces/${made.json.space?.id ?? ''}/notes`, {
      token,
      body: { path: 'same.md', content: 'first' },
    })

    const held = rows(env, note)[0]?.hash ?? ''
    env.db.exec(`delete from note_versions where note_id = '${note}'`)
    await sweepVersions(env, Date.now())

    expect(env.keys()).toContain(versionKey(held))
  })
})

describe('thinning to one an hour', () => {
  let env: TestEnv
  let token: string
  let space: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    space = made.json.space?.id ?? ''
  })

  afterEach(() => env.close())

  /** A note, and rows for it at the moments given, so the sweep has something to
   *  thin without a note having to be written in for a day first. */
  async function noteWithVersionsAt(path: string, moments: readonly number[]): Promise<string> {
    const made = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path, content: path },
    })
    const noteId = made.json.note?.id ?? ''

    env.db.exec(`delete from note_versions where note_id = '${noteId}'`)

    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )
    for (const at of moments) insert.run(noteId, at, `h-${noteId}-${at}`, 5, '')

    return noteId
  }

  function kept(noteId: string): number[] {
    return (
      env.db.prepare('select at from note_versions where note_id = ? order by at').all(noteId) as {
        at: number
      }[]
    ).map((one) => one.at)
  }

  test('keeps the newest in each hour and takes the rest', async () => {
    const hour = 60 * 60 * 1000
    // Two days back, and on an hour, so which bucket a moment falls in is the
    // arithmetic the sweep does and not the hour the test happens to run at.
    const from = Math.floor((Date.now() - 2 * 24 * hour) / hour) * hour

    const one = await noteWithVersionsAt('one.md', [from + 300, from + 600, from - hour + 100])
    const two = await noteWithVersionsAt('two.md', [from + 500])

    await sweepVersions(env, Date.now())

    expect(kept(one)).toEqual([from - hour + 100, from + 600])
    expect(kept(two)).toEqual([from + 500])
  })

  test('and nothing where every version is already an hour apart', async () => {
    const hour = 60 * 60 * 1000
    const from = Math.floor((Date.now() - 3 * 24 * hour) / hour) * hour
    const moments = [1, 2, 3].map((at) => from + at * hour)

    const note = await noteWithVersionsAt('spread.md', moments)
    await sweepVersions(env, Date.now())

    expect(kept(note)).toEqual(moments)
  })

  test('and leaves the first day of them exactly as it happened', async () => {
    const moments = [1, 2, 3].map((at) => Date.now() - at * 60 * 1000)

    const note = await noteWithVersionsAt('today.md', moments)
    await sweepVersions(env, Date.now())

    expect(kept(note)).toHaveLength(3)
  })

  /** The shelves: an hour for the first month, a day for the next two, a week
   *  after that. What a backup has done since 2007, and for the same reason -
   *  what somebody wants from last spring is *a* version. */
  test('thins to one a day past a month and one a week past three', async () => {
    const hour = 60 * 60 * 1000
    const day = 24 * hour
    const week = 7 * day

    // A year kept, or everything past the month would simply be deleted.
    env.db.exec(`update users set settings = '{"keepVersions":365}'`)

    const now = Date.now()
    // Two moments inside one day, two months back: one survives.
    const old = Math.floor((now - 60 * day) / day) * day
    // Two inside one week, six months back: one survives.
    const older = Math.floor((now - 180 * day) / week) * week

    const note = await noteWithVersionsAt('long.md', [
      old + hour,
      old + 3 * hour,
      older + day,
      older + 3 * day,
    ])

    await sweepVersions(env, now)

    expect(kept(note)).toEqual([older + 3 * day, old + 3 * hour])
  })
})

describe('how long an account keeps its history', () => {
  let env: TestEnv
  let token: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const space = made.json.space?.id ?? ''
    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: 'first' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  test('is a month for an account that has never said', async () => {
    agedBy(env, KEEP_FOR + 1000)
    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(0)
  })

  test('and a year for one that asked for a year', async () => {
    // The same version, the same age, and the only difference is the word on the
    // account: this is the whole of what the setting does.
    env.db.exec(`update users set settings = '{"keepVersions":365}'`)
    agedBy(env, KEEP_FOR + 1000)

    await sweepVersions(env, Date.now())
    expect(rows(env, note)).toHaveLength(1)
  })

  test('and a year is still not for ever', async () => {
    env.db.exec(`update users set settings = '{"keepVersions":365}'`)
    agedBy(env, 400 * 24 * 60 * 60 * 1000)

    await sweepVersions(env, Date.now())
    expect(rows(env, note)).toHaveLength(0)
  })

  test('a setting nobody offered is not a horizon', async () => {
    // The route refuses it, which is what keeps the sweep's arithmetic to the two
    // numbers the app knows; see settings.ts.
    const refused = await call(env, '/v1/settings', {
      method: 'PATCH',
      token,
      body: { keepVersions: 3650 },
    })

    expect(refused.status).toBe(400)
  })

  test('and the two it offers go through', async () => {
    for (const days of [30, 365]) {
      const set = await call(env, '/v1/settings', {
        method: 'PATCH',
        token,
        body: { keepVersions: days },
      })

      expect(set.status).toBe(200)
    }
  })
})

/** The ceiling. Version bytes are not counted against the account's own
 *  gigabyte, so this is the only thing between a year of history and a bill. */
describe('more history than an account may hold', () => {
  let env: TestEnv
  let token: string
  let note: string

  beforeEach(async () => {
    env = testEnv()
    token = await signIn(env, 'a@b.dev')

    const made = await call<VersionView>(env, '/v1/spaces', { token, body: { name: 'Work' } })
    const space = made.json.space?.id ?? ''
    const wrote = await call<VersionView>(env, `/v1/spaces/${space}/notes`, {
      token,
      body: { path: 'plan.md', content: 'first' },
    })
    note = wrote.json.note?.id ?? ''
  })

  afterEach(() => env.close())

  /** Rows of a size, inside the month so nothing else would take them. */
  function heavy(bytes: number, count: number) {
    env.db.exec(`delete from note_versions where note_id = '${note}'`)

    const insert = env.db.prepare(
      'insert into note_versions (note_id, at, hash, size, by) values (?, ?, ?, ?, ?)',
    )
    const now = Date.now()
    for (let one = 0; one < count; one++) {
      insert.run(note, now - one * 60 * 1000, `big-${one}`, bytes, '')
    }
  }

  function held(): number {
    const found = env.db
      .prepare('select count(*) as rows, sum(size) as bytes from note_versions')
      .get() as { rows: number; bytes: number | null }

    return found.bytes ?? 0
  }

  test('loses its oldest until it is under the ceiling', async () => {
    // Three of them, one and a half gigabytes each: four and a half against a
    // ceiling of two.
    heavy(1536 * 1024 * 1024, 3)
    expect(held()).toBeGreaterThan(MOST_VERSION_BYTES)

    await sweepVersions(env, Date.now())

    expect(held()).toBeLessThanOrEqual(MOST_VERSION_BYTES)
    // And what is left of this note is the newest of them: enough went, and the
    // oldest went first.
    const left = rows(env, note)
    expect(left).toHaveLength(1)
    expect(left[0]?.hash).toBe('big-0')
  })

  test('and an account under it loses nothing', async () => {
    heavy(1024, 3)
    await sweepVersions(env, Date.now())

    expect(rows(env, note)).toHaveLength(3)
  })
})

describe('the name a device sends for itself', () => {
  test('is words, bounded, and not layout', () => {
    expect(deviceIn('the laptop')).toBe('the laptop')
    expect(deviceIn(undefined)).toBe('')
    // A newline was already taken out; the rest of the control characters are
    // what somebody sends to make a name in the Account pane read as two.
    expect(deviceIn('one\r\ntwo')).toBe('one two')
    expect(deviceIn('a\u0000b\u001bc')).toBe('abc')
    expect(deviceIn('x'.repeat(80))).toHaveLength(40)
  })

  test('and is never cut through the middle of a character', () => {
    // Forty whole ones, which is eighty units: a bound counted in units kept forty
    // units and left half of the twentieth behind.
    expect(deviceIn('🙂'.repeat(60))).toBe('🙂'.repeat(40))

    // And a character a code point would have broken too: one family is seven
    // code points joined, and half a family is three strangers.
    const family = '👨‍👩‍👧'
    expect(deviceIn(family.repeat(20))).toBe(family.repeat(20))
    expect(deviceIn(family.repeat(60))).toBe(family.repeat(40))
  })
})
