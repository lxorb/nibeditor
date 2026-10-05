import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { awake, IDLE_MS, OFF } from './awake'
import type { Activity, Allowance, AwakeAnswer, Watcher } from './types'
import { FREE } from './usage'

const NOW = 1_760_000_000_000
const MINUTE = 60_000

const none: Allowance = { awakeS: 0, cpuS: 0, homeBytes: 0, egressBytes: 0 }

const watcher = (active: boolean, onScreen: boolean): Watcher => ({
  who: 'u_emil',
  device: 'd_1',
  active,
  onScreen,
})

const quiet = (ago: number): Activity => ({
  at: NOW - ago,
  output: 0,
  cpu: 0,
  net: 0,
  homeBytes: 1,
})

const STAY: AwakeAnswer = { stay: true }
const asleep = (reason: 'idle' | 'allowance' | 'budget' | 'off'): AwakeAnswer => ({
  stay: false,
  reason,
})

interface Case {
  watchers?: Watcher[]
  recent?: Activity[]
  keepAwake?: boolean
  used?: Allowance
  limit?: Allowance
  budgetLeft?: number
}

function ask(given: Case): AwakeAnswer {
  return awake(
    NOW,
    given.watchers ?? [],
    given.recent ?? [],
    given.keepAwake ?? false,
    given.used ?? none,
    given.limit ?? FREE,
    given.budgetLeft ?? 30,
  )
}

describe('awake: somebody using a terminal', () => {
  it.each<[string, Watcher[], AwakeAnswer]>([
    ['nobody connected', [], asleep('idle')],
    ['an active person with it on screen', [watcher(true, true)], STAY],
    ['an active person with it behind another tab', [watcher(true, false)], asleep('idle')],
    [
      'an idle person with it on screen (a second monitor overnight)',
      [watcher(false, true)],
      asleep('idle'),
    ],
    ['an idle person with it hidden', [watcher(false, false)], asleep('idle')],
    ['one idle and one active on screen', [watcher(false, true), watcher(true, true)], STAY],
    [
      'two people, neither both active and looking',
      [watcher(true, false), watcher(false, true)],
      asleep('idle'),
    ],
  ])('%s', (_, watchers, answer) => {
    expect(ask({ watchers })).toEqual(answer)
  })
})

describe('awake: something in it working', () => {
  it.each<[string, Partial<Activity>, number, AwakeAnswer]>([
    ['nothing at all a minute ago', {}, MINUTE, asleep('idle')],
    ['a byte printed a minute ago', { output: 1 }, MINUTE, STAY],
    ['output 14 minutes ago', { output: 500 }, 14 * MINUTE, STAY],
    ['output exactly 15 minutes ago', { output: 500 }, IDLE_MS, STAY],
    ['output 16 minutes ago', { output: 500 }, 16 * MINUTE, asleep('idle')],
    ['CPU at 5%, the line itself', { cpu: 0.05 }, MINUTE, asleep('idle')],
    ['CPU at 6% (a build that prints nothing)', { cpu: 0.06 }, MINUTE, STAY],
    ['CPU at 100% 20 minutes ago', { cpu: 1 }, 20 * MINUTE, asleep('idle')],
    ['25 KB in 30 s, 50 KB a minute, the line itself', { net: 25 * 1024 }, MINUTE, asleep('idle')],
    ['26 KB in 30 s (an agent thinking)', { net: 26 * 1024 }, MINUTE, STAY],
    ['a megabyte 16 minutes ago', { net: 1024 * 1024 }, 16 * MINUTE, asleep('idle')],
    ['a big home and nothing else', { homeBytes: 4e9 }, MINUTE, asleep('idle')],
  ])('%s', (_, activity, ago, answer) => {
    expect(ask({ recent: [{ ...quiet(ago), ...activity }] })).toEqual(answer)
  })

  it('stays for one working report among quiet ones', () => {
    const recent = [quiet(MINUTE), { ...quiet(10 * MINUTE), output: 3 }, quiet(30 * MINUTE)]
    expect(ask({ recent })).toEqual(STAY)
  })

  it('sleeps with only quiet reports, however many', () => {
    const recent = Array.from({ length: 30 }, (_, at) => quiet(at * 30_000))
    expect(ask({ recent })).toEqual(asleep('idle'))
  })
})

describe('awake: Keep awake', () => {
  it('stays with nothing else going on', () => {
    expect(ask({ keepAwake: true })).toEqual(STAY)
  })

  it('does not outlast the allowance, the budget or the switch', () => {
    expect(ask({ keepAwake: true, used: FREE })).toEqual(asleep('allowance'))
    expect(ask({ keepAwake: true, budgetLeft: 0 })).toEqual(asleep('budget'))
    expect(ask({ keepAwake: true, limit: OFF })).toEqual(asleep('off'))
  })
})

describe('awake: the allowance', () => {
  const busy = { watchers: [watcher(true, true)], recent: [{ ...quiet(0), output: 9 }] }

  it.each<[string, Partial<Allowance>, AwakeAnswer]>([
    ['nothing used', {}, STAY],
    ['a second short of the hours', { awakeS: FREE.awakeS - 1 }, STAY],
    ['the hours used', { awakeS: FREE.awakeS }, asleep('allowance')],
    ['past the hours', { awakeS: FREE.awakeS + 600 }, asleep('allowance')],
    ['the CPU used', { cpuS: FREE.cpuS }, asleep('allowance')],
    ['a second short of the CPU', { cpuS: FREE.cpuS - 1 }, STAY],
    ['the egress used', { egressBytes: FREE.egressBytes }, asleep('allowance')],
    ['a byte short of the egress', { egressBytes: FREE.egressBytes - 1 }, STAY],
    [
      'a full home (the disk fails writes; the machine stays)',
      { homeBytes: FREE.homeBytes * 2 },
      STAY,
    ],
  ])('%s', (_, used, answer) => {
    expect(ask({ ...busy, used: { ...none, ...used } })).toEqual(answer)
  })
})

describe('awake: the budget and the switch', () => {
  const busy = { watchers: [watcher(true, true)], keepAwake: true }

  it.each<[string, number, AwakeAnswer]>([
    ['plenty left', 30, STAY],
    ['a cent left', 0.01, STAY],
    ['nothing left', 0, asleep('budget')],
    ['past the ceiling', -4, asleep('budget')],
    ['a budget nobody could work out', Number.NaN, asleep('budget')],
  ])('%s', (_, budgetLeft, answer) => {
    expect(ask({ ...busy, budgetLeft })).toEqual(answer)
  })

  it('says off for a service or account switched off, before anything else', () => {
    expect(ask({ ...busy, limit: OFF, used: FREE, budgetLeft: -1 })).toEqual(asleep('off'))
  })

  it('says budget before allowance, when both are spent', () => {
    expect(ask({ ...busy, used: FREE, budgetLeft: 0 })).toEqual(asleep('budget'))
  })
})

describe('awake: properties', () => {
  const activity = fc.record({
    at: fc.integer({ min: NOW - 40 * MINUTE, max: NOW }),
    output: fc.nat({ max: 10_000 }),
    cpu: fc.double({ min: 0, max: 1, noNaN: true }),
    net: fc.nat({ max: 200_000 }),
    homeBytes: fc.nat(),
  })
  const watchers = fc.array(
    fc.record({
      who: fc.string(),
      device: fc.string(),
      active: fc.boolean(),
      onScreen: fc.boolean(),
    }),
    { maxLength: 4 },
  )
  const allowance = fc.record({
    awakeS: fc.nat({ max: 100_000 }),
    cpuS: fc.nat({ max: 50_000 }),
    homeBytes: fc.nat(),
    egressBytes: fc.nat(),
  })
  const inputs: fc.Arbitrary<Required<Case>> = fc.record({
    watchers,
    recent: fc.array(activity, { maxLength: 6 }),
    keepAwake: fc.boolean(),
    used: allowance,
    limit: allowance,
    budgetLeft: fc.double({ min: -10, max: 40, noNaN: true }),
  })
  const answer = (given: Required<Case>) =>
    awake(
      NOW,
      given.watchers,
      given.recent,
      given.keepAwake,
      given.used,
      given.limit,
      given.budgetLeft,
    )

  it('more activity never sleeps sooner', () => {
    fc.assert(
      fc.property(inputs, activity, (given, more) => {
        if (answer(given).stay) {
          expect(answer({ ...given, recent: [...given.recent, more] }).stay).toBe(true)
        }
      }),
    )
  })

  it('busier reports never sleep sooner', () => {
    fc.assert(
      fc.property(
        inputs,
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.nat(),
        (given, output, cpu, net) => {
          if (!answer(given).stay) return
          const busier = given.recent.map((one) => ({
            ...one,
            output: one.output + output,
            cpu: Math.max(one.cpu, cpu),
            net: one.net + net,
          }))
          expect(answer({ ...given, recent: busier }).stay).toBe(true)
        },
      ),
    )
  })

  it('another watcher, or Keep awake, never sleeps sooner', () => {
    fc.assert(
      fc.property(inputs, watchers, (given, more) => {
        if (!answer(given).stay) return
        expect(answer({ ...given, watchers: [...given.watchers, ...more] }).stay).toBe(true)
        expect(answer({ ...given, keepAwake: true }).stay).toBe(true)
      }),
    )
  })

  it('less used, or more budget, never sleeps sooner', () => {
    fc.assert(
      fc.property(
        inputs,
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.nat({ max: 100 }),
        (given, less, more) => {
          if (!answer(given).stay) return
          const used = {
            awakeS: given.used.awakeS * less,
            cpuS: given.used.cpuS * less,
            homeBytes: given.used.homeBytes,
            egressBytes: given.used.egressBytes * less,
          }
          expect(answer({ ...given, used, budgetLeft: given.budgetLeft + more }).stay).toBe(true)
        },
      ),
    )
  })

  it('a later moment never wakes a sleeping machine by itself', () => {
    fc.assert(
      fc.property(inputs, fc.nat({ max: 60 * MINUTE }), (given, later) => {
        const now = answer(given)
        const then = awake(
          NOW + later,
          given.watchers,
          given.recent,
          given.keepAwake,
          given.used,
          given.limit,
          given.budgetLeft,
        )
        if (!now.stay) expect(then.stay).toBe(false)
      }),
    )
  })
})
