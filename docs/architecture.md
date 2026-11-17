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

When a timed overlay is active, the compositor switches to explicit phases:
background, base clips, effects, deferred text and captions, then the selection
outline. Text and captions are deferred so overlays can never blur or magnify
them. A zoom lens repaints the backdrop beneath the lens before redrawing the
non-text layers it intersects.

The export renderer uses the same compositor at the target resolution. The
renderer writes PNG frames in bounded batches, and the main process writes each
batch and runs one `ffmpeg` pass for video plus the timeline audio mix.

## Timed effect overlays

Blur, callout, spotlight, and magnifier-zoom overlays are `fxOverlay` clips on
a dedicated effects track rather than properties of a footage clip. Each overlay
stores a normalized canvas region plus its own start frame and duration, so it
can extend past its source and survive trimming.

- The effects track is created lazily by the first overlay and is metadata-only:
  it has no media and no runtime, and overlays do not extend the sequence
  duration. The timeline's scroll extent does include them.
- Regions and points are normalized to the canvas; absolute sizes such as blur
  radius and font size are in 1080p-height units, so preview and export match at
  any output resolution.
- A linked overlay follows its source on move, ripple, remove, clone, split, and
  track removal. Trim, slip, speed, and time-map edits do not move it; dragging
  it fully off its source unlinks it in one undo step.
- `props` is a discriminated union patched with deep merge. Dragging a handle
  dispatches exactly one `clip.update` on pointer release, so a drag is one
  history entry.
- Preview uses proxies, but export and single-frame captures use source
  quality. An active zoom lens also requests source quality in the preview.

Text and captions always composite above overlays. Overlay handles live in an
HTML layer above the preview canvas, so they never appear in rendered frames.

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
markers, using external references to the original media. Overlays are exported
as metadata-only `Clip.1` entries with missing references, and overlapping
overlays are lane-packed into separate OTIO tracks. They are excluded from the
exported duration, so an overlay that trails the sequence does not extend it.

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

## Auto cut

`AutoCutService` in the main process coordinates explicit background requests,
local transcription and sampled-frame analysis through the existing provider
store. Proposals live in job results and remain separate from project edits.
The preload exposes only generation, scoped proposal retrieval and application.
The renderer reviews immutable source-frame removals and previews them using
local source media. Apply checks the source/timeline fingerprint, resolves only
stored removal IDs, and uses the pure engine's `autoCutCommand` to create one
ordinary reversible batch. There is no separate editing engine or cloud fallback.
See [Auto cut](auto-cut.md) for the user flow and supported timeline shapes.

## Editing task continuity

Saved chat payloads optionally contain a versioned `editingContext`, scoped to
both the project and conversation. Old conversations start with empty task
context; assistant text is never migrated into edit facts. The existing SQLite
conversation row owns its storage and lifetime; no separate memory database or
provider summarization is used.

The agent retains up to ten tasks and twenty object references per task, along
with bounded command/job/proposal identifiers. It captures the explicit request
(including user constraints), tagged source scope, validated editing results,
and commit receipts. Requested, pending, applied, failed and cancelled work are
separate from turn outcome and verification coverage. Applied work remains
recorded if a later tool, provider call or cancellation ends the turn. Unmet
rough-cut constraints are retained separately. Truncation and omitted history
are marked explicitly.

Each new turn receives at most 8 KiB of serialized task context, prioritizing the
latest output, current request and pending work. Whole records are selected;
identifiers are never cut in half. The context is a navigation aid and untrusted
request/source text remains data. It grants no edit or provider authorization.
Ambiguous output references require clarification and proposal application still
requires the desktop approval path.

On conversation open and before a turn, local editing-review records reconcile
linked desktop approvals. Receipts include post-commit clip/source fingerprints;
changed, deleted, undone or replaced outputs are marked stale against live state.
Older receipts without fingerprints are treated conservatively. Reopening never
starts analysis, calls a provider or applies edits. Project changes stop further
tool dispatch from the old turn. Existing project/job tools remain the retrieval
path for omitted context; this is bounded editing continuity, not personal memory.

Focused deterministic provider/service tests cover commit-before-failure,
database reopen, precise follow-up IDs and stale output handling. Pure context
tests cover compatibility, ownership, source replacement, desktop receipt-time
identity, omission bounds, and exclusion of raw transcript/image results. These
prove workflow behavior; manual editorial baseline measurements remain pending
in the [baseline workbook](ai-editing-baseline-results.md).

### Continuing completed editing jobs

Chat-created editing jobs persist their originating project, conversation, task,
turn, planning tool, and validated planning input in the existing `app_settings`
store beside editing-review state. Ownership is independent of the ten-task
memory window. Reading a job or proposal does not transfer its ownership.

The review UI reconciles queue/review state on events, conversation open, and a
local polling fallback. It shows one card per job in its originating chat;
unowned jobs, including MCP jobs, stay in the existing project review UI.
Interrupted provider work is shown as interrupted using the queue's existing
failed/interrupted records, without implying it resumed after restart.

Review result opens local evidence. Continue with this result submits one normal
user-triggered chat turn with a project/conversation/job reference and a request
ID. The main process checks ownership, current job/proposal eligibility and chat
consent before starting the turn. Continuation allows inspection and desktop
review requests, blocks fresh planning and direct timeline edits, and confines
job-review tools to the selected result. Apply independently revalidates and
retains its existing desktop approval, replay protection and undo behavior.

Reanalyze is explicit and uses the original validated planning request at most
once in its turn. Changed parameters or extra planning calls are rejected. There
is no automatic provider retry on job completion or reopen. Ordinary typed user
requests remain independent and are not globally deduplicated.

Request IDs and claimed turn IDs persist with job ownership, preventing duplicate
continuations across repeated events and reopen. Failed/cancelled turns release
claims for a new deliberate attempt while retaining handled request IDs. Opening
a saved conversation also releases claims left by interrupted turns, entirely
locally. The renderer locks submission synchronously and disables continuation
while another turn runs. Stale sources, revoked analysis consent, failed work and
cancelled proposals expose their reason and an explicit reanalysis path.

The deterministic continuation Electron journey holds an analysis response until
the chat turn ends, switches chats, finishes the job, reopens its originating
chat, double-clicks Continue, and confirms one analysis call, one continuation,
explicit Apply, rejected replay, and exact undo. Service/store tests cover durable
ownership, request replay, consent/stale rejection, explicit reanalysis limits,
and the submission lock. These fixtures do not evaluate editorial judgment.

### Chat drafting, scrolling and submitted scope

The studio store keeps drafts in memory by project and conversation, including
text, source mentions and any explicit scope choice. A new-chat draft moves to
its real conversation ID on `chat.started`. Streaming, completion, cancellation
and panel unmounting preserve the draft; switching chats restores that chat's
own draft. The composer remains editable while busy. Send stays disabled and
Stop remains available; there is no send queue. Failed submission never replaces
a newer draft with the older attempted message.

Chat follows the latest content when the reader is within 64 pixels of the
bottom or submits a message. Reading earlier content preserves scroll position,
including when tool/review content changes size. Jump to latest restores
following. A ResizeObserver handles streamed text, expanded cards and resizing.

Scope chips choose the project, captured clip IDs, and tagged source assets.
Submission validates the target IDs and project revision, and stores the scope
on the turn and linked editing-job origin. Later timeline selection changes do
not change that scope. Empty, missing or explicitly stale targets require a
scope correction; removing the last target never silently grants project scope.
Existing conversations without scope retain project scope for compatibility.

The main process previews ordinary engine commands without mutating the live
project before a scoped edit commits. It rejects changes to unrelated clips,
global sequence/track settings and inserted media outside the permitted source
ranges. Committed output IDs become eligible for further edits in the same turn;
external changes to scoped clips/sources invalidate further edits. Review
requests and desktop Apply use the same command check, preserving ordinary
approval and undo. Supporting project inspection remains available regardless
of edit scope. No additional editing representation or provider call is used.

Contextual actions derive from actual project state: local import for an empty
project, analysis for one supported ready video with the required consent and
speech evidence, local review of completed analysis, or inspection/refinement of
an existing cut. Unsupported analysis and concurrent analysis are not offered.

Deterministic Electron coverage verifies drafting during streaming, completion,
Stop, conversation switching, keyboard activation of Jump to latest, fixed
submitted IDs despite selection changes, rejected out-of-scope edits and stale/
missing selection recovery. Pure/service tests cover command boundaries, atomic
rejection, draft migration and capability-aware starters. Together with the
restart continuity and explicit continuation journeys, these prove the phases
1–3 workflow slice. Manual editorial baseline measurements remain pending in the
[baseline workbook](ai-editing-baseline-results.md); fixture passes do not
establish better editorial judgment.

### Rough-cut proposal playback

Rough-cut reviews offer local sequence playback before Apply. The existing draft
player supports isolated snapshots through an unhydrated studio store; its
implementation now lives in `preview/IsolatedPreview.tsx`. It reuses Preview,
MediaPool and AudioPlayback, including source-frame mapping and synchronized
source-audio clips. No renderer restructuring, temporary live edits, export,
provider call or alternate editing representation is required.

The desktop-only `editing.preview` operation validates the stored proposal and
selected change IDs, enforces its originating scope, builds the ordinary
rough-cut command, and applies it only to an in-memory sequence. It returns an
isolated snapshot and identity bound to the project/source fingerprint and
canonical selected changes. Preview clip/track IDs are ephemeral; Apply builds
and revalidates its own command, producing the same source ranges, ordering,
timing and audio independently of preview availability.

Only one proposal preview is active in the review UI. It starts at the appended
cut and offers playback and a scrubber over the candidate timeline, while source
evidence playback remains in review. The native dialog pauses live playback,
labels the result as not applied and prevents editor shortcuts from changing the
live project. It has no Apply control; approval remains in desktop review.

Preview state stays in memory and creates no rendered-file cache. Its serialized
snapshot is limited to 8 MiB, its decoder input list to forty project assets,
and its lifetime to two minutes. This follows the existing bounded local-render
cache approach, with a single candidate instead of retained frame files. Larger
projects can still use ordinary reviewed Apply. Closing, expiry, project/source
revision changes or changed proposal selections unmount the isolated player,
cancel animation work, and dispose detached audio/video elements. Superseded
build responses are ignored. Source changes outside app metadata are detected
by existing proposal eligibility polling and filesystem fingerprint validation.
No invalidation automatically rebuilds a preview or retries provider work.

Service tests prove no live project/review/undo mutation, selected-range identity,
matching preview/Apply video and audio order, source/project rejection and
resource limits. The rough-cut Electron journey auditions real source audio,
checks direct-close decoder cleanup, selection and source invalidation, expiry,
keyboard isolation, explicit Apply, replay rejection and exact undo. These are
workflow and synchronization checks, not an editorial-quality evaluation.
