import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    // The Linux tests start real shells, vim and a fork bomb, and wait on them; what
    // they assert is what the screen holds, never how long it took to get there.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
