# Architecture

Kerf is one Electron application with a strict split between the main process,
a narrow preload bridge, and a React renderer. The main process owns state and
I/O. The renderer owns presentation and interaction. The shared packages hold
pure logic that both sides can test without Electron.

```text
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React, Zustand, canvas)                            │
│  project browser · timeline · preview · inspector · dialogs  │
└──────────────────────────────┬───────────────────────────────┘
                               │ window.kerf (typed IPC)
┌──────────────────────────────┴───────────────────────────────┐
│ Preload (contextBridge)                                      │
└──────────────────────────────┬───────────────────────────────┘
                               │ ipcMain handlers
┌──────────────────────────────┴───────────────────────────────┐
│ Main process                                                 │
│  ProjectService · JobQueue · MediaImportService              │
│  AnalysisService · ExportService · ToolService               │
│  AgentService · McpService · SQLite · filesystem             │
└──────────────────────────────────────────────────────────────┘
```

## Process model

### Main process

`src/main/main.ts` registers the `kerfmedia` scheme and navigation guards,
opens the database, constructs every service, registers IPC, creates the
window, and then starts background work. The job queue and MCP listener start
on the next tick so the project browser can paint first.

The main process is the only place that opens SQLite, reads or writes project
files, spawns `ffmpeg` or `whisper-cli`, or holds provider keys. It broadcasts
project, job, export, and chat events to every renderer through
`broadcastEvent`.

### Preload

`src/preload/preload.ts` exposes a fixed `window.kerf` object. It is an
allowlist of methods, not a generic `ipcRenderer` escape hatch. Contracts live
in `src/shared/contracts.ts` and are shared by the preload, the main process,
and the renderer.

### Renderer

The renderer is a React application. `StudioProvider` creates a Zustand store
that mirrors the open project snapshot, selections, playhead, tools, toasts,
exports, and chat state. Components subscribe to the smallest slice they need.
The timeline and preview share the same sequence document, so an edit appears
in both without a second source of truth.

The renderer also hosts the canvas compositor and the export frame renderer.
That keeps preview and export on the same drawing code. The main process asks
the renderer for frames over a request/response bridge
(`RendererRequestHost`), and the renderer asks the main process to write and
encode them.

### Security defaults

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Navigation, popups, and webviews are denied.
- A Content-Security-Policy allows local scripts, styles, fonts, images, and
  media only. Development adds the Vite websocket origin.
- Media reaches the renderer through `kerfmedia://`, which resolves paths
  against the open project and rejects traversal.
- API keys and the MCP bearer token are encrypted with Electron
  `safeStorage`. Kerf refuses to store either in plain text.

## Packages

| Package            | Responsibility                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- |
| `@kerf/model`      | Zod schemas and constructors for projects, sequences, clips, analysis, compositions, and commands |
| `@kerf/engine`     | Pure edit application, inverses, history, queries, ranges, snapping, ripple logic                 |
| `@kerf/canvas`     | Canvas compositor for clips, text, captions, masks, effects, and fades                            |
| `@kerf/motion`     | Motion scene schema, policy validation, interpretation, and rendering                             |
| `@kerf/tools`      | The tool catalog and its typed context                                                            |
| `@kerf/agent`      | System prompt and provider adapters                                                               |
| `@kerf/ui`         | Design tokens, bundled fonts, primitives, and the studio shell                                    |
| `@kerf/mcp-bridge` | Stdio-to-loopback bridge for MCP clients                                                          |

`src/main` contains Electron-facing services. `src/renderer` contains screens
and state. `src/shared` contains contracts and pure export planning.

## Edit flow

Every mutation follows the same path, whether it comes from a button, a
keyboard shortcut, the assistant, or an MCP client:

1. The renderer builds a typed `EditCommand`.
2. `window.kerf.projects.apply` sends it to the main process.
3. `ProjectService.apply` validates the command with the model schema.
4. `@kerf/engine` applies it to the sequence and returns the inverse command.
5. The repository writes the new project snapshot and appends an edit-log row
   in one SQLite transaction.
6. `ProjectService` records the command and inverse in the in-memory history.
7. The new `ProjectSnapshot` is broadcast to renderers.
8. The store replaces its snapshot; timeline, preview, and inspector update.

Undo and redo use the same path with the recorded inverse. There is one undo
stack, owned by `ProjectService`. `applyBatch` and the macros record several
commands as one history entry so a single Undo reverses the whole group.

Actors are explicit: `user`, `agent`, `mcp`, or `system`. The edit log keeps the
actor and label, which is why an MCP edit can be attributed and undone in the
editor.

## Storage

SQLite is the index, the job queue, and the audit trail. The project document
itself is stored as validated JSON so nested model changes do not require a
column for every field.

| Table                | Contents                                               |
| -------------------- | ------------------------------------------------------ |
| `projects`           | Summary columns plus the full project document         |
| `assets`             | Source path, media metadata, cache paths, status       |
| `transcripts`        | Transcript payload and indexed text                    |
| `scenes`             | Scene ranges, descriptions, confidence                 |
| `beat_maps`          | Tempo, beats, sections                                 |
| `edit_log`           | Append-only command and inverse history                |
| `jobs`               | Persistent queue with payload, stage, progress, cancel |
| `exports`            | Export records and output paths                        |
| `reference_profiles` | Measured reference statistics                          |
| `compositions`       | Saved motion compositions                              |
| `provider_accounts`  | Provider settings and encrypted keys                   |
| `app_settings`       | Chat provider, MCP settings, and other small settings  |
| `transcript_fts`     | FTS5 index over transcript segments                    |
| `scene_fts`          | FTS5 index over scene descriptions                     |

Migrations are versioned and run at startup. FTS5 is optional: if the virtual
tables cannot be created, search falls back to `LIKE` queries.

Project folders contain generated media only:

```text
<project>/
  assets/                 Reserved for project-local asset files
  analysis/               Whisper work files and scene keyframes
  cache/proxies/          Editing proxies
  cache/thumbnails/       Thumbnails
  cache/waveforms/        Waveform images
  exports/                MP4 output
```

Source media stays where the user keeps it. The asset row stores an absolute
path, size, mtime, and content hash. Duplicate imports are detected by path,
size/mtime, and hash. A missing source is marked `missing` and can be relinked.

## Media pipeline

1. The native file picker returns paths.
2. Import validates the file type, hashes the file, and inserts an asset row.
3. An `ingest` job probes the file with `ffprobe`.
4. Video gets a 720p H.264 proxy and a thumbnail.
5. Audio gets a waveform; images get a thumbnail.
6. The asset moves through `queued`, `probing`, `processing`, `ready`, or
   `error`. Progress is persisted, so an interrupted app resumes queued work.

The job queue is a SQLite table with registered handlers. Cancellation is a
flag in the database and an `AbortSignal` in the running handler. Jobs that
were running when the app quit are recovered on the next start.

## Preview and compositing

`@kerf/canvas` draws the sequence at a frame:

- Tracks are composited in order, bottom to top.
- Video and image clips are drawn with fit, transform, opacity, fades, effects,
  masks, and blend modes.
- Text and caption clips are laid out with the bundled fonts and style tokens.
- Saved motion compositions are evaluated to a scene tree and rendered on top.
- The media pool keeps detached video and image elements for visual assets,
  falls back from a proxy to the source, and reports missing sources instead of
  throwing.

The export renderer uses the same compositor at the target resolution. The
renderer writes PNG frames in bounded batches, and the main process writes each
batch and runs one `ffmpeg` pass for video plus the timeline audio mix.

## Analysis

- **Transcription** runs `whisper.cpp` locally with a model the user downloads
  into the app's user-data folder. Audio is extracted with `ffmpeg`, then
  segmented into timed words and segments.
- **Scenes** use `ffmpeg` scene detection and extract keyframes into the
  project folder.
- **Beats** decode audio and detect tempo, beats, and sections locally.
- **Vision** is optional. It sends only selected keyframes and a prompt to the
  provider the user enabled and consented to.
- **Search** indexes transcript segments and scene descriptions in SQLite FTS5.
  Embeddings are not implemented; lexical search remains available and the UI
  reports the limitation.

Provider accounts are per-account opt-ins. Vision consent and chat consent are
separate. There is no automatic provider selection for vision and no fallback
to a different provider on failure. Google accounts default to
`gemini-3.8-flash` and use the SDK's Interactions API.

## Tools, agent, and MCP

`@kerf/tools` defines one catalog with Zod input and output schemas, a
description, and a `readOnly` flag. `ToolService` supplies the project
snapshot, editor context, edit application, search, renderer bridge, export
access, and analysis callbacks.

The built-in agent and the MCP server both consume the same registry. The
agent adds a system prompt that requires reading before writing and verifying
after every edit. MCP adds loopback transport, bearer-token authentication,
per-session transports, and an activity log.

The MCP server listens on `127.0.0.1` only, is disabled by default, and uses a
token stored with `safeStorage`. Tool calls are attributed to the `mcp` actor
and remain undoable.

## Export

`ExportService` owns one export at a time:

1. Resolve the preset and clamp the frame range to the sequence.
2. Create an export record and a temporary frame directory.
3. Ask the renderer to composite and return PNG frames in batches.
4. Write the frames and build the audio plan.
5. Run `ffmpeg` to encode H.264 video and the mixed audio.
6. Mark the record `succeeded`, `failed`, or `cancelled`.

Export records survive restarts. The UI reports progress, the output path, and
errors from the record rather than guessing.

OpenTimelineIO export writes the timeline structure with explicit gaps and
markers, using external references to the original media.

## Testing

- **Vitest** covers the model schemas, engine commands and inverses, database
  and repository, job queue, media argument builders, analysis helpers, tool
  catalog, renderer store, and IPC contracts.
- **Playwright Electron** launches the real app with a temporary user-data
  directory and projects root. It covers the project browser, a full edit
  journey (create, import, cut, transcribe, caption, export), and a
  keyboard-only walkthrough.
- **Performance** is measured with `KERF_PERF=1` on a reference machine and
  documented in [performance.md](performance.md). Numbers are a regression
  signal, not a CI gate.

Test-only hooks (`KERF_E2E`, `KERF_USER_DATA`, and `globalThis.__kerfServices`)
exist so the end-to-end suite can inspect services without weakening the
production preload surface.

## Extension points

- Add a model field: update the Zod schema and constructor in `@kerf/model`,
  then the engine and renderer as needed. Payload columns keep old rows
  readable.
- Add an edit: define the command in `@kerf/model`, apply it in
  `@kerf/engine` with an inverse, and expose it through the editor commands or
  tool catalog.
- Add a tool: define it with `defineTool` in `@kerf/tools`, add it to
  `TOOL_DEFINITIONS`, and cover it with a test. Chat and MCP pick it up
  automatically.
- Add a provider: extend `ProviderKind`, the adapter in `@kerf/agent`, the
  settings UI, and the provider store.
- Add a panel: compose primitives from `@kerf/ui` and keep state in the studio
  store or a local hook. Do not open SQLite or the filesystem from the
  renderer.
