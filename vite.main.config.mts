import { defineConfig } from 'vite';
import { kerfAliases } from './vite.shared.mts';

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: kerfAliases,
  },
});
