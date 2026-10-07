/** Every fast-check property in this package starts from one fixed seed, as
 *  sync-core's do, so a counterexample found on CI replays here. */

import fc from 'fast-check'

fc.configureGlobal({ seed: 20261007 })
