import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  resolve: {
    alias: {
      react: new URL('../web/node_modules/react', import.meta.url).pathname,
      'react-dom': new URL('../web/node_modules/react-dom', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    passWithNoTests: false,
  },
});
