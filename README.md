# Kerf

A desktop app scaffolded with **Electron Forge**, **Vite**, **React**, and **TypeScript**.

## Getting started

```bash
npm install
npm start
```

`npm start` boots the Forge dev loop: Vite serves the renderer with hot module
replacement while the main and preload processes are rebuilt on change.

## Scripts

| Script              | What it does                                     |
| ------------------- | ------------------------------------------------ |
| `npm start`         | Run the app in development with HMR              |
| `npm run package`   | Build an unpackaged app into `out/`              |
| `npm run make`      | Build distributables (Squirrel, ZIP, deb, rpm)   |
| `npm run lint`      | Lint with oxlint and check formatting with oxfmt |
| `npm run lint:fix`  | Apply lint fixes and rewrite formatting          |
| `npm run typecheck` | Type-check the whole project with `tsc --noEmit` |

## Project layout

```
src/
  main.ts          Main process — creates the BrowserWindow, app lifecycle
  preload.ts       Preload script — exposes a narrow API via contextBridge
  renderer.tsx     Renderer entry — mounts the React app
  App.tsx          Root React component
  index.css        Global styles
  declarations.d.ts  Vite env types and the window.kerf API contract
forge.config.mts   Forge makers, Vite plugin, and Electron fuses
vite.*.config.mts  Per-process Vite configs (main, preload, renderer)
index.html         Renderer HTML shell and CSP
```

## Security defaults

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. Anything the UI needs from the main process must be exposed
explicitly in `src/preload.ts` through `contextBridge`, and typed in
`src/declarations.d.ts`.

A Content-Security-Policy is set in `index.html`. Adjust it deliberately if you
add remote assets, and keep `script-src` free of `'unsafe-eval'`.

## Packaging

`npm run make` produces platform installers in `out/make`. Builds are unsigned
by default; add code-signing credentials before distributing.
