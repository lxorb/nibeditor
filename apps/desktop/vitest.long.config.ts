import { defineConfig } from 'vitest/config'

/** The engine's long walks: `pnpm --filter @nib/desktop sim:long`, ten thousand seeds in
 *  four files at once; see src/lib/sync2/walks/walk.ts. Not in `pnpm test`. */
export default defineConfig({
  test: {
    include: ['src/lib/sync2/walks/*.long.ts'],
    environment: 'node',
    testTimeout: 0,
  },
})
