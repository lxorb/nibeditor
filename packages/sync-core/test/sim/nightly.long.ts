/** A million seeds of the simulator, for the nightly run (docs/sync-v2.md section 12).
 *
 *  In chunks, so a run shows how far it got, and from a starting seed that is the day's
 *  number, so every night walks seeds no night walked before. A failure names its seed;
 *  `simulate({ seed, watch })` replays it and follows a marker through it. */

import { describe, expect, test } from 'vitest'
import { simulate } from './run'

const SEEDS = 1_000_000
const CHUNK = 10_000
const START = Math.floor(Date.now() / 86_400_000) * SEEDS

describe('nightly walks', () => {
  for (let chunk = 0; chunk < SEEDS / CHUNK; chunk++) {
    const from = START + chunk * CHUNK
    test(`seeds ${String(from)} to ${String(from + CHUNK - 1)}`, async () => {
      const failed: string[] = []
      for (let seed = from; seed < from + CHUNK && failed.length < 5; seed++) {
        const report = await simulate({ seed })
        if (report.failures.length)
          failed.push(`seed ${String(seed)}: ${report.failures.join('; ')}`)
      }
      expect(failed).toEqual([])
    })
  }
})
