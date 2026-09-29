/** What deleting an account empties, held to the schema.
 *
 *  Two questions, and the second is the one that matters. Does the list of tables
 *  in erase.ts name every table the migrations make - so that a table added next
 *  month with a `user_id` in it fails here until somebody decides what deleting an
 *  account does to it? And, with a row of every kind written for two accounts
 *  side by side, does deleting one leave no row anywhere that names it, and every
 *  row of the other exactly where it was? */

import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { ERASED, eraseAccount } from '../src/erase'
import { type TestEnv, testEnv } from './harness'

/** The tables that hold nothing of any one account, and why. Everything else the
 *  schema has must be in `ERASED`. */
const HOLDS_NOTHING: Record<string, string> = {
  oauth_clients: 'a client registered itself; its row names a program, never a person',
  leftovers: 'what is still to go, written by the deletion itself and emptied after it',
}

/** The columns that say whose a row is or what it is inside. A table with one of
 *  these cannot be waved through as holding nothing. */
const WHOSE = ['user_id', 'email', 'space_id', 'note_id', 'guest_id', 'who']

function tables(database: DatabaseSync): string[] {
  const rows = database
    .prepare("select name, sql from sqlite_master where type = 'table'")
    .all() as { name: string; sql: string }[]

  // A full-text table keeps its index in shadow tables of its own, named after
  // it; they are the index's business and go when its rows do.
  const virtual = rows
    .filter((one) => /^create virtual table/i.test(one.sql))
    .map((one) => one.name)

  return rows
    .map((one) => one.name)
    .filter((name) => !name.startsWith('sqlite_'))
    .filter((name) => !virtual.some((one) => name.startsWith(`${one}_`)))
    .sort()
}

function columns(database: DatabaseSync, table: string): string[] {
  return (
    database.prepare(`select name from pragma_table_info(?)`).all(table) as { name: string }[]
  ).map((one) => one.name)
}

describe('the list of what is erased', () => {
  let env: TestEnv

  beforeEach(() => {
    env = testEnv()
  })

  afterEach(() => env.close())

  test('names every table the schema has, or says why a table holds nothing', () => {
    const erased = new Set(ERASED.map(([table]) => table))
    const unaccounted = tables(env.db).filter(
      (table) => !erased.has(table) && !(table in HOLDS_NOTHING),
    )

    expect(unaccounted).toEqual([])
  })

  test('and names no table the schema does not have', () => {
    const there = new Set(tables(env.db))
    expect(ERASED.map(([table]) => table).filter((table) => !there.has(table))).toEqual([])
    expect(Object.keys(HOLDS_NOTHING).filter((table) => !there.has(table))).toEqual([])
  })

  test('and waves through no table that says whose a row is', () => {
    for (const table of Object.keys(HOLDS_NOTHING)) {
      expect(
        columns(env.db, table).filter((name) => WHOSE.includes(name)),
        table,
      ).toEqual([])
    }
  })
})

/* ── Two accounts, one of everything ─────────────────────────────────── */

/** Everything that names the account being deleted. Its hashes are the ones only it
 *  holds; the shared ones are named by the other account too, and stay. */
const LEAVING = {
  id: 'user-leaving',
  email: 'leaving@example.com',
  space: 'space-leaving',
  note: 'note-leaving',
  guest: 'guest-leaving',
  blob: 'a1'.repeat(32),
  version: 'a2'.repeat(32),
}

const STAYING = {
  id: 'user-staying',
  email: 'staying@example.com',
  space: 'space-staying',
  note: 'note-staying',
  guest: 'guest-staying',
  blob: 'b1'.repeat(32),
  version: 'b2'.repeat(32),
}

const SHARED_BLOB = 'c1'.repeat(32)
const SHARED_VERSION = 'c2'.repeat(32)

type Person = typeof LEAVING

/** One of every row an account can have, for one account. */
function seed(database: DatabaseSync, who: Person): void {
  const run = (sql: string, ...values: (string | number | null)[]) =>
    database.prepare(sql).run(...values)

  run(
    `insert into users (id, email, created_at, name, settings, totp_secret, totp_at)
     values (?, ?, 1, 'Name', '{"vim":true}', 'sealed', 1)`,
    who.id,
    who.email,
  )
  run(
    `insert into spaces (id, user_id, name, created_at, updated_at, blog_enabled, blog_subdomain)
     values (?, ?, 'Space', 1, 1, 1, ?)`,
    who.space,
    who.id,
    who.space,
  )
  run('insert into space_cursor (space_id, next) values (?, 2)', who.space)
  run(
    `insert into notes (id, space_id, path, seq, updated_at, size, hash)
     values (?, ?, 'a.md', 1, 1, 3, ?)`,
    who.note,
    who.space,
    who.version,
  )
  run(
    'insert into note_versions (note_id, at, hash, size) values (?, 1, ?, 3), (?, 2, ?, 3)',
    who.note,
    who.version,
    who.note,
    SHARED_VERSION,
  )
  run(
    `insert into blog_paths (space_id, slug, note_id, at) values (?, 'old', ?, 1)`,
    who.space,
    who.note,
  )
  run(
    `insert into form_answers (id, space_id, note_id, at, answers) values (?, ?, ?, 1, '{}')`,
    `answer-${who.id}`,
    who.space,
    who.note,
  )
  run(
    `insert into note_search (note_id, space_id, path, title, body) values (?, ?, 'a.md', 'A', 'words')`,
    who.note,
    who.space,
  )
  run(
    'insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, 1)',
    who.note,
    who.space,
    who.id,
  )
  run(
    `insert into space_links (space_id, item, token, role, mode, created_at)
     values (?, '', ?, 'read', 'open', 1)`,
    who.space,
    `link-${who.id}`,
  )
  run(
    `insert into guests (id, name, email, created_at) values (?, 'Guest', ?, 1)`,
    who.guest,
    who.email,
  )
  run(
    'insert into guest_sessions (token_hash, guest_id, created_at, expires_at) values (?, ?, 1, 9e15)',
    `guest-session-${who.id}`,
    who.guest,
  )
  run(
    `insert into limits (scope, key, count, until) values
       ('ask', ?1, 1, 9e15), ('mail-to', ?2, 1, 9e15), ('waiting', ?3, 1, 9e15),
       ('guess-from', ?3 || ':203.0.113.9', 1, 9e15)`,
    who.id,
    who.email,
    who.space,
  )
  run(
    `insert into cached (scope, key, value, until) values
       ('models', ?1, '[]', 9e15), ('second-half', ?2, ?1, 9e15),
       ('second-pending', ?3, ?1 || ':secret', 9e15)`,
    who.id,
    `half-${who.id}`,
    `pending-${who.id}`,
  )
  run(
    `insert into blobs (hash, user_id, size, type, created_at) values
       (?, ?, 3, 'image/png', 1), (?, ?, 3, 'image/png', 1)`,
    who.blob,
    who.id,
    SHARED_BLOB,
    who.id,
  )
  run(
    `insert into sessions (token_hash, user_id, created_at, expires_at, id)
     values (?, ?, 1, 9e15, ?)`,
    `session-${who.id}`,
    who.id,
    `session-id-${who.id}`,
  )
  run(
    'insert into mcp_tokens (token_hash, user_id, read_only, created_at) values (?, ?, 1, 1)',
    `mcp-${who.id}`,
    who.id,
  )
  run(
    `insert into oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at)
     values (?, 'client', ?, 'http://127.0.0.1/', 'challenge', 9e15)`,
    `code-${who.id}`,
    who.id,
  )
  run(
    `insert into oauth_grants (id, user_id, client_id, client_name, access_hash,
       access_expires_at, refresh_hash, created_at)
     values (?, ?, 'client', 'Client', ?, 9e15, ?, 1)`,
    `grant-${who.id}`,
    who.id,
    `access-${who.id}`,
    `refresh-${who.id}`,
  )
  run('insert into recovery_codes (user_id, code_hash) values (?, ?)', who.id, `recovery-${who.id}`)
  run(
    `insert into login_codes (email, code_hash, salt, expires_at, attempts, sent_at)
     values (?, 'hash', 'salt', 9e15, 0, 1)`,
    who.email,
  )
  run('insert into mailed (email, sent_at) values (?, 1)', who.email)
  run('insert into mailed_days (day, email) values (1, ?)', who.email)
}

/** The ways the two reach each other: each is a member of the other's space, has
 *  asked for a file of it, has a guest in it and has it open. */
function entangle(database: DatabaseSync, one: Person, other: Person): void {
  const run = (sql: string, ...values: string[]) => database.prepare(sql).run(...values)

  run(
    `insert into space_members (space_id, email, item, role, created_at, joined_at)
     values (?, ?, '', 'write', 1, 1)`,
    other.space,
    one.email,
  )
  run(
    `insert into space_requests (space_id, email, item, role, created_at)
     values (?, ?, ?, 'read', 1)`,
    other.space,
    one.email,
    other.note,
  )
  run(
    `insert into guest_members (space_id, guest_id, item, role, joined_at, created_at)
     values (?, ?, '', 'read', 1, 1)`,
    other.space,
    one.guest,
  )
  run(
    'insert into room_sockets (note_id, space_id, who, opened_at) values (?, ?, ?, 1)',
    other.note,
    other.space,
    one.id,
  )
}

/** Every row of every table, as text, so a test can say which name anything. */
function everyRow(database: DatabaseSync): { table: string; row: string }[] {
  return tables(database).flatMap((table) =>
    database
      .prepare(`select * from ${table}`)
      .all()
      .map((row) => ({ table, row: JSON.stringify(row) })),
  )
}

const naming = (who: Person) => (row: string) =>
  [who.id, who.email, who.space, who.note, who.guest, who.blob, who.version].some((mark) =>
    row.includes(mark),
  )

describe('deleting one of two accounts', () => {
  let env: TestEnv

  beforeEach(async () => {
    env = testEnv()
    seed(env.db, LEAVING)
    seed(env.db, STAYING)
    entangle(env.db, LEAVING, STAYING)
    entangle(env.db, STAYING, LEAVING)

    for (const who of [LEAVING, STAYING]) {
      await env.NOTES.put(`spaces/${who.space}/${who.note}`, 'abc')
      await env.NOTES.put(`versions/${who.version}`, 'abc')
      await env.NOTES.put(`blobs/${who.blob}`, new Uint8Array([1]))
    }
    await env.NOTES.put(`versions/${SHARED_VERSION}`, 'abc')
    await env.NOTES.put(`blobs/${SHARED_BLOB}`, new Uint8Array([1]))
  })

  afterEach(() => env.close())

  test('leaves no row anywhere that names it', async () => {
    await eraseAccount(env, { id: LEAVING.id, email: LEAVING.email, name: null, created_at: 1 })

    const left = everyRow(env.db).filter(({ row }) => naming(LEAVING)(row))
    expect(left).toEqual([])
  })

  test('and every row of the other account that did not name it is where it was', async () => {
    const theirs = () =>
      everyRow(env.db).filter(({ row }) => naming(STAYING)(row) && !naming(LEAVING)(row))
    const before = theirs()

    await eraseAccount(env, { id: LEAVING.id, email: LEAVING.email, name: null, created_at: 1 })

    expect(theirs()).toEqual(before)
    // Machines and programs are nobody's: a ceiling counted against a machine stays.
    expect(before.length).toBeGreaterThan(20)
  })

  test('empties the bucket of it, and of nothing somebody else still names', async () => {
    await eraseAccount(env, { id: LEAVING.id, email: LEAVING.email, name: null, created_at: 1 })

    expect(env.keys().sort()).toEqual(
      [
        `spaces/${STAYING.space}/${STAYING.note}`,
        `versions/${STAYING.version}`,
        `versions/${SHARED_VERSION}`,
        `blobs/${STAYING.blob}`,
        `blobs/${SHARED_BLOB}`,
      ].sort(),
    )
    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
  })

  test('undoes nothing when the transaction fails', async () => {
    const before = everyRow(env.db)
    const keys = env.keys().sort()
    // The last statement of the batch throwing, the way a constraint would: every
    // statement before it is rolled back with it.
    env.db.exec("create trigger refuse before delete on users begin select raise(abort, 'no'); end")

    await expect(
      eraseAccount(env, { id: LEAVING.id, email: LEAVING.email, name: null, created_at: 1 }),
    ).rejects.toThrow()

    env.db.exec('drop trigger refuse')
    expect(everyRow(env.db)).toEqual(before)
    expect(env.keys().sort()).toEqual(keys)
  })

  test('picks up what a request did not get to, the next night', async () => {
    // The bucket answering nothing: the rows go, the list stays.
    const bucket = env.NOTES as unknown as { delete: (keys: string | string[]) => Promise<void> }
    const real = bucket.delete.bind(bucket)
    bucket.delete = () => Promise.reject(new Error('the bucket is unwell'))

    await eraseAccount(env, { id: LEAVING.id, email: LEAVING.email, name: null, created_at: 1 })
    expect(
      env.db.prepare('select count(*) as many from users where id = ?').get(LEAVING.id),
    ).toEqual({ many: 0 })
    const listed = env.db.prepare('select count(*) as many from leftovers').get() as {
      many: number
    }
    expect(listed.many).toBeGreaterThan(0)

    bucket.delete = real
    const { sweepLeftovers } = await import('../src/leftovers')
    await sweepLeftovers(env)

    expect(env.db.prepare('select count(*) as many from leftovers').get()).toEqual({ many: 0 })
    expect(env.keys().filter((key) => naming(LEAVING)(key))).toEqual([])
  })
})
