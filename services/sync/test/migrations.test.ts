/** The migrations as migrations: run against the schema that was there before
 *  them, on rows that schema allowed.
 *
 *  Every other test here runs against the whole folder applied to an empty
 *  database, which is the right thing for a route and no test at all for a
 *  backfill: the rows a backfill exists for cannot be written once the migration
 *  that fixes them has run. So this file builds the database up to one
 *  migration, puts yesterday's rows in, and then applies the next. */

import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const FOLDER = fileURLToPath(new URL('../migrations/', import.meta.url))
const MIGRATIONS = readdirSync(FOLDER)
  .filter((name) => name.endsWith('.sql'))
  .sort()

function sql(name: string): string {
  return readFileSync(FOLDER + name, 'utf8')
}

/** A database with every migration up to and including this one applied. */
function upTo(last: string): DatabaseSync {
  const database = new DatabaseSync(':memory:')

  for (const name of MIGRATIONS) {
    database.exec(sql(name))
    if (name === last) return database
  }

  throw new Error(`no migration named ${last}`)
}

/** The account, space and note every case below needs, written with the columns
 *  the schema had at that point. */
function seed(database: DatabaseSync): void {
  database.exec(`insert into users (id, email, created_at) values ('u', 'a@b.c', 1)`)
  database.exec(
    `insert into spaces (id, user_id, name, created_at, updated_at)
     values ('sp', 'u', 'Space', 1, 1)`,
  )
}

function indexes(database: DatabaseSync, table: string): string[] {
  return database
    .prepare(`select name from sqlite_master where type = 'index' and tbl_name = ?`)
    .all(table)
    .map((row) => String((row as { name: string | null }).name))
}

describe('0017, the notes deleted before Recently deleted existed', () => {
  /** A note as a delete wrote it before 0011: flagged, and no stamp. */
  function deletedLongAgo(database: DatabaseSync, id: string, at: number): void {
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, size, hash)
       values ('${id}', 'sp', '${id}.md', 1, ${at}, 1, 12, 'abc')`,
    )
  }

  test('stamps them with when the delete was written', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    deletedLongAgo(database, 'old', 1_700_000_000_000)

    database.exec(sql('0017_deleted_at.sql'))

    const row = database.prepare(`select deleted_at from notes where id = 'old'`).get()
    expect(row).toEqual({ deleted_at: 1_700_000_000_000 })
    database.close()
  })

  test('leaves a live note alone', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, size, hash)
       values ('live', 'sp', 'live.md', 1, 5, 0, 12, 'abc')`,
    )

    database.exec(sql('0017_deleted_at.sql'))

    expect(database.prepare(`select deleted_at from notes where id = 'live'`).get()).toEqual({
      deleted_at: null,
    })
    database.close()
  })

  test('leaves a note already in Recently deleted where it was', () => {
    const database = upTo('0016_guests.sql')
    seed(database)
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, deleted_at, size, hash)
       values ('kept', 'sp', 'kept.md', 1, 9, 1, 7, 12, 'abc')`,
    )

    database.exec(sql('0017_deleted_at.sql'))

    expect(database.prepare(`select deleted_at from notes where id = 'kept'`).get()).toEqual({
      deleted_at: 7,
    })
    database.close()
  })

  test('indexes what the purge looks for', () => {
    const database = upTo('0017_deleted_at.sql')
    expect(indexes(database, 'notes')).toContain('notes_deleted_at')
    database.close()
  })
})

describe('0022, the plaintext OpenAI key an older build stored', () => {
  /** The settings blob as a build before this one wrote it: the key in the clear,
   *  beside the choices that are settings like any other. */
  function chose(database: DatabaseSync, id: string, settings: string): void {
    database.exec(
      `insert into users (id, email, created_at, settings)
       values ('${id}', '${id}@b.c', 1, '${settings}')`,
    )
  }

  test('is dropped, and the rest of the settings stay', () => {
    const database = upTo('0021_domain_proof.sql')
    chose(
      database,
      'one',
      '{"glassesKey":"sk-proj-secret","glassesModel":"gpt-6-astra","vim":true}',
    )

    database.exec(sql('0022_openai_key.sql'))

    const row = database.prepare(`select settings, openai_key from users where id = 'one'`).get()
    const { settings, openai_key: sealed } = row as { settings: string; openai_key: unknown }
    expect(JSON.parse(settings)).toEqual({ glassesModel: 'gpt-6-astra', vim: true })
    expect(settings).not.toContain('sk-proj-secret')
    // Not carried over: it cannot be encrypted here, and the pane asks for it again.
    expect(sealed).toBeNull()
    database.close()
  })

  test('leaves an account that never set one exactly as it was', () => {
    const database = upTo('0021_domain_proof.sql')
    chose(database, 'two', '{"vim":true}')

    database.exec(sql('0022_openai_key.sql'))

    const row = database.prepare(`select settings from users where id = 'two'`).get()
    expect(JSON.parse((row as { settings: string }).settings)).toEqual({ vim: true })
    database.close()
  })

  test('indexes what the cache sweep looks for', () => {
    const database = upTo('0022_openai_key.sql')
    expect(indexes(database, 'cached')).toContain('cached_until')
    database.close()
  })
})

describe('0039, the account’s devices and web logins', () => {
  /** A device of the account, with the web key wrapped to it and a state it wrote. */
  function device(database: DatabaseSync): void {
    database.exec(
      `insert into devices (id, user_id, name, platform, created_at) values ('d', 'u', 'L', 'mac', 1);
       insert into web_keys (user_id, device_id, wrapped, generation) values ('u', 'd', 'w', 1);
       insert into web_states (user_id, key, fence, version, generation, size, device_id, at)
         values ('u', 'k', 1, 1, 1, 1, 'd', 1);
       insert into web_chunks (user_id, name, size, at) values ('u', 'c', 1, 1);`,
    )
  }

  const count = (database: DatabaseSync, table: string) =>
    (database.prepare(`select count(*) as many from ${table}`).get() as { many: number }).many

  test('puts every space there already is in the shared web store', () => {
    const database = upTo('0038_leftovers.sql')
    seed(database)

    database.exec(sql('0039_sync2_devices_web.sql'))

    expect(database.prepare(`select web_store from spaces where id = 'sp'`).get()).toEqual({
      web_store: 'global',
    })
    database.close()
  })

  test('holds a space to the three stores there are', () => {
    const database = upTo('0039_sync2_devices_web.sql')
    seed(database)

    expect(() => database.exec(`update spaces set web_store = 'other' where id = 'sp'`)).toThrow()
    for (const store of ['global', 'space', 'site']) {
      database.exec(`update spaces set web_store = '${store}' where id = 'sp'`)
    }
    database.close()
  })

  test('takes the key wrapped to a device with the device', () => {
    const database = upTo('0039_sync2_devices_web.sql')
    seed(database)
    device(database)

    database.exec(`delete from devices where id = 'd'`)

    expect(count(database, 'web_keys')).toBe(0)
    database.close()
  })

  test('takes everything of an account with the account', () => {
    const database = upTo('0039_sync2_devices_web.sql')
    seed(database)
    device(database)

    database.exec(`delete from users where id = 'u'`)

    for (const table of ['devices', 'web_keys', 'web_states', 'web_chunks']) {
      expect(count(database, table), table).toBe(0)
    }
    database.close()
  })

  test('indexes what the hub’s door and the device list look for', () => {
    const database = upTo('0039_sync2_devices_web.sql')
    expect(indexes(database, 'devices')).toEqual(
      expect.arrayContaining(['devices_user', 'devices_session']),
    )
    database.close()
  })
})

describe('0042, the answers a form took before they were measured', () => {
  test('are measured in the bytes they are stored as', () => {
    const database = upTo('0041_space_archived.sql')
    seed(database)
    database.exec(
      `insert into notes (id, space_id, path, seq, updated_at, deleted, size, hash)
       values ('n', 'sp', 'Hello.md', 1, 1, 0, 1, 'abc')`,
    )
    database.exec(
      `insert into form_answers (id, space_id, note_id, at, answers)
       values ('plain', 'sp', 'n', 1, '{"Your name":"Ada"}'),
              ('wide', 'sp', 'n', 1, '{"Your name":"Zoë 🌱"}')`,
    )

    database.exec(sql('0042_form_answer_bytes.sql'))

    const rows = database
      .prepare('select id, answers, bytes from form_answers order by id')
      .all() as { id: string; answers: string; bytes: number }[]
    for (const row of rows) {
      expect(row.bytes, row.id).toBe(new TextEncoder().encode(row.answers).byteLength)
    }
    expect(rows.find((one) => one.id === 'wide')?.bytes).toBeGreaterThan(
      rows.find((one) => one.id === 'wide')?.answers.length ?? 0,
    )
    database.close()
  })

  test('indexes what the ceiling and the sweep read', () => {
    const database = upTo('0042_form_answer_bytes.sql')
    expect(indexes(database, 'form_answers')).toEqual(
      expect.arrayContaining(['form_answers_space_bytes', 'form_answers_at']),
    )
    database.close()
  })
})
