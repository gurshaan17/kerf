# Kerf

Kerf is a local-first desktop video editor. It runs on **Electron**, **React**,
**TypeScript**, and **SQLite**. Projects, source media, analysis, and exports
stay on your machine. There is no account, no hosted workspace, and no
automatic cloud fallback.

Kerf also exposes its editing tool catalog to a built-in chat assistant and to
MCP clients. Every edit is a typed command with an inverse, so mouse edits,
agent edits, and MCP edits share one undo history.

## What works

- **Projects.** Create, open, rename, delete, and reveal projects from a
  project browser. Project documents, assets, jobs, and the edit log live in
  SQLite.
- **Ingest.** Import video, audio, and images with the native picker. Kerf
  probes media, detects duplicate files, generates proxies, thumbnails, and
  waveforms in a persistent background queue, and can relink missing sources.
- **Timeline.** Video, audio, caption, and text tracks with drag and drop,
  move, trim, split, ripple delete, snapping, markers, and undo/redo. The tool
  catalog adds slip, speed maps, and batched edits.
- **Preview.** A canvas compositor renders transforms, effects, masks, blend
  modes, fades, keyframes, text, captions, and saved motion compositions.
- **Analysis.** Local transcription through `whisper.cpp`, scene detection,
  beat detection, and full-text search over transcripts and scene
  descriptions. Vision descriptions are optional and require a provider you
  configure.
- **References.** Profile a reference clip for shot rhythm, palette, and
  colour statistics, then apply its look and pacing to the edit. Reference
  media is measured only; it never enters the timeline, preview, or export.
- **Chat and tools.** A built-in assistant uses the same tool catalog as MCP.
  Providers are opt-in: OpenAI, Anthropic, Google Gemini, xAI, Ollama, and
  OpenAI-compatible local endpoints.
- **MCP.** A loopback-only MCP server exposes the tool catalog to external
  clients. It is disabled by default and protected by a bearer token stored in
  the OS credential store.
- **Export.** Render a frame range from the open preview, encode with
  `ffmpeg`, mix timeline audio, and write an MP4. Export presets cover sequence
  size, 1080p, 720p, and vertical 1080p. The timeline can also be exported as
  OpenTimelineIO.

## Requirements

- Node.js 20 or newer
- pnpm 10.14 (pinned through `packageManager`)
- `ffmpeg` and `ffprobe`
- `whisper.cpp` and a model for transcription
- macOS for the currently tested path; the code is written to run on other
  desktop platforms but has not been exercised there yet

Kerf looks for `ffmpeg`, `ffprobe`, and `whisper-cli` on `PATH` and in common
install locations such as `/opt/homebrew/bin`, `/usr/local/bin`, and
`/opt/local/bin`. Override them with the environment variables below.

On macOS:

```sh
brew install ffmpeg whisper-cpp
```

## Quick start

```sh
corepack enable
pnpm install
pnpm start
```

`pnpm start` runs the Electron Forge development loop. Vite serves the
renderer with hot module replacement while the main and preload processes are
rebuilt on change.

## Local data

By default, projects live in the platform Videos folder:

```text
<videos>/Kerf Projects
```

On macOS that is `~/Movies/Kerf Projects`. The SQLite database lives in the
Electron user-data directory as `kerf.db`. Each project gets its own folder:

```text
<project>/
  assets/                 Reserved for project-local asset files
  analysis/               Transcript work files and keyframes
  cache/proxies/          Editing proxies
  cache/thumbnails/       Footage thumbnails
  cache/waveforms/        Waveform images
  exports/                Rendered MP4s
```

Source media is referenced where it already lives; Kerf does not move or copy
your camera files. If a source moves, use **Relink** in the footage bin.

Deleting a project from the project browser removes its folder and database
rows, including generated proxies. It never deletes your source footage.

## Configuration

| Variable             | Purpose                                                |
| -------------------- | ------------------------------------------------------ |
| `KERF_PROJECTS_ROOT` | Directory that holds project folders                   |
| `KERF_DATABASE_PATH` | Path to the SQLite database file                       |
| `KERF_FFMPEG_PATH`   | Path to the `ffmpeg` binary                            |
| `KERF_FFPROBE_PATH`  | Path to the `ffprobe` binary                           |
| `KERF_WHISPER_PATH`  | Path to the `whisper-cli` binary                       |
| `KERF_USER_DATA`     | Override Electron user-data (used by end-to-end tests) |
| `KERF_E2E`           | Enable test-only service hooks                         |
| `KERF_PERF`          | Print startup and render timings                       |

Example:

```sh
KERF_FFMPEG_PATH=/usr/local/bin/ffmpeg \
KERF_FFPROBE_PATH=/usr/local/bin/ffprobe \
KERF_WHISPER_PATH=/usr/local/bin/whisper-cli \
pnpm start
```

## Scripts

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `pnpm start`         | Run the app in development with HMR                    |
| `pnpm build:app`     | Build Electron bundles into `.vite/` without packaging |
| `pnpm package`       | Build an unpackaged app into `out/`                    |
| `pnpm make`          | Build platform distributables                          |
| `pnpm lint`          | Run oxlint and check formatting with oxfmt             |
| `pnpm lint:fix`      | Apply lint fixes and rewrite formatting                |
| `pnpm typecheck`     | Type-check the whole workspace with `tsc --noEmit`     |
| `pnpm test`          | Run the Vitest suite once                              |
| `pnpm test:watch`    | Run Vitest in watch mode                               |
| `pnpm test:coverage` | Run the suite with V8 coverage                         |
| `pnpm test:e2e`      | Build the app and run Playwright Electron tests        |
| `pnpm perf`          | Run the end-to-end journey with performance logging    |
| `pnpm audit:names`   | Run the clean-room provenance guard                    |
| `pnpm clean`         | Remove `out/` and `.vite/` build artifacts             |

`pnpm test:e2e` and `pnpm perf` need `ffmpeg`, `ffprobe`, `whisper-cli`, and
the macOS `say` command. The tiny Whisper model and caption fixture are cached
under `.cache/e2e/` and ignored by git.

## Documentation

- [Architecture](docs/architecture.md) — processes, data flow, packages, and
  storage.
- [Decisions](docs/decisions.md) — the choices that shape the editor.
- [Tools](docs/tools.md) — the agent and MCP tool catalog.
- [Performance](docs/performance.md) — measured targets and methodology.
- [Visual narration](docs/visual-narration.md) — generate and review text from silent footage.
- [Contributing](CONTRIBUTING.md) — setup, tests, and review expectations.
- [Privacy](PRIVACY.md) — what stays local and when the network is used.
- [Third-party notices](THIRD_PARTY_NOTICES.md) — bundled and invoked
  dependencies.

## Quality checks

Every change is expected to pass:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm audit:names
```

CI runs the same checks on pushes to `main` and on pull requests. A separate
macOS job runs `pnpm test:e2e` with real `ffmpeg` and `whisper.cpp`. The
Playwright suite covers the project browser, the full edit journey
(create → import → cut → caption → export), and a keyboard-only walkthrough.

## Status

Kerf is under active development. The editing, analysis, chat, MCP, and export
paths are implemented and exercised by tests. Packaging and signing are
deferred: `pnpm make` exists, but no installer is currently produced or
supported. Expect the schema and tool surface to keep moving until the first
tagged release.

## Licence

Kerf is released under the MIT licence. See [LICENSE](LICENSE) and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
