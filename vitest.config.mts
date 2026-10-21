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
  },
});
