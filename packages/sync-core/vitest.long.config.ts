import { defineConfig } from 'vitest/config'

/** The nightly run: `pnpm --filter @nib/sync-core sim:long`. A million seeds of the
 *  simulator, starting from the day's own number so each night walks new ground; a
 *  failing seed is printed and replays with `simulate({ seed })`. Not in `pnpm test`. */
export default defineConfig({
  test: {
    include: ['test/**/*.long.ts'],
    environment: 'node',
    testTimeout: 0,
  },
})
