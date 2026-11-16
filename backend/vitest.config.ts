import { defineConfig } from 'vitest/config';

// Integration tests share one throw-away database, so files run one after another.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
