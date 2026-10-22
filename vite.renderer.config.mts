import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { kerfAliases } from './vite.shared.mts';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react(), tailwindcss()],
  html: {
    cspNonce: 'kerf-motion-bootstrap',
  },
  resolve: {
    alias: kerfAliases,
  },
});
