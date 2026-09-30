import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // The properties try each rule on a thousand notes, and the simulator walks a
    // thousand seeds. Alone that is seconds; beside the rest of the suite over what
    // cores are left, five is close enough to fail a test that found nothing wrong.
    // What the tests assert is whether the rules hold, never how long they took.
    testTimeout: 120_000,
    // Every property starts from one seed, so a run on CI is the same run every time
    // and a failure there is a failure here. The nightly run (`sim:long`) is where
    // the new seeds are tried.
    setupFiles: ['test/seeded.ts'],
  },
})
