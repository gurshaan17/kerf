# Contributing

Kerf is a local-first desktop editor. Changes should keep the default path
offline, keep edits undoable, and keep the renderer out of the filesystem.

## Setup

Requirements:

- Node.js 20 or newer
- pnpm 10.14
- `ffmpeg` and `ffprobe`
- `whisper.cpp` and a model for transcription
- macOS for the currently tested end-to-end path

```sh
corepack enable
pnpm install
pnpm start
```

`pnpm start` runs Electron Forge with Vite hot module replacement. The main and
preload processes rebuild on change; the renderer updates in place.

## Repository map

```text
src/main/       Electron main process: database, projects, media, jobs, analysis,
                export, agent, MCP, IPC, security
src/preload/    Narrow contextBridge surface (window.kerf)
src/renderer/   React screens, store, timeline, preview, inspector, dialogs
src/shared/     IPC contracts and pure export planning
packages/model/ Zod schemas and constructors
packages/engine/ Pure edit application, inverses, history, queries, snapping
packages/canvas/ Canvas compositor
packages/motion/ Motion scene policy, interpreter, and renderer
packages/tools/  Agent and MCP tool catalog
packages/agent/  System prompt and provider adapters
packages/ui/     Tokens, fonts, primitives, studio shell
test/e2e/        Playwright Electron tests and fixtures
```

The main process owns state and I/O. If a change needs SQLite, a file, a child
process, or a provider key, it belongs in `src/main`, behind an IPC contract.
The renderer should request changes and render snapshots.

## The gate

Run this before every commit:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm audit:names
```

For UI, timeline, IPC, media, analysis, export, or tool changes, also run:

```sh
pnpm test:e2e
```

`pnpm test:coverage` is useful when adding logic. Coverage is not a gate, but
new branches should have tests.

CI runs the same gate on Ubuntu and the E2E suite on macOS. A change that only
passes locally because of a cached binary or model is not done.

## Testing

### Unit tests

Vitest covers the model, engine, database, repository, job queue, media
argument builders, analysis helpers, tool catalog, renderer store, and IPC
contracts. Tests live beside the code as `*.test.ts`.

Good tests for this codebase:

- Model schema: valid and invalid documents, defaults, and migrations.
- Engine: apply a command, assert the new sequence, assert the inverse restores
  it. Every edit needs an inverse test.
- Repository: round-trip payloads and verify transactions.
- Tools: happy path, clean error, and actor attribution.
- Renderer store: state transitions without mounting the whole app.

### End-to-end tests

`pnpm test:e2e` builds the Electron bundles and launches the real app through
Playwright. Each test gets a temporary user-data directory, projects root, and
SQLite database. The caption journey uses a real `whisper.cpp` binary and the
tiny model; do not replace it with a fake CLI.

Prerequisites:

```sh
brew install ffmpeg whisper-cpp
```

The first run downloads `ggml-tiny.bin` into `.cache/e2e/` and generates a
caption fixture with the macOS `say` command. Both are ignored by git. If the
model download is interrupted, delete `.cache/e2e/ggml-tiny.bin.part` and run
again.

Useful environment variables:

| Variable             | Purpose                                         |
| -------------------- | ----------------------------------------------- |
| `KERF_E2E=1`         | Enables test-only service hooks                 |
| `KERF_USER_DATA`     | Temporary Electron user-data directory          |
| `KERF_DATABASE_PATH` | Temporary SQLite database                       |
| `KERF_PROJECTS_ROOT` | Temporary projects folder                       |
| `KERF_FFMPEG_PATH`   | Explicit `ffmpeg` binary                        |
| `KERF_FFPROBE_PATH`  | Explicit `ffprobe` binary                       |
| `KERF_WHISPER_PATH`  | Explicit `whisper-cli` binary                   |
| `KERF_PERF=1`        | Print startup, ingest, seek, and export timings |

The test hook `globalThis.__kerfServices` exists only when `KERF_E2E=1`. Do not
use it in production code.

### Manual smoke

Before a UI-heavy change, run `pnpm start` and walk the path:

1. Create a project.
2. Import a short clip and wait for `Ready`.
3. Drag it to the timeline, split it, and undo/redo.
4. Transcribe it and run `writeCaptions` from chat or MCP.
5. Open the command palette, shortcuts, and About panels from the keyboard.
6. Export two seconds and play the MP4.

## Style

- TypeScript strict mode is on, including `noUncheckedIndexedAccess` and
  `noImplicitOverride`. Avoid `any`; use a schema or a narrow type.
- Use `@kerf/model` schemas at boundaries. Do not hand-parse IPC payloads.
- Keep engine code pure. It must not import Electron, Node filesystem, or
  React.
- Use `@kerf/ui` primitives and tokens. Do not add one-off colours or spacing.
- Interactive controls need hover, focus-visible, and disabled states.
- Keep comments for non-obvious constraints. Do not narrate the code.
- Prefer small, named functions over deep nesting.
- Do not add a dependency for something the platform or an existing package
  already does. Removing a dependency is a good change.

Formatting is oxfmt (`singleQuote`, 80 columns). Linting is oxlint. Run
`pnpm lint:fix` before committing.

## Commits

Use Conventional Commits:

```text
feat(timeline): snap clip edges to markers
fix(export): cancel the encoder when the window closes
docs: describe the tool catalog
test: cover reference look inverses
chore: remove an unused dependency
```

Keep commits focused. A commit should pass the gate on its own. Do not mix a
refactor with a behaviour change unless the refactor is required to make the
change safe.

## Pull requests

A PR should explain:

- The problem and the user-visible result.
- The layer that changed and why it is the narrowest responsible layer.
- The tests that prove it, including E2E when the app path changed.
- Any privacy, security, or local-first implication.
- Any follow-up that is deliberately out of scope.

Screenshots or a short recording help for UI changes. Include the keyboard path
if the change affects focus or shortcuts.

## Security and privacy

- Never send media, transcripts, or project data anywhere without an explicit
  user action and consent.
- Never add an automatic cloud fallback.
- Keep the preload surface fixed. Do not expose `ipcRenderer`, `fs`, or a
  generic invoke.
- Resolve media paths through the project repository; reject traversal.
- Store keys only through `safeStorage`. Do not log secrets.
- Treat agent and MCP output as untrusted input. Validate with schemas.
- If you add a network call, document it in [PRIVACY.md](PRIVACY.md).

## Documentation

Update the relevant page when behaviour changes:

- [README](README.md) for setup, scripts, and user-visible status.
- [Architecture](docs/architecture.md) for process, data, or package changes.
- [Decisions](docs/decisions.md) for a choice that future work should respect.
- [Tools](docs/tools.md) for catalog changes.
- [Performance](docs/performance.md) for measurement changes.
- [Third-party notices](THIRD_PARTY_NOTICES.md) for a new bundled dependency.

## Packaging

Packaging and signing are deferred. `pnpm package` and `pnpm make` exist, but
no installer is currently supported. Do not add release automation or claim a
supported build without a separate packaging decision.
