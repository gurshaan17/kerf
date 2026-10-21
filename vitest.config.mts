import { defineConfig } from 'vitest/config';
import { kerfAliases } from './vite.shared.mts';

export default defineConfig({
  resolve: {
    alias: kerfAliases,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'packages/**/*.test.ts'],
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/test-fixtures.ts'],
      reporter: ['text'],
      thresholds: {
        statements: 85,
        branches: 80,
        functions: 85,
        lines: 85,
      },
    },
  },
});
