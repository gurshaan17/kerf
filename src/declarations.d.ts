/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*.css';

interface KerfApi {
  getVersions: () => {
    electron: string;
    chrome: string;
    node: string;
  };
}

interface Window {
  kerf: KerfApi;
}
