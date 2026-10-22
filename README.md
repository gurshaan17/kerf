# Kerf

Kerf is a local-first desktop video editor built with **Electron**, **React**,
**TypeScript**, and **SQLite**. Projects, source footage, and generated media
stay on this machine; there is no account, cloud service, or API key to set up.

Kerf is under active development. The foundation, project model, media ingest,
and footage-bin surfaces are working. Timeline editing, chat and agent tools,
analysis, motion, and export are not implemented yet.

## Current status

Working today:

- Create, open, rename, delete, and reveal projects from the project browser.
- Persist project documents, assets, jobs, and an append-only edit log in SQLite.
- Import footage through the native file picker with duplicate detection.
- Detect `ffmpeg` and `ffprobe`, probe media, and generate proxies,
  thumbnails, and waveforms.
- Run ingest work through a persistent background job queue with progress and
  cancellation that survives an app restart.
- Browse imported assets in the footage bin, including previews, durations,
  search, status, and source details.
- Detect missing media and relink it from the footage bin.
- Use the shared Tailwind-based UI primitives and bundled local fonts.

Still ahead:

- Timeline editing, playback, and the preview compositor.
- Chat, agent tools, and MCP integration.
- Transcript, scene, beat, reference, and motion analysis.
- Export presets and rendering.

## Requirements

- Node.js 20 or newer
- pnpm 10.14 (the repository pins the version through `packageManager`)
- FFmpeg and `ffprobe`

Kerf searches `PATH` and common install locations such as `/opt/homebrew/bin`,
`/usr/local/bin`, and `/opt/local/bin`. If your binaries live somewhere else,
point Kerf at them:

```bash
KERF_FFMPEG_PATH=/path/to/ffmpeg \
KERF_FFPROBE_PATH=/path/to/ffprobe \
pnpm start
```

## Getting started

```bash
corepack enable
pnpm install
pnpm start
```

`pnpm start` runs the Electron Forge development loop. Vite serves the
renderer with hot module replacement while the main and preload processes are
rebuilt on change.

## Local data

By default, Kerf stores projects in the platform Videos folder:

```text
<videos>/Kerf Projects
```

On macOS this is `~/Movies/Kerf Projects`. The SQLite database lives in the
Electron user-data directory as `kerf.db`.

Both locations can be overridden for testing or development:

| Variable             | Purpose                              |
| -------------------- | ------------------------------------ |
| `KERF_PROJECTS_ROOT` | Directory that holds project folders |
| `KERF_DATABASE_PATH` | Path to the SQLite database file     |

## Scripts

| Command              | What it does                                       |
| -------------------- | -------------------------------------------------- |
| `pnpm start`         | Run the app in development with HMR                |
| `pnpm package`       | Build an unpackaged app into `out/`                |
| `pnpm make`          | Build platform distributables                      |
| `pnpm lint`          | Run oxlint and check formatting with oxfmt         |
| `pnpm lint:fix`      | Apply lint fixes and rewrite formatting            |
| `pnpm typecheck`     | Type-check the whole workspace with `tsc --noEmit` |
| `pnpm test`          | Run the Vitest suite once                          |
| `pnpm test:watch`    | Run Vitest in watch mode                           |
| `pnpm test:coverage` | Run the suite with V8 coverage                     |
| `pnpm audit:names`   | Run the clean-room provenance guard                |
| `pnpm clean`         | Remove `out/` and `.vite/` build artifacts         |

## Architecture

```text
src/
  main/       Electron main process: database, projects, media, jobs, IPC
  preload/    Narrow contextBridge surface exposed as window.kerf
  renderer/   React screens and app state
  shared/     IPC contracts shared across processes
packages/
  model/      Project documents, assets, commands, and validation
  engine/     Pure edit application, inverses, queries, snapping
  ui/         Tailwind theme, fonts, primitives, and studio shell
  agent/      Reserved package placeholder
  canvas/     Reserved package placeholder
  motion/     Reserved package placeholder
  tools/      Reserved package placeholder
scripts/      Provenance audit and utility scripts
```

The main process owns project state. The renderer requests changes over a typed
IPC bridge instead of opening the database or filesystem directly. Every edit
is represented as a command, applied by the pure engine package, and recorded
in the edit log so undo and redo share one path.

SQLite migrations are versioned and applied at startup. Ingest jobs are stored
in the same database, which lets interrupted work resume after a restart.

## Security defaults

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`, and
`sandbox: true`. The preload script exposes only the allowlisted `window.kerf`
API. The app also enforces a Content-Security-Policy, blocks unexpected
navigation and window creation, and serves generated media through the custom
`kerfmedia://` protocol.

## Quality checks

Every change is expected to pass:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm audit:names
```

CI runs the same commands on pushes to `main` and on pull requests. The Vitest
suite covers the model, engine, database, project repository, media pipeline,
job queue, and IPC contracts.

## Packaging

`pnpm make` produces platform installers in `out/make`. Builds are unsigned by
default; add code-signing credentials before distributing.
