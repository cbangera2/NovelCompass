import { defineConfig } from 'vitest/config';

// Pure-logic tests that live next to the code they cover. The extension has its own config and suite.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
