/** The simulator's random walks with the engine as every device (docs/sync-v2.md
 *  section 12). `pnpm test` walks three hundred of them (sim.test.ts); `pnpm --filter
 *  @nib/desktop sim:long` walks ten thousand in four quarters at once, one file each, so
 *  the run takes the few minutes of a CI job rather than the ten of one core.
 *
 *  `SIM_FROM` says where the walk starts: the CI job walks 1 to 10,000 every time, so a
 *  change that breaks one of them is caught on its own push; the nightly run starts at
 *  the day's number, so every night walks seeds no night walked before. A failure names
 *  its seed, and `SIM_FROM=<seed> SIM_SEEDS=1` replays it. */

import { describe, expect, test } from 'vitest'
import { simulate } from '@nib/sync-core/sim'
import { EngineDevice } from '../sim-device'

/** The seeds from `from`, `count` of them, and what failed, at most five. */
export async function walked(from: number, count: number): Promise<string[]> {
  const failed: string[] = []
  for (let seed = from; seed < from + count && failed.length < 5; seed++) {
    const report = await simulate({
      seed,
      device: (id, clock, random, seeded) => new EngineDevice(id, clock, random, seeded),
    })
    if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
  }
  return failed
}

const QUARTERS = 4

/** One quarter of the long run, as one test file. */
export function quarter(index: number) {
  const seeds = Number(process.env.SIM_SEEDS ?? 10_000)
  const from = Number(process.env.SIM_FROM ?? 1)
  const size = Math.ceil(seeds / QUARTERS)
  const start = from + index * size
  const count = Math.max(0, Math.min(size, from + seeds - start))

  describe('the engine walks', () => {
    test(`seeds ${String(start)} to ${String(start + count - 1)}`, async () => {
      expect(await walked(start, count)).toEqual([])
    }, 0)
  })
}
