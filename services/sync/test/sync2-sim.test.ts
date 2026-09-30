/** The Worker as `@nib/sync-core`'s simulator's account (docs/sync-v2.md section 12).
 *
 *  The simulator drives devices and an account over an unkind network and then judges
 *  what everybody holds. Here the account is this Worker - its routes, its rooms and
 *  its SQL - behind the kit's `AccountAdapter`, and the devices are the kit's reference
 *  ones, which speak exactly the protocol of section 7. Each scripted road of section 1
 *  that used to end in a second file or in lost words is run against the real thing:
 *  the closed laptop (road 2), two `Untitled.md` made apart (road 4), a delete against
 *  an edit in both orders (road 5), and an offline rename against an edit (road 6). */

import { afterEach, describe, expect, test } from 'vitest'
import { TEXT } from '@nib/rooms'
import {
  type AccountAdapter,
  type AccountView,
  CALM,
  type Report,
  type Route,
  type Seeded,
  simulate,
  type Step,
  markersIn,
} from '@nib/sync-core/sim'
import { nameKey } from '@nib/sync-core'
import * as Y from 'yjs'
import { sha256 } from '../src/crypto'
import { documentOf } from '../src/sync2/docs'
import app from '../src/index'
import type { Note } from '../src/types'
import { call, signIn, type TestEnv, testEnv } from './harness'
import { type Live, live } from './sync2'

const OCTETS = 'application/octet-stream'

/** The Worker, as the simulator reaches an account. */
class WorkerAccount implements AccountAdapter {
  readonly env: TestEnv
  private readonly rooms: Live
  private readonly ready: Promise<void>
  private space = ''
  private readonly sessions = new Map<string, string>()

  constructor(private readonly seeded: readonly Seeded[]) {
    this.env = testEnv()
    this.rooms = live(this.env)
    this.ready = this.setUp()
  }

  /** An account, a space holding the seeded notes on their first epoch at the
   *  numbers the devices start from, and a session for each device, bound to it. */
  private async setUp() {
    const token = await signIn(this.env, 'sim@example.com')
    this.space = (
      await call(this.env, '/v1/spaces', { token, body: { name: 'Sim' } })
    ).json.space.id

    const db = this.env.db
    let seq = 0
    for (const note of this.seeded) {
      seq += 1
      const hash = await sha256(note.text)
      db.prepare(
        `insert into notes (id, space_id, path, seq, version, updated_at, deleted, size, hash,
                            name, name_key, kind, epoch, epoch_base, doc_seq)
         values (?, ?, ?, ?, 1, 0, 0, ?, ?, ?, ?, 'note', 1, ?, ?)`,
      ).run(note.id, this.space, note.name, seq, note.text.length, hash, note.name, nameKey(note.name), hash, seq)
      await this.env.NOTES.put(`spaces/${this.space}/${note.id}`, note.text)
    }
    db.prepare('insert into space_cursor (space_id, next) values (?, ?)').run(this.space, seq + 1)
    db.prepare('update spaces set prepared_at = 1 where id = ?').run(this.space)
  }

  /** The session a device speaks with: its own, with the device bound to it the way a
   *  hello binds one, so every change it makes is written down as its own. */
  private async session(device: string): Promise<string> {
    const held = this.sessions.get(device)
    if (held) return held

    const token = await signIn(this.env, 'sim@example.com')
    const row = this.env.db
      .prepare('select id, user_id from sessions where token_hash = ?')
      .get(await sha256(token)) as { id: string; user_id: string }
    this.env.db
      .prepare(
        `insert into devices (id, user_id, session_id, name, platform, created_at)
         values (?, ?, ?, ?, 'test', 0)`,
      )
      .run(device, row.user_id, row.id, device)
    this.sessions.set(device, token)
    return token
  }

  async handle(device: string, route: Route, body: Uint8Array): Promise<Uint8Array> {
    await this.ready
    const token = await this.session(device)
    const headers = { authorization: `Bearer ${token}`, accept: OCTETS, 'x-nib-device': device }

    let request: Request
    if (route === 'feed') {
      const { unframe } = await import('@nib/sync-core')
      const since = (unframe(body) as { since?: number } | null)?.since ?? 0
      request = new Request(
        `https://nibeditor.com/v2/spaces/${this.space}/feed?since=${String(since)}`,
        { headers },
      )
    } else {
      const path = route === 'ops' ? `/v2/spaces/${this.space}/ops` : `/v2/docs/${route}`
      request = new Request(`https://nibeditor.com${path}`, {
        method: 'POST',
        headers: { ...headers, 'content-type': OCTETS },
        body,
      })
    }

    const response = await app.fetch(request, this.env)
    if (response.status !== 200) {
      throw new Error(`${route} answered ${String(response.status)}: ${await response.text()}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())

    // A second and a bit of nobody typing: every room that took something settles, so
    // what it took is in the feed and in the bucket, as it would be by the next pass.
    if (route === 'push') await this.rooms.settle()
    return bytes
  }

  async view(): Promise<AccountView> {
    await this.ready
    const db = this.env.db
    const folders = db
      .prepare('select id, parent_id as parent, name from folders where space_id = ? and deleted = 0')
      .all(this.space) as { id: string; parent: string | null; name: string }[]
    const notes = db
      .prepare('select * from notes where space_id = ? and deleted = 0')
      .all(this.space) as unknown as Note[]

    const texts: Record<string, string> = {}
    for (const note of notes) {
      const held = await documentOf(this.env, note)
      if (!held) continue
      const doc = new Y.Doc()
      Y.applyUpdateV2(doc, held.update)
      texts[note.id] = doc.getText(TEXT).toJSON()
    }

    const versions: string[] = []
    const kept = db
      .prepare(
        `select distinct v.hash from note_versions v join notes n on n.id = v.note_id
          where n.space_id = ?`,
      )
      .all(this.space) as { hash: string }[]
    for (const { hash } of kept) {
      const object = await this.env.NOTES.get(`versions/${hash}`)
      if (object) versions.push(await object.text())
    }

    return {
      entries: [
        ...folders.map((one) => ({ id: one.id, kind: 'folder' as const, parent: one.parent, name: one.name })),
        ...notes.map((one) => ({
          id: one.id,
          kind: 'note' as const,
          parent: one.folder_id ?? null,
          name: one.name ?? one.path,
        })),
      ],
      texts,
      versions,
    }
  }

  close() {
    this.env.close()
  }
}

let made: WorkerAccount[] = []

afterEach(() => {
  for (const one of made) one.close()
  made = []
})

/** Waits long enough for everything in the air to land. */
const settle: Step = { t: 'wait', ticks: 40 }

function run(script: readonly Step[]): Promise<Report> {
  return simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    account: (_clock, seeded) => {
      const account = new WorkerAccount(seeded)
      made.push(account)
      return account
    },
  })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

/** Plan.md is the first of the seeded notes by id, so a pick of 0 lands on it. */
const PLAN = 0

describe('the Worker as the simulator’s account', () => {
  test('road 2: the laptop that was closed merges character by character, asking nothing', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'laptop mk101z' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 1, words: 'phone mk102z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.held).toBe(0)
    expect(markersIn(textOf(report, 'Plan.md'))).toEqual(
      expect.arrayContaining(['mk101z', 'mk102z']),
    )
    expect(report.account.entries.filter((one) => one.name.includes('from another'))).toEqual([])
  })

  test('road 4: two Untitled.md made apart are two notes, the second numbered', async () => {
    const make = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'create', folder: null, name: 'Untitled.md', words: marker },
    })
    const report = await run([
      { t: 'offline', device: 0 },
      make(0, 'mk201z'),
      make(1, 'mk202z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const names = report.account.entries.map((one) => one.name).sort()
    expect(names).toEqual(['Ideas.md', 'Plan.md', 'Untitled 2.md', 'Untitled.md'])
  })

  test('road 5: a delete landing first is undone by the edit written meanwhile', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0.5, words: 'mk301z' } },
      { t: 'act', device: 1, action: { t: 'delete', target: PLAN } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk301z')
  })

  test('road 5, the other order: an edit landing first refuses the delete that had not seen it', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0.5, words: 'mk302z' } },
      { t: 'pass', device: 0 },
      settle,
      { t: 'act', device: 1, action: { t: 'delete', target: PLAN } },
      { t: 'pass', device: 1 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk302z')
  })

  test('road 6: a rename made offline and an edit made elsewhere both hold', async () => {
    const report = await run([
      { t: 'offline', device: 0 },
      { t: 'act', device: 0, action: { t: 'rename', target: PLAN, name: 'Renamed.md' } },
      { t: 'act', device: 1, action: { t: 'type', note: PLAN, at: 0.3, words: 'mk401z' } },
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Renamed.md')).toContain('mk401z')
    expect(textOf(report, 'Plan.md')).toBe('')
  })
})

describe('random walks against the Worker', () => {
  /** A few dozen seeds of the unkind network, each a run of sixty steps: what CI can
   *  afford beside the rest of the suite. The kit's own nightly run walks a million
   *  against the reference account. */
  const SEEDS = 25

  test(`${String(SEEDS)} seeds hold every check`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({
        seed,
        account: (_clock, seeded) => {
          const account = new WorkerAccount(seeded)
          made.push(account)
          return account
        },
      })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      for (const one of made) one.close()
      made = []
    }
    expect(failed).toEqual([])
  }, 300_000)
})
