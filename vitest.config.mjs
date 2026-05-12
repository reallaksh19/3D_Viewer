import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'viewer/tests/**/*.test.js',
      'viewer/tests/**/*.spec.js'
    ],
    environment: 'node',
    globals: false,
    passWithNoTests: false,
    reporters: ['default'],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    restoreMocks: true,
    clearMocks: true
  }
});