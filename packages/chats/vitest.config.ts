import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Every property starts from one seed, so a failure on CI is the same failure here.
    setupFiles: ['src/seeded.ts'],
  },
})
