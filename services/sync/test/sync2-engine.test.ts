/** The app's sync v2 engine against this Worker, both whole, in `@nib/sync-core`'s
 *  simulator (docs/sync-v2.md section 12).
 *
 *  The devices are the engine that runs in the window (apps/desktop/src/lib/sync2,
 *  through its simulator adapter, `sim-device.ts`), each with its store in memory and a
 *  disk of its own; the account is this Worker's routes, rooms and SQL (sync2-account.ts).
 *  Every scripted road of section 1 that used to end in a second file or in lost words,
 *  then random walks on the unkind network, judged by the same checks as the reference.
 *
 *  The engine is reached by its path rather than by a package: it is the app's, and the
 *  Worker's types say nothing about it. Its own suite runs ten thousand seeds against the
 *  reference account (apps/desktop/src/lib/sync2/sim.test.ts). */

import { afterEach, describe, expect, test } from 'vitest'
import {
  CALM,
  type DeviceAdapter,
  markersIn,
  type Options,
  type Report,
  simulate,
  type Step,
} from '@nib/sync-core/sim'
import { WorkerAccount } from './sync2-account'

type Devices = NonNullable<Options['device']>

/** The engine's simulator adapter, fetched by its path. */
async function engineDevices(): Promise<Devices> {
  const path = new URL('../../../apps/desktop/src/lib/sync2/sim-device.ts', import.meta.url)
  const engine = (await import(/* @vite-ignore */ path.href)) as {
    EngineDevice: new (...made: Parameters<Devices>) => DeviceAdapter
  }
  return (...made) => new engine.EngineDevice(...made)
}

let made: WorkerAccount[] = []

afterEach(() => {
  for (const one of made) one.close()
  made = []
})

const account: NonNullable<Options['account']> = (_clock, seeded) => {
  const one = new WorkerAccount(seeded)
  made.push(one)
  return one
}

/** Waits long enough for everything in the air to land. */
const settle: Step = { t: 'wait', ticks: 40 }

async function run(script: readonly Step[]): Promise<Report> {
  return await simulate({
    seed: 7,
    devices: 2,
    faults: CALM,
    script,
    account,
    device: await engineDevices(),
  })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

/** Plan.md is the first of the seeded notes by id, so a pick of 0 lands on it. */
const PLAN = 0

describe('the engine against the Worker', () => {
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

  test("the day's note made on two devices is one note with both lines", async () => {
    const append = (device: number, marker: string): Step => ({
      t: 'act',
      device,
      action: { t: 'append-day', name: '2026-09-30.md', words: marker },
    })
    const report = await run([
      { t: 'offline', device: 0 },
      append(0, 'mk501z'),
      append(1, 'mk502z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const days = report.account.entries.filter((one) => one.name.startsWith('2026-09-30'))
    expect(days).toHaveLength(1)
    expect(markersIn(textOf(report, '2026-09-30.md'))).toEqual(
      expect.arrayContaining(['mk501z', 'mk502z']),
    )
  })

  test('a sentence rewritten on both sides is held and asked, and Keep both keeps both', async () => {
    const rewrite = (device: number, words: string): Step[] => [
      { t: 'act', device, action: { t: 'cut', note: PLAN, at: 0, length: 36 } },
      { t: 'act', device, action: { t: 'type', note: PLAN, at: 0, words } },
    ]
    const report = await run([
      { t: 'offline', device: 0 },
      ...rewrite(0, 'Let us hold the whole release until every reviewer has signed off mk601z'),
      ...rewrite(1, 'The release goes out on Friday morning whatever the review says mk602z'),
      { t: 'pass', device: 1 },
      settle,
      { t: 'online', device: 0 },
      { t: 'pass', device: 0 },
      settle,
      { t: 'answer', device: 0, choice: 'both' },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(report.held).toBeGreaterThan(0)
    const everything = Object.values(report.account.texts).join('\n')
    expect(everything).toContain('mk601z')
    expect(everything).toContain('mk602z')
    expect(report.account.entries.some((one) => one.name === 'Plan (d0).md')).toBe(true)
  })

  test('a crash loses only what was typed since the last save', async () => {
    const report = await run([
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0, words: 'mk701z' } },
      { t: 'act', device: 0, action: { t: 'save' } },
      { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 1, words: 'mk702z' } },
      { t: 'crash', device: 0 },
      { t: 'launch', device: 0 },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    const plan = textOf(report, 'Plan.md')
    expect(plan).toContain('mk701z')
    expect(plan).not.toContain('mk702z')
  })

  test('a file changed by another program is folded in three ways', async () => {
    const report = await run([
      {
        t: 'act',
        device: 0,
        action: { t: 'edit-file', note: PLAN, at: 0.2, words: 'mk801z', cut: 0 },
      },
      { t: 'pass', device: 0 },
      settle,
    ])

    expect(report.failures).toEqual([])
    expect(textOf(report, 'Plan.md')).toContain('mk801z')
  })
})

describe('random walks of the engine against the Worker', () => {
  /** A few dozen seeds of the unkind network: what CI affords beside the rest. */
  const SEEDS = 25

  test(`${String(SEEDS)} seeds hold every check`, async () => {
    const device = await engineDevices()
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({ seed, account, device })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      for (const one of made) one.close()
      made = []
    }
    expect(failed).toEqual([])
  }, 300_000)
})
