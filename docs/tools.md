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

| Tool               | What it returns                                                                                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `readContext`      | Project and sequence summary, editor selection, playhead, analysis counts, active reference                                    |
| `readAssets`       | Footage list with duration, dimensions, stream flags, and analysis availability                                                |
| `readAsset`        | One asset by ID or exact name, including transcript, scenes, and beat map                                                      |
| `readTimeline`     | Tracks, clips, overlays, markers, timing, and effect counts in timeline order                                                  |
| `readTranscript`   | Transcript segments and optional word timings for a frame window                                                               |
| `findInTranscript` | Transcript and scene search hits with asset and frame ranges                                                                   |
| `renderFrame`      | One composited frame, returned as a PNG path and an image result                                                               |
| `verifyTimeline`   | Structural findings for missing assets, source bounds and informational gaps/overlaps; does not verify visual or audio quality |
| `readDuration`     | Sequence or asset duration in frames, seconds, and timecode                                                                    |
| `listEffects`      | Supported effects, overlays, masks, blend modes, fits, and animatable properties                                               |

`renderFrame` returns both the frame metadata and the captured image, so a model
can inspect what it just changed. MCP sends an image content block; the built-in
agent receives the same bytes as a file part. Read-only inspection of the effect
result therefore does not require a separate screenshot step.

### Edit

| Tool              | What it does                                                                        |
| ----------------- | ----------------------------------------------------------------------------------- |
| `insertClip`      | Insert a video or image asset on a visual track                                     |
| `insertAudio`     | Insert an audio asset on an audio track                                             |
| `insertText`      | Insert a styled text clip                                                           |
| `editClip`        | Patch label, transform, effects, masks, keyframes, blend mode, fit, text, or style  |
| `addOverlay`      | Add a blur, callout, spotlight, or zoom overlay, optionally linked to a clip        |
| `updateOverlay`   | Patch an overlay's region, shape, timing, link, transitions, or kind-specific props |
| `moveClip`        | Move a clip to a new start frame, optionally to another track                       |
| `trimClip`        | Extend or shorten a clip edge by a frame delta                                      |
| `splitClip`       | Split one clip at an absolute sequence frame                                        |
| `duplicateClip`   | Duplicate a clip, optionally on another track and offset                            |
| `removeClips`     | Remove one or more clips as one undo step                                           |
| `slipClip`        | Slip media inside its source without moving it on the timeline                      |
| `setSpeedMap`     | Set constant speed and/or a time map as one undo step                               |
| `animateProperty` | Set keyframes for transform, opacity, or volume                                     |
| `markMoment`      | Add a marker or chapter point                                                       |
| `applyBatch`      | Apply an ordered list of edits as one atomic undo step                              |

`addOverlay` links a new overlay to the first selected visual clip. If nothing
visual is selected it uses an explicit `linkedItemId`, and failing that it
creates an unlinked three-second overlay at the playhead. Regions and points are
normalized to the canvas; blur radius and font sizes use 1080p-height units.
`updateOverlay` patches the same discriminated `props` union the Inspector uses,
so kind-specific fields remain type-checked.

### Macros

| Tool               | What it does                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `writeCaptions`    | Create caption clips from a transcript with the clean, bold, or boxed preset; replaces existing captions for those transcripts |
| `cutSilences`      | Remove spoken pauses from one transcribed asset and close the gaps                                                             |
| `duckUnderSpeech`  | Apply attack/release envelopes under indexed speech; reject existing background volume automation                              |
| `assembleRoughCut` | Build a video track from spoken segments, dropping false starts and repeated takes                                             |

### Audio finishing

| Tool                     | Behavior                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `measureAudio`           | Measure the explicit clip mix locally: integrated LUFS, true peak dBTP, frame range, revision and silence/insufficient states |
| `planAudioGain`          | Prepare gain/fades from a current measurement and explicit target/ceiling; unattainable targets remain unapplied              |
| `planAudioDucking`       | Prepare reviewed speech-envelope ducking for explicit speech/background IDs with attack/release ramps                         |
| `readAudioFinishingPlan` | Read current review eligibility without editing or processing media                                                           |

The planning tools require **Apply reviewed audio changes** in desktop review;
MCP and chat cannot bypass it. Every Apply creates one ordinary undo step.
Measurements are before existing export master limiting; remeasure after applying
gain/fades. Plans expire after five minutes, reject changed project/source/index
revisions, and never overwrite conflicting volume automation. See
[Audio finishing](audio-finishing.md) for scope, limits and audition checks.

### AI editing analysis and review

| Tool                | Behavior                                                                      |
| ------------------- | ----------------------------------------------------------------------------- |
| `planAutoCut`       | Start the existing contextual cut analysis; returns a job without editing     |
| `planScreenPolish`  | Start the existing screen-interaction analysis; returns a job without editing |
| `readEditingJob`    | Read project-scoped progress, failure and review status                       |
| `cancelEditingJob`  | Cancel analysis and invalidate pending review; idempotent                     |
| `readEditProposal`  | Read stored reasons, ranges, evidence and eligible change IDs                 |
| `applyEditProposal` | Request desktop review of selected IDs; returns `awaiting-review`             |

Read `readContext.editingProviders` for configured provider IDs and consent flags.
Auto cut needs vision and chat consent; screen polish needs vision consent. Both
retain their normal-speed and five-minute limits and report unsupported footage.
Provider work starts only through an explicit planning call. Read tools never
start analysis. Long jobs should be checked on a later turn instead of exhausting
the model's step budget with polling.

Both chat and MCP use the **Review AI edits** panel in Kerf chat. The user inspects
source footage, reasons and evidence, unchecks unwanted changes, then clicks Apply.
`applyEditProposal` does not mutate the timeline or accept a model-supplied approval
boolean. Approval is a desktop-only IPC operation, outside the model/MCP catalog.
MCP therefore requires an open desktop session for this review flow.

Apply resolves selected IDs against the stored proposal, rechecks source/timeline
fingerprints and provider settings/consent, and commits through the shared command
path as one user-approved undo step. Applied/cancelled proposal markers and receipts
persist locally to prevent replay after restart or undo. Pending selections are
session-local; reopening requires review again. Old screen-polish proposals without
a provider revision must be analysed again before applying.

Source ranges in Auto cut are source frames. Screen-polish ranges are sequence
frames; its evidence frames refer to the source. Auto cut returns reasoned removal
ranges, rather than claiming exact evidence frames it did not store. Source
playback is available for both; after applying, inspect the composited timeline.
Stopping a chat turn cancels analysis it started while that turn is active. Jobs
that outlive a completed turn remain visible and cancellable in the review panel.
Project switching retains the existing services' cancellation behavior.

### Evidence-based rough cuts

`findInTranscript` accepts up to 20 `assetIds` and filters before limiting results.
Both indexed and lexical search retain the project boundary. Tool results include
native source-frame rates and up to 20 complete speech/scene evidence ranges per
hit, with stable IDs usable by the planner. Search windows may be shorter than a
sentence; the planner uses the complete underlying speech segment.

`readSourceFilmstrip` returns at most six cached scene thumbnails at their source
midpoints, with source-frame rates and scene IDs. Missing caches are reported;
this tool does not start analysis. Chat and MCP receive actual JPEG content with
a combined 2 MB image budget. Built-in chat requires vision consent for its active
provider. These source images are distinct from composited `renderFrame` previews.

`planRoughCut` accepts selected ready video `assetIds`, an `intent`, optional
`targetDurationSeconds` (up to 30 minutes), and optional ordered
`selections: [{ evidenceId, reason }]` (up to 40). Each selected ID must identify a
complete speech segment or a described scene in silent footage. Audio-bearing
sources require reviewed speech analysis; missing analysis is reported. Reference
footage, invented IDs, duplicate/overlapping source ranges and invalid bounds are
rejected. Existing clips and retimes are preserved; the new cut uses source media
at normal speed with its own synchronized source audio. External sync/retime
instructions are not accepted by this contract.

The assistant can choose editorial order through explicit evidence selections.
Without them, indexed intent matches are assembled in source order, falling back
to complete source ranges with a visible warning when no matches exist. This
fallback is a local draft, not a claim of semantic story quality. Duration is a
preference: complete segments are retained, and mismatches are reported instead
of truncating speech.

The tool returns an editing job and its ordered proposal, including source
citations, duration estimate, unmet constraints and append frame. Existing
`readEditingJob`, `readEditProposal`, `cancelEditingJob` and `applyEditProposal`
handle its lifecycle. The desktop review panel supports source playback and
including/excluding ranges. Approval recompiles the retained ranges, validates the
captured project, evidence and source-file fingerprints, and appends the cut as
one ordinary undo step. Plans and replay protection persist through the job store.

After approval, the panel offers separate **Caption this cut**, **Duck background
audio**, and **Verify this cut** actions. Captions and ducking also accept
`clipIds` through the existing shared tools. Scoped captions map native transcript
frames into sequence time and preserve unrelated/manual captions. Scoped ducking
lowers whole overlapping background clips while protecting known speech assets;
it reports a no-op when no background audio overlaps. Verification runs structural
checks and captures up to three representative 480-pixel previews for user review;
it does not certify playback, audio or whole-video visual quality. Each mutating
stage has its own undo step.

### Bounded visual refinement

`renderStoryboard` runs `verifyTimeline` first, then renders up to four composited
sequence frames. Pass `frames` or `clipIds`; clip sampling prioritizes text,
caption and overlay midpoints, then clip boundaries. Out-of-range frames and
hidden/nonvisual clips are rejected. Structural errors block refinement. Results
include PNG references, actual image content in chat/MCP, source-independent
sequence timestamps, canvas dimensions, up to 32 active objects with their current
visual properties, and a project revision. Omitted samples/objects are explicit.

`repairVisuals` accepts a `storyboardId` and frame-linked `findings`, each with an
exact `clipId`, rendered `frame`, category and observation. Categories cover text
clipping, contrast, framing and layout. Findings may omit patches for inspection
only. A patch can change transform, text style, image fit or overlay appearance;
it cannot alter source media, speech text, timing or audio. Keyframed transform
properties require separate motion review. Partial properties preserve the
object's other settings.

The shared service revalidates project/revision and object/frame evidence before
committing at most four distinct object repairs as one atomic undo entry. Mixed
batches containing a no-op are closed without committing any changes. Findings
without patches are recorded without edits. One repair batch is allowed per
review. The single `renderStoryboard({ recheckOf: storyboardId })` reuses the
original frames and width, then closes the review. Remaining visual issues are
reported to the user rather than repaired again.

Budgets per review are four frames per pass/eight total, 960 pixels maximum width,
4 MB combined unique rendered PNG bytes, 15 seconds of rendering per pass/30
seconds total, and two minutes of evidence lifetime. At most 20 reviews are kept
in memory; active evidence cannot be resumed after restarting Kerf. Rendering
checks cancellation, access and revision between frames. A stopped render releases
the serialized tool queue; already committed repairs remain undoable. Missing
preview support, invalid/stale evidence, exhausted budgets or revoked consent stop
refinement, with partial results clearly labeled.

Built-in chat also limits each turn to one initial storyboard, one repair attempt
and one recheck, within its existing 12-step cap. Other mutating tools and alternate image-capture tools are deferred
after inspection starts, preventing repairs through a second editing path. MCP
uses the same evidence, revision and per-review limits; ordinary edits invalidate
a captured review. Starting a fresh review is an explicit new workflow, not a way
to continue repairing the same request indefinitely.

Before each model step, image tool results are forwarded as standard user image
parts after all corresponding tool responses. This avoids adapters that stringify
image tool content as JSON. Tool/frame associations and text metadata are retained,
and both vision and chat consent for the active provider are rechecked before
forwarding images. MCP receives explicit image content blocks. Cache paths or
missing images never count as visual inspection.

Chat saves inspection frames, model observations, affected objects, the committed
repair receipt and recheck images. These are sampled observations, not proof of
whole-video quality. Playback, pacing, transitions and audio still require playback
or separate measurements. Deterministic fixture-provider tests establish the loop
and its safeguards; they do not establish a model's aesthetic judgment.

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

## Chat edit receipts and verification

The built-in prompt's tool names come from the registry. Every committed tool
command emits a factual receipt with its command ID, undo label, affected clips
and frame ranges, and before/after duration. A batch produces one receipt.
Receipts remain visible if subsequent work fails or the turn is stopped.

Chat automatically runs structural verification and renders at most three affected
visual midpoints per committed command, at 480 pixels wide. Receipts show seekable
ranges, structural findings and timecoded thumbnails. Images stay local in chat;
the existing `renderFrame` tool remains the model's explicit image-inspection path.
Preview capture is not visual approval. Missing previews, cancellation or timeline
changes leave verification partial or unverified. Stopping does not roll back edits.
Saved chats retain their receipts and thumbnails as historical evidence, not proof
of the current timeline. Each receipt describes one command's undo step; it does
not promise whole-turn undo or selective restoration of an old command.
