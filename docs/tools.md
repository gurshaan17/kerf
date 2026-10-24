# Tools

Kerf exposes one tool catalog to two surfaces: the built-in chat assistant and
the MCP server. The catalog lives in `packages/tools`. There is no second list
to keep in sync.

## Contract

A tool is defined with `defineTool`:

```ts
defineTool({
  name: 'readTimeline',
  description: 'Read tracks, clips and markers in timeline order.',
  input: z.object({ includeMarkers: z.boolean().default(true) }),
  output: timelineOutput,
  readOnly: true,
  execute(context, input) {
    // Read from context.snapshot(), or apply an edit through context.apply().
  },
});
```

Every tool has:

- **Name** — stable and unique. Chat and MCP use it verbatim.
- **Description** — written for a model that has not read the code.
- **Input schema** — Zod. Unknown or invalid input is rejected before
  execution.
- **Output schema** — optional Zod validation of the return value.
- **`readOnly`** — true for inspection. MCP exposes this as an annotation and
  the agent prompt treats it as safe to call.
- **`execute`** — receives a narrow `ToolContext`, never the raw services.

`ToolService.call(name, input, actor)` parses input, runs the tool, parses
output, and returns a serialisable value. Calls are serialised so two edits
cannot race the same sequence snapshot. `actor` is `user`, `agent`, `mcp`, or
`system`. Edits are applied through `context.apply()` or `context.applyBatch()`
so they go through the same command, inverse, edit-log, and undo path as the
UI.

## Context

| Method                          | Purpose                                                                           |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `snapshot()`                    | Current project, assets, transcripts, scenes, beat maps, references, compositions |
| `editor()`                      | Playhead, selected clip IDs, selected asset ID                                    |
| `apply(command, options)`       | Apply one edit and return the new snapshot plus inverse                           |
| `applyBatch(commands, options)` | Apply several edits as one undo entry                                             |
| `search(request)`               | Search transcripts and scene descriptions                                         |
| `renderer()`                    | Render a preview frame or preview a composition, when the editor is open          |
| `exports()`                     | List presets and exports, start an export, reveal an output                       |
| `saveComposition()`             | Save a motion composition                                                         |
| `detectBeats()`                 | Detect beats for an asset                                                         |
| `profileReference()`            | Measure a reference asset                                                         |
| `now()`                         | Injectable clock for tests                                                        |

If the editor is closed, `renderer()` returns `null`. If no project is open,
`snapshot()` returns `null` and read tools throw a clean error. Tools should
report unavailable capabilities rather than fabricate results.

## Catalog

### Read

| Tool               | What it returns                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------- |
| `readContext`      | Project and sequence summary, editor selection, playhead, analysis counts, active reference |
| `readAssets`       | Footage list with duration, dimensions, stream flags, and analysis availability             |
| `readAsset`        | One asset by ID or exact name, including transcript, scenes, and beat map                   |
| `readTimeline`     | Tracks, clips, markers, timing, and effect counts in timeline order                         |
| `readTranscript`   | Transcript segments and optional word timings for a frame window                            |
| `findInTranscript` | Transcript and scene search hits with asset and frame ranges                                |
| `renderFrame`      | One composited frame as a local PNG path                                                    |
| `readDuration`     | Sequence or asset duration in frames, seconds, and timecode                                 |
| `listEffects`      | Supported effects, masks, blend modes, fits, and animatable properties                      |

### Edit

| Tool              | What it does                                                                       |
| ----------------- | ---------------------------------------------------------------------------------- |
| `insertClip`      | Insert a video or image asset on a visual track                                    |
| `insertAudio`     | Insert an audio asset on an audio track                                            |
| `insertText`      | Insert a styled text clip                                                          |
| `editClip`        | Patch label, transform, effects, masks, keyframes, blend mode, fit, text, or style |
| `moveClip`        | Move a clip to a new start frame, optionally to another track                      |
| `trimClip`        | Extend or shorten a clip edge by a frame delta                                     |
| `splitClip`       | Split one clip at an absolute sequence frame                                       |
| `duplicateClip`   | Duplicate a clip, optionally on another track and offset                           |
| `removeClips`     | Remove one or more clips as one undo step                                          |
| `slipClip`        | Slip media inside its source without moving it on the timeline                     |
| `setSpeedMap`     | Set constant speed and/or a time map as one undo step                              |
| `animateProperty` | Set keyframes for transform, opacity, or volume                                    |
| `markMoment`      | Add a marker or chapter point                                                      |
| `applyBatch`      | Apply an ordered list of edits as one atomic undo step                             |

### Macros

| Tool               | What it does                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `writeCaptions`    | Create caption clips from a transcript with the clean, bold, or boxed preset; replaces existing captions for those transcripts |
| `cutSilences`      | Remove spoken pauses from one transcribed asset and close the gaps                                                             |
| `duckUnderSpeech`  | Lower non-speech audio that overlaps transcribed speech                                                                        |
| `assembleRoughCut` | Build a video track from spoken segments, dropping false starts and repeated takes                                             |

### Beat and reference

| Tool                | What it does                                                                |
| ------------------- | --------------------------------------------------------------------------- |
| `detectBeats`       | Detect tempo, beats, and sections for one asset                             |
| `cutToBeat`         | Split media clips on beats using sparse, medium, or dense spacing           |
| `useReference`      | Assign a reference asset to the sequence for style analysis                 |
| `profileReference`  | Measure shot rhythm, palette, and colour statistics and persist the profile |
| `readReference`     | Read the active or specified reference profile                              |
| `copyReferenceLook` | Apply the reference colour treatment and return pacing targets              |

### Composition

| Tool                 | What it does                                                                 |
| -------------------- | ---------------------------------------------------------------------------- |
| `authorComposition`  | Validate and save a motion composition from a scene expression               |
| `reviseComposition`  | Change a saved composition's name, expression, or dimensions                 |
| `previewComposition` | Evaluate a composition at a frame and return the scene tree or policy issues |

### Export

| Tool            | What it does                                                          |
| --------------- | --------------------------------------------------------------------- |
| `exportPresets` | List available presets and output dimensions                          |
| `startExport`   | Start an export for a frame range; the open editor renders the frames |
| `readExport`    | Read one export by ID, or list recent exports                         |

## Agent rules

The built-in system prompt requires the assistant to:

1. Read `readContext` and `readTimeline` before editing.
2. Use IDs returned by tools, never invented IDs or positions.
3. Prefer a macro when the request matches one.
4. Use `applyBatch` for compound edits so one Undo reverses the group.
5. Never move reference media onto the timeline, preview, or export.
6. Never switch providers, upload media, or enable a network service on its
   own.
7. Verify after every edit with `readTimeline` or `readDuration`.
8. Before export, check duration, start the export, and poll `readExport` until
   it succeeds, fails, or is cancelled.
9. Report unavailable capabilities instead of fabricating analysis.

The MCP server reuses the same prompt and adds session rules: edits are
attributed to `mcp`, they remain undoable in the editor, and reference media is
never exported.

## Errors

Tool failures return a short, actionable message. The agent should say what
failed and what the user can change; it should not retry the same failing call.
Typical failures:

- No project is open.
- The asset or clip ID no longer exists.
- No transcript, beat map, or provider is available.
- The preview is closed, so frame rendering is unavailable.
- A composition expression violates the policy.
- An export is already running.

## Adding a tool

1. Define it with `defineTool` in the relevant file under
   `packages/tools/src`.
2. Add it to `TOOL_DEFINITIONS` in `packages/tools/src/index.ts`.
3. Add a Vitest case for the happy path and the clean-error path.
4. If it edits, implement the command and inverse in `@kerf/model` and
   `@kerf/engine` first. The tool should only orchestrate.
5. Update this page and the agent prompt's tool list if the catalog changed.
6. Run `pnpm typecheck`, `pnpm test`, and `pnpm audit:names`.

The MCP schema, descriptions, and read-only annotations are generated from the
registry, so no separate MCP registration is needed.
