/** Every fast-check property in this package starts from one fixed seed, so the suite
 *  is the same run on every machine and a counterexample found on CI replays here.
 *  New inputs are the nightly run's business; see vitest.long.config.ts. */

import fc from 'fast-check'

fc.configureGlobal({ seed: 20260930 })
