# Decisions

These are the choices that shape Kerf. Each entry records the context, the
decision, and the consequence we accept. They are not a changelog; update them
when a decision changes.

## 1. Local-first is the default, not a mode

**Context.** Most editing tools assume an account, a hosted library, or a
cloud render. Kerf is built for footage that should not leave the machine.

**Decision.** Projects, source paths, caches, analysis, and exports are local.
There is no account, telemetry, hosted workspace, or automatic cloud fallback.
Network access happens only for an explicit user action: a provider test or
request, a Whisper model download, or an MCP client connecting to the loopback
server.

**Consequence.** Collaboration, hosted sync, and cloud rendering are out of
scope until they can be added without weakening the default. Provider failures
surface as errors; Kerf never silently tries another provider.

## 2. Electron, React, TypeScript, and SQLite

**Context.** Kerf needs a desktop shell, native file pickers, local process
spawning, and a rich timeline UI.

**Decision.** Use Electron with Vite, React, TypeScript, and SQLite
(`better-sqlite3`). Keep the renderer on standard web APIs so the UI and
compositor stay testable without native UI frameworks.

**Consequence.** The app ships a Chromium runtime. Native modules must be
rebuilt for Electron. The main process is the only place with Node access.

## 3. The main process owns state and I/O

**Context.** A renderer with filesystem and database access would widen the
attack surface and make state impossible to reason about.

**Decision.** The main process owns SQLite, project folders, `ffmpeg`,
`whisper.cpp`, provider keys, and the undo stack. The preload exposes a fixed
`window.kerf` API. The renderer asks for changes and renders snapshots.

**Consequence.** Every new capability needs a contract, a preload method, and
an IPC handler. That is deliberate friction.

## 4. Commands with inverses, one undo stack

**Context.** Mouse edits, keyboard edits, macros, the assistant, and MCP all
need to be undoable and attributable.

**Decision.** Every edit is a typed `EditCommand`. `@kerf/engine` applies it and
returns an inverse. `ProjectService` writes the new snapshot and an edit-log
row in one transaction, then records the inverse in memory. Batches and macros
form one history entry.

**Consequence.** New edits must define an inverse and a test. An operation that
cannot be inverted cannot be a normal edit.

## 5. Store the project document as validated JSON

**Context.** The sequence model is nested and still evolving. A fully
normalised schema would force a migration for every clip field.

**Decision.** Store the project document as JSON in `projects.doc_json` and
validate it with Zod on read and write. Store assets, transcripts, scenes,
beat maps, and other collections in indexed tables with a `payload_json`
column for lossless round-trips.

**Consequence.** The database is an index and audit trail, not a second model.
Schema evolution is additive; old rows remain readable.

## 6. Reference source media in place

**Context.** Copying camera files into a project doubles disk use and breaks
the user's existing organisation.

**Decision.** Import stores an absolute source path, size, mtime, and content
hash. Generated proxies, thumbnails, waveforms, keyframes, and exports live in
the project folder. Missing sources are marked and can be relinked.

**Consequence.** Moving or deleting a source breaks the link until the user
relinks it. Duplicate detection uses path, size/mtime, and content hash.

## 7. Serve media through a custom protocol

**Context.** `file://` access from a sandboxed renderer is awkward and easy to
over-grant. The preview and export need to read generated media.

**Decision.** Register a privileged `kerfmedia://` scheme. The handler resolves
asset IDs against the open project, rejects traversal, and serves only known
project files.

**Consequence.** The renderer never receives a general filesystem path API.
Media URLs are stable and testable.

## 8. Persist the job queue in SQLite

**Context.** Ingest and analysis can take minutes. Losing the queue on quit
would leave assets stuck and waste work.

**Decision.** Jobs live in a SQLite table with kind, payload, status, stage,
progress, and cancellation. Handlers register by kind. On startup, jobs left
`running` are reset to `queued`. Cancellation is a database flag plus an
`AbortSignal`.

**Consequence.** Work resumes after a restart. The queue is single-process and
serial; parallelism would need a new scheduling decision.

## 9. Transcribe locally with whisper.cpp

**Context.** Transcripts are the basis for captions, silence cutting, rough
cuts, and search. Sending every clip to a cloud API would break the local-first
default.

**Decision.** Use a user-installed `whisper-cli` binary and a model downloaded
on demand into the app's user-data folder. Model downloads are explicit and
cancellable. The model never ships in the repository.

**Consequence.** Transcription requires a separate binary and model. Missing
pieces produce actionable errors instead of a hidden cloud fallback.

## 10. Cloud vision and chat are per-account opt-ins

**Context.** Some analysis and chat quality benefits from a hosted model. Not
every user wants that traffic.

**Decision.** Provider accounts have separate `visionConsent` and
`chatConsent` flags. Only an enabled, consented provider is used. Keys are
encrypted with the OS credential store. The assistant may not switch providers
or enable a network service on its own.

**Consequence.** The settings surface is larger, and a failed provider does not
fall back. Users can keep everything local with Ollama or an
OpenAI-compatible endpoint.

## 11. Gemini defaults to `gemini-3.8-flash` through the Interactions API

**Context.** Google's model IDs and SDK surfaces change. Accounts created
before a rollout should keep working without manual edits.

**Decision.** The Google adapter defaults to `gemini-3.8-flash` and calls the
SDK's Interactions API. Legacy `gemini-2.0-flash` variants are normalised to
the current default when read.

**Consequence.** Old accounts continue to work. A future model change is a
one-line default update plus tests, not a settings migration.

## 12. One tool catalog for chat and MCP

**Context.** Two separate tool lists would drift in schemas, descriptions, and
safety hints.

**Decision.** `@kerf/tools` is the only catalog. The agent and the MCP server
both read it. Tools declare Zod input/output, a description, and a `readOnly`
flag. The tool service supplies a narrow context rather than exposing services.

**Consequence.** Adding a tool makes it available to both surfaces at once.
Tool authors must think about read-only hints and actor attribution.

## 13. MCP is loopback-only and off by default

**Context.** An editing tool catalog is powerful. Exposing it on a network
interface by default would be irresponsible.

**Decision.** Bind the MCP server to `127.0.0.1`, require a bearer token, and
keep it disabled until the user enables it. The token is encrypted with
`safeStorage`. Each session gets its own transport. The activity log records
tool calls, sessions, and rejected authentication.

**Consequence.** Remote clients need an explicit tunnel or bridge. The stdio
bridge package exists for clients that prefer stdio.

## 14. Reference media is measured, never edited or exported

**Context.** A reference clip is useful for pacing and colour, but it is not
part of the user's story.

**Decision.** Reference analysis stores statistics and a profile. Applying a
look adds effects to selected clips. The reference asset is excluded from
sequence insertion, preview, and export.

**Consequence.** The profile is portable; the media is not. Tests assert that
reference media never appears in the timeline or output.

## 15. Motion compositions are validated, not evaluated as JavaScript

**Context.** Agent-authored motion scenes are powerful, but `eval` in the
renderer is not acceptable.

**Decision.** Parse the scene expression, allow only a small AST surface
(literals, containers, arithmetic, conditionals, and whitelisted `Math`), then
interpret it with a dependency-free evaluator. Reject dangerous identifiers and
computed keys. Render the resulting scene tree in the compositor.

**Consequence.** Authors get a constrained expression language, not full
JavaScript. Invalid code returns policy issues and repair hints.

## 16. The renderer composites; the main process encodes

**Context.** Preview and export must match. Encoding in the main process would
duplicate the canvas logic or require a headless browser.

**Decision.** The renderer draws frames with `@kerf/canvas` and sends PNG
batches to the main process. The main process writes frames, builds the audio
plan, and runs one `ffmpeg` pass. Export is one at a time.

**Consequence.** The editor window must be open to export. PNG encoding is the
main cost; batching amortises IPC without unbounded memory.

## 17. Measure performance, do not gate CI on hardware

**Context.** Startup, ingest, seek, and export numbers depend on the machine,
codec, and project size.

**Decision.** Record measured targets on a reference machine in
[performance.md](performance.md). Use `KERF_PERF=1` to print timings. Keep CI
green on correctness and E2E behaviour, not on a fixed frame rate.

**Consequence.** Regressions are caught by comparing the same hardware. A slow
CI runner cannot fail a build for being slow.

## 18. Test the real app with real tools

**Context.** Mocked Electron and fake transcription would miss integration
failures in IPC, file paths, and process spawning.

**Decision.** Playwright launches the real Electron app with a temporary
user-data directory and projects root. The caption journey uses a real
`whisper.cpp` binary and the tiny model. `ffmpeg` generates the fixture and
encodes the export. Test-only hooks are gated by `KERF_E2E=1`.

**Consequence.** E2E needs external binaries and a model cache. CI installs
them on macOS. The production preload surface stays unchanged.

## 19. Bundled fonts and a token-driven UI

**Context.** A desktop editor should render identically offline and feel like
one product, not a collection of components.

**Decision.** Bundle Fraunces, Instrument Sans, and JetBrains Mono (all SIL OFL)
and drive colour, spacing, radius, and focus styles from CSS tokens. Use shared
primitives from `@kerf/ui`. Every interactive control has hover, focus-visible,
and disabled states.

**Consequence.** Font files and licence texts are part of the repository. New
components should compose primitives instead of inventing one-off styles.

## 20. Packaging is deferred

**Context.** The application path is working, but signing, icons, fuses,
installers, and clean-machine verification are a separate release task.

**Decision.** Keep `pnpm package` and `pnpm make` available, but do not claim a
supported installer yet. Document the limitation in the README.

**Consequence.** The source build is the supported path for now. Packaging and
licence bundling must be revisited before a tagged release.
