import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __BRICKPICK_BUILD_MODE__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environmentMatchGlobs: [
      ['tests/adapters/**', 'jsdom'],
      ['tests/renderer/**', 'jsdom'],
    ],
    reporters: ['default'],
    testTimeout: 30_000,
  },
})
