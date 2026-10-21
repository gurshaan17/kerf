/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

import type { KerfBridge } from '../shared/contracts';

declare global {
  interface Window {
    kerf: KerfBridge;
  }
}

declare module '*.css';

export {};
