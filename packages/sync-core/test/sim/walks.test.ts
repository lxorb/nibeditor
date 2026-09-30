import { describe, expect, test } from 'vitest'
import { simulate } from './run'

/** How many seeds a CI run walks. The nightly run is `pnpm --filter @nib/sync-core
 *  sim:long`. */
const SEEDS = 1000

describe('random walks', () => {
  test(`${String(SEEDS)} seeds of the reference account and devices hold every check`, async () => {
    const failed: string[] = []
    for (let seed = 1; seed <= SEEDS; seed++) {
      const report = await simulate({ seed })
      if (report.failures.length) failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      if (failed.length >= 5) break
    }
    expect(failed).toEqual([])
  }, 600_000)
})
