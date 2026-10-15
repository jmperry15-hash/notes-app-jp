import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    // Gives Dexie an in-memory IndexedDB before any test module loads.
    setupFiles: ['fake-indexeddb/auto'],
  },
});
