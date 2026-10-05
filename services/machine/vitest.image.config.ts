import { defineConfig } from 'vitest/config'

/** The drive of the built image (test/image.sh), which `pnpm test` never runs: it needs a
 *  machine booted from the image, which only CI's machine job makes. */
export default defineConfig({
  test: {
    include: ['test/**/*.drive.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
})
