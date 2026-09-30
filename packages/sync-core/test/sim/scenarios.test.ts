/** One scripted run per road to a second file or lost work in docs/sync-v2.md section
 *  1, each pinned so it cannot come back, and the planted bug the simulator has to
 *  catch. Scripts run on a calm network so each says exactly what it means; the random
 *  walks in walks.test.ts are where the network is unkind. */

import { describe, expect, test } from 'vitest'
import { markersIn } from './checks'
import { CALM } from './network'
import { type Report, type Step, simulate } from './run'

/** Waits long enough for everything in the air to land. */
const settle: Step = { t: 'wait', ticks: 40 }

function run(script: readonly Step[], plant?: 'delete-without-seen'): Promise<Report> {
  return simulate({ seed: 7, devices: 2, faults: CALM, script, ...(plant ? { plant } : {}) })
}

function textOf(report: Report, name: string): string {
  const entry = report.account.entries.find((one) => one.name === name)
  return entry ? (report.account.texts[entry.id] ?? '') : ''
}

/** Plan.md is the first of the seeded notes by id, so a pick of 0 lands on it. */
const PLAN = 0

describe('scripted roads', () => {
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

  test('road 5: a delete landing first is undone by the edit that was written meanwhile', async () => {
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

  test('a crash loses only what was typed since the last save, and nothing after relaunch', async () => {
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

describe('the planted bug', () => {
  const script: Step[] = [
    { t: 'act', device: 0, action: { t: 'type', note: PLAN, at: 0.5, words: 'mk901z' } },
    { t: 'pass', device: 0 },
    settle,
    { t: 'act', device: 1, action: { t: 'delete', target: PLAN } },
    { t: 'pass', device: 1 },
    settle,
  ]

  test('the reference account keeps words a delete never saw', async () => {
    expect((await run(script)).failures).toEqual([])
  })

  test('an account that deletes without the seen check is caught, scripted', async () => {
    const report = await run(script, 'delete-without-seen')
    expect(report.failures).toContain('mk901z was typed and is in no note and no version')
  })

  test('and caught by the random walks, without being told where to look', async () => {
    let caught = 0
    for (let seed = 1; seed <= 200; seed++) {
      const report = await simulate({ seed, plant: 'delete-without-seen' })
      if (report.failures.length) caught += 1
    }
    expect(caught).toBeGreaterThan(0)
  })
})
