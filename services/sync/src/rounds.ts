/** What a PBKDF2 derivation costs here: the real number of rounds, or a few under test.
 *
 *  What a test about a ceiling on guesses counts is tries, not seconds. A file that
 *  spends a hundred derivations at the real cost is minutes of a machine doing
 *  arithmetic nothing is measuring, and on a loaded one a timeout: a site's password
 *  tried twenty-one times took four and a half seconds alone and past thirty beside
 *  two other gates.
 *
 *  A question about the build and about nothing that runs. It replaced an exported
 *  setter over a module `let`: anything in the bundle could have called it at any
 *  moment, and every hash written afterwards, for the life of the isolate, would have
 *  been made at whatever it said. Not a binding on the environment either: a binding
 *  is configuration, and a deploy that mistyped one would weaken every hash at rest
 *  without anybody writing a line of code. A cost is not configuration. */

/** Whether the test runner built this. Defined by services/sync/vitest.config.ts and
 *  by nothing else - wrangler defines nothing - so in a deployed Worker the name does
 *  not exist at all and `typeof` is what says so. */
declare const __TESTING__: boolean | undefined

/** What the tests hash at. */
const UNDER_TEST = 200

/** `real` rounds, or `UNDER_TEST` in a build the test runner made. */
export function rounds(real: number): number {
  return typeof __TESTING__ !== 'undefined' && __TESTING__ ? UNDER_TEST : real
}
