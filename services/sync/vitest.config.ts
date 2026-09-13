import { defineConfig } from 'vitest/config'

export default defineConfig({
  /** What a recovery code costs to hash, turned down for the tests and nowhere else.
   *
   *  The number the Worker uses is a constant in src/second.ts and a test asserts it;
   *  this is how the file that enrols a hundred times over runs in seconds rather than
   *  minutes. Here rather than in the source because a build is the one thing a running
   *  Worker cannot talk to: wrangler defines nothing, so the name does not exist in a
   *  deployed bundle. See `recoveryCost`. */
  define: { __TESTING__: 'true' },
  test: {
    // Vitest's default is five seconds, which is a wall-clock budget and nothing
    // else. A handful of these tests do a great deal of honest work against the
    // real SQL - the ceilings in particular make a couple of hundred notes and
    // then share every one of them, one request at a time, because what they are
    // about is the number the service refuses at. Alone that is a second or two;
    // run beside the rest of the suite over whatever cores are left, five seconds
    // is close enough to fail a test that has found nothing wrong. The counts and
    // the statuses they assert are what says whether they are right, and none of
    // them is about how long anything took.
    testTimeout: 30000,
    // And the same for the setup they share: every file builds a database and runs
    // every migration into it in `beforeEach`.
    hookTimeout: 30000,
  },
})
