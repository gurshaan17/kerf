import { defineConfig } from 'vite';
import { kerfAliases } from './vite.shared.mts';

// Native and process-launching dependencies must stay outside the bundle so
// Electron can resolve their prebuilt binaries from node_modules.
const external = ['better-sqlite3', 'electron-squirrel-startup'];

export default defineConfig({
  resolve: {
    alias: kerfAliases,
  },
  build: {
    rollupOptions: {
      external,
    },
  },
});
