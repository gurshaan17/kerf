# Visual narration from silent video: implementation specification

**Status:** Proposed implementation plan; Phase 0 is a go/no-go gate  
**Scope:** Generate editable, timestamped text from video frames when the source has no usable speech audio.

**Phase 0 evidence:** Four supplied clips and the resolution/concurrency/overlap comparison have been run; see [observations and remaining blockers](visual-narration-phase0-review.md). Descriptions are useful, but timing overlap and missing static/long coverage mean the gate has not passed.

## 1. Product definition

The feature creates a **visual narration draft**: short, timestamped sentences describing visible actions and changes in a video. It is useful for silent screen recordings, product walkthroughs, and other footage where the user wants a descriptive text track or captions.

This is not speech recognition, audio description for accessibility certification, or a factual transcript of spoken words. The model must not infer dialogue, intent, identity, or facts that are not visible. The UI and stored data must preserve that distinction from a Whisper transcript.

### Initial user journey

1. User selects a video asset and chooses **Generate visual narration**.
2. Kerf shows which configured vision provider will receive sampled frames and asks for explicit confirmation if this is the first upload for that provider / asset workflow.
3. Kerf samples the video, generates a draft, and reports progress as a cancellable job.
4. The transcript panel opens in visual narration mode. Selecting a row seeks to its evidence frames; the user can edit, retime, split, merge, add, or delete rows.
5. User can create caption clips from the reviewed draft using the existing caption workflow.

The first version is user-triggered. It does not automatically run when silent media is imported and does not synthesize voiceover.

## 2. Existing architecture to reuse

- `AnalysisService` and the SQLite-backed `JobQueue` own long-running analysis.
- `detectScenes` in `src/main/analysis/scenes.ts` uses ffmpeg and writes timestamped keyframes under the project analysis directory.
- `describeScenes` in `src/main/analysis/vision.ts` calls the configured vision provider for one scene image at a time.
- Provider configuration and opt-in consent are managed by `ProviderStore`.
- `Transcript` in `packages/model/src/transcript.ts` already stores text segments with source-frame ranges. Transcript rows are persisted in `transcripts` with `payload_json`; snapshots expose them to the renderer.
- The transcript panel, caption command, typed preload bridge, IPC registration, and project refresh events provide the interaction path.

Scene descriptions are not sufficient as the output: they are intended for search and may not describe action changes or provide the desired density. The feature should have its own generation pipeline and preserve its provenance in the transcript model.

## 2. Phase 0: prove output quality on real media

Do this before implementing provider orchestration, persistence, or editor infrastructure. Write a throwaway local script that uses the existing ffmpeg and configured vision-provider path to sample and prompt frames, emits timestamped structured results to a reviewable JSON/Markdown artifact, and does not write to project transcripts. Run it against five representative real clips:

1. Product screen recording with mostly static screens and ordinary clicks.
2. Camera clip with visible human action.
3. Static or near-static clip, to measure hallucination/repetition behavior.
4. Long clip near the proposed duration limit, to measure downsampling, latency, and cost.
5. Fast UI interaction with short transitions and rapid state changes.

Read every generated segment against the actual footage, including missed events and false claims. Record model/provider, sampling settings, image dimensions, request count, elapsed time, and estimated provider cost. Compare at least 768px and 1280px long-edge screen samples, and test crop-to-change-region if text remains illegible. Measure seam repetition as the fraction of adjacent segment pairs across chunk seams whose normalized text similarity exceeds a documented threshold. Compare `W=1` and `W=3`, with overlap frames on and off, using identical deterministic sampling and prompt settings. The script must use disposable output and remove local frame temporaries.

**Go/no-go:** proceed only if a human reviewer judges the descriptions useful and grounded for the intended tutorial workflow, the fast UI sample captures important transitions, and the static clip does not produce invented activity. If output is generic, misses the interaction beats, or routinely invents legible UI text, revise the prompt/sampling/resolution and rerun Phase 0. If it still fails, stop this feature direction before building infrastructure. Do not treat passing schema validation as quality evidence.

This gate is not run by authoring this document; it requires representative clips and a configured provider. Save reviewed outputs and settings with product validation notes; do not commit private source frames or user footage.

### Phase 0 runner

The disposable runner is `scripts/visual-narration-prototype.mjs` (Node >=22.18, ffmpeg and ffprobe required). Copy `scripts/visual-narration-manifest.example.json` to a local manifest and replace the paths and provider/model. It accepts one to five real clips, including multiple clips from one category, and reports missing quality categories. Relative paths resolve against the manifest directory. Credentials come only from `KERF_VISION_API_KEY`; the runner does not decrypt the desktop application's provider store. A disposable local Electron helper can supply an existing Kerf key through the child environment without writing it to disk.

```sh
# Decode and estimate locally, with no provider calls.
node scripts/visual-narration-prototype.mjs /path/to/manifest.json
# Explicitly send the manifest's comparison matrix to its provider.
node scripts/visual-narration-prototype.mjs /path/to/manifest.json --send
# Verify deterministic orchestration and boundary behavior.
node --test scripts/visual-narration-prototype.test.mjs
```

The default matrix compares 768/1280px, W=1/W=3, and overlap off/on: eight generation runs per clip. Reduce the matrix in the manifest for initial debugging. Optional `prices.input` and `prices.output` are USD per million tokens; without them, reports record usage and leave cost unknown. Reports and review sheets go under ignored `.cache/visual-narration-*`; temporary images are removed on success/failure/cancellation. Nothing writes to project SQLite, transcripts, captions, or the timeline.

Initial runner uses grayscale frame-difference sampling at 4 fps and whole-frame resolution comparisons. Separate scene-cut forcing and change-region crops remain Phase 0 experiments if whole-frame results are insufficient. Its seam pass deliberately auto-merges only matching normalized wording; near matches are measured for review because similar text can describe distinct actions. Passing runner tests or synthetic media smoke checks does not pass the five-real-clip quality gate. Infrastructure phases remain gated on a recorded human verdict.

## 3. Architecture overview

```text
Renderer action
  -> typed preload API / IPC validation
  -> AnalysisService enqueue `analysis.visualNarration`
  -> persistent job queue
  -> source validation and stream probe
  -> scene detection or reuse + bounded frame sampling
  -> vision provider, bounded contextual chunk requests
  -> structured output validation and frame-range normalization
  -> persist a draft Transcript with visual provenance
  -> refresh project snapshot and transcript search index
  -> review/edit in transcript panel
  -> existing caption creation path (explicit user action)
```

Main process owns filesystem, ffmpeg, provider calls, persistence, and job state. The renderer receives only typed DTOs and project snapshots; it never receives arbitrary filesystem access or provider credentials.

## 4. Data model and persistence

### Transcript provenance

Extend the transcript schema additively:

```ts
type TranscriptSource = 'speech' | 'visual';

interface Transcript {
  // existing fields...
  source: TranscriptSource; // default 'speech' when reading legacy payloads
  model: string | null; // existing field; provider/model label for visual output
  status: 'draft' | 'reviewed'; // default 'reviewed' for legacy speech transcripts
}
```

`source` is needed for correct UI labels, analytics/status, search display, and preventing a visual run from being mistaken for speech. `status` separates generated output from user-reviewed text. Existing `language` can remain as-is for compatibility, but visual narration must not claim detected speech language; use the UI label “Visual narration” and leave language unset/null for visual transcripts. If making language nullable is too disruptive, retain the default and do not display it for visual transcripts.

Each visual segment uses existing `startFrame`, `endFrame`, and `text`; `words` remains empty because visual descriptions do not have word-level timing. Do not fabricate word timestamps by splitting a sentence. Add `evidenceStartFrame`, `evidenceEndFrame`, and sampled-frame references to distinguish the evidence window from user-adjusted narration timing. `confidence` is not currently part of segment schema; do not add model confidence until the provider returns a meaningful calibrated value.

Generated segment IDs must remain stable across edits and regeneration. Add a per-segment `origin: 'generated' | 'edited' | 'manual'`. Editing generated text or timing changes origin to `edited`; split children receive new stable IDs and origin `edited`; merge creates a new stable ID and origin `edited`; manually added rows use `manual`. Unchanged rows keep their IDs.

### Versioned transcript writes and edit operations

Add a monotonically increasing `revision` to each transcript, defaulting to `0` for legacy rows. Every write includes the expected revision. Main-process code validates transcript ownership, project/asset relation, segment IDs, frame bounds, and operation-specific invariants, then applies the operation transactionally only if the stored revision matches. A stale request is rejected with a conflict result containing the current revision and snapshot; the renderer reloads and asks the user to reapply rather than overwriting newer edits.

Expose narrow, Zod-validated IPC operations, not a generic arbitrary-payload mutation API:

- `updateText(transcriptId, segmentId, text, expectedRevision)`
- `setTiming(transcriptId, segmentId, startFrame, endFrame, expectedRevision)`
- `split(transcriptId, segmentId, splitFrame, expectedRevision)`
- `merge(transcriptId, segmentIds, expectedRevision)` (only adjacent/overlapping rows in the same visual transcript)
- `add(transcriptId, startFrame, endFrame, text, expectedRevision)`
- `delete(transcriptId, segmentId, expectedRevision)`
- `undo(transcriptId, expectedRevision)` / `redo(transcriptId, expectedRevision)`

Each successful operation records an inverse and is undoable/redoable. Keep this history scoped to transcript edits and persist enough state to survive renderer refresh; do not route transcript text edits through timeline `EditCommand` unless a corresponding domain command is deliberately added. Revision increments on every successful write, including undo/redo. Undo and redo reject stale revisions. Segment changes, revision, and history commit together.

### Replacement and edit rules

- A generation run saves only after all chunks validate and the user has elected to regenerate. Before replacement, show how many edited rows will be affected and require confirmation. Never silently discard user work.
- A run must never delete or replace a non-empty speech transcript.
- **Decision: one transcript record per asset in v1.** If a non-empty speech transcript exists, block visual narration. Before blocking, check the silent-audio junk case: if the record has no non-empty segments after trimming, allow visual narration to replace that unusable record only after explicit confirmation. Never classify as empty if any segment contains text. Keep the old record until the visual run succeeds, then atomically replace it. Do not implement dual transcript support in this feature.
- Range regeneration replaces generated rows only within the requested source interval, preserving rows outside it. Preserve manual rows unconditionally. Preserve edited rows by default; if they overlap the range, skip generation for their occupied intervals and disclose that in the result. Offer a separate **Replace generated and edited rows in range** action with a loss count and confirmation. Full regeneration follows the same policy across the entire asset.
- Re-running visual generation must be explicit. Never silently append duplicate generated rows.
- User edits update the visual transcript payload and set `status: 'reviewed'`; source stays `visual`.
- Existing speech transcript persistence and project import behavior remain backward compatible through schema defaults.

### Database migration

Inspect the current transcript table constraints and repository write/read paths before implementation. Add no relational column unless needed for an index/query; `payload_json` is the canonical extensible model. Migration must read older rows whose payload has no `source`, `status`, or `revision`. Keep project files and SQLite backup compatibility intact. V1 explicitly retains one transcript per asset.

## 5. Request contract and IPC

Add an explicit request, rather than overloading the existing `vision` kind:

```ts
interface VisualNarrationRequest {
  assetId: string;
  mode?: 'concise' | 'detailed'; // v1 may expose concise only
  replaceVisualDraft?: boolean;
}
```

Expose `analysis.generateVisualNarration(request)` through:

1. shared request/result contracts and Zod validation in main;
2. preload bridge API;
3. IPC channel and registration;
4. UI action in the footage asset menu / analysis panel.

It returns the queued `JobSummary`. The job payload stores only `assetId` and validated options, never provider secrets or raw frame data. Resolve the provider when the worker starts so removed/disabled accounts fail clearly. Record the provider ID/model label as provenance, not the API key.

Do not expose this as an agent/MCP tool in v1. First establish quality and user-review semantics in the UI; later it can be added as a draft-producing tool with explicit provenance.

## 6. Eligibility and preflight

At request time, verify there is an open project and the asset belongs to it. At job time, re-resolve the project and asset and verify the source path still exists. Probe stream metadata with ffprobe (or existing asset metadata if validated and current):

- Require a video stream and positive duration.
- Audio stream absence is a strong suggestion to use visual narration, not a hard requirement; silent/near-silent audio can still exist.
- Do not run Whisper as part of this request. An existing transcript is not proof the asset has usable audio.
- Require a configured, enabled vision provider with explicit vision consent. No implicit provider selection, provider fallback, or network call before the explicit user request.
- Enforce an initial duration limit (proposed: 20 minutes) and frame budget before enqueueing. Show the estimate and offer a shorter selection for over-limit media. Limits should be constants and revisited with measured latency/cost.
- Check cancellation before starting, between ffmpeg operations, before each provider call, and before persistence.

If no provider is ready, explain the exact setup needed and do not enqueue a doomed job. If media is missing, relink first.

## 7. Frame sampling pipeline

### 7.1 Establish scene and time ranges

- Reuse current detected scenes only when they cover the source duration and match the current asset revision; otherwise run `detectScenes`.
- Scene cuts are sampling hints, not a requirement for narration. If cut detection fails, continue with visual-change sampling and report that scene cuts were unavailable; do not fall back to blind uniform sampling alone.
- Use asset frame rate for frame↔seconds conversion, falling back to sequence rate as other analysis does.
- Treat source and narration ranges as half-open `[startFrame, endFrame)` internally. Provider output uses sampled-frame indices; map them to source frames and clamp to source duration.

### 7.2 Deterministic bounded sampling

Use **visual change as the primary sampling signal** and scene cuts as a secondary signal. Scene-cut detection alone is inadequate for screen recordings, where clicks and UI state changes often happen without camera cuts.

- Decode a low-resolution probe stream at a configurable rate (initial candidate: 4 fps) and compare adjacent images using normalized frame difference or perceptual hash. Emit a sample when a tuned threshold is crossed, with an initial minimum separation of 250 ms. Add periodic context samples so continuous motion is not entirely omitted.
- Use scene cuts as an additional forced sample/boundary signal. Include the first stable frame after each cut and a midpoint when a scene is otherwise under-sampled.
- Suppress near-duplicate samples and retain each sample's exact source frame/time and change score.
- For screen content, use at least 1280 px long-edge images where provider limits allow. If the changed region is small, send a crop around it plus a lower-resolution full-frame context. Compare these approaches in Phase 0; do not claim UI text transcription unless tested resolution/cropping can read it.
- Initial budget strategy: target at most one candidate per second, then rank candidates by visual-change score and scene-boundary importance. If more than 600 remain, reserve at least one sample per 10-second interval, then fill remaining slots by change score with chronological tie-breaking. Never truncate the end of the video silently. Show the estimate's sampled/estimated frame count, duration coverage, and that downsampling will occur.
- Cap each chunk at 8 primary samples (plus one overlap image for non-first chunks) and each asset at 600 unique primary samples. Provider request image limits take precedence: if an adapter permits only 8 images, use at most 7 primary samples plus the overlap image. If the 10-second coverage guarantee cannot fit under the unique-sample cap, fail preflight with a shorter-range suggestion rather than silently dropping sections.
- Avoid frames within 150 ms of a cut where possible; include the first stable frame after a cut.
- Remove metadata; keep temporary frames and crops under project `analysis/work` and delete them when the job ends.

Put the sampler in a pure `buildVisualSamples` function so its behavior can be tuned and tested independently.

### 7.3 Chunk construction and deterministic concurrency

- Group adjacent primary samples into chronological chunks covering at most 12 seconds, with at most 8 primary images per chunk. Do not combine distant/noncontiguous footage.
- For every chunk after the first, prepend the final primary sample from the preceding chunk as an **overlap context frame**. Mark it explicitly as “context only; describe changes after this frame.” It is additional to the 8 primary images and counts toward provider image/request limits and cost, but not the 600-unique-primary-frame analysis cap. Deduplicate storage locally; each request may still incur provider image cost.
- Assign stable indices to all supplied images, marking each as either `contextOnly` or `outputEligible`. Ask the model to return segment boundaries only using output-eligible frame indices. Reject any range that starts or ends at a context-only index. The first chunk has no overlap frame.
- Keep chunk boundaries aligned to scene cuts when practical. The overlap image is chosen by source time, independent of provider output.
- Set concurrency width `W` as a constant per provider adapter, constrained by that provider's documented/configured request limits; `W=1` is valid. Initial target is `W=3` only where rate limits and memory allow, otherwise use 1 or 2. Never change W during a run.
- Number chunks from zero. Assign wave `floor(i / W)` to chunk `i`. For text continuity, every chunk in wave `k > 0` receives only the final few segments from the last chunk of wave `k - 1` (index `(k * W) - 1`), never whichever request happened to finish first. Text context is secondary; visual overlap frames must make each chunk usable without it. Wave 0 has no text context.
- Use a barrier: wave `k+1` starts only after every chunk in wave `k` succeeds. This makes context assignment deterministic but waits for the slowest chunk. A sliding window where chunk `i` waits only for chunk `i-W` is a future latency optimization; it uses more distant text context and must preserve static assignments and deterministic output ordering.
- A deterministic seam pass runs after all chunk outputs are individually validated and combined chronologically. At each chunk boundary, compare only segments whose source ranges touch/overlap within a small configured seam tolerance. If normalized text similarity exceeds a conservative threshold, merge duplicate descriptions into one segment with unioned evidence references and a deterministic combined range. Do not merge merely adjacent actions with distinct text. Implement this as pure, unit-tested code. An optional text-only provider stitch call is deferred and must not be required for correctness.
- Do not automatically retry failed requests; expose retry as a fresh user action. Delete temporary frames/crops on success, failure, or cancellation; keep existing scene keyframes as cache.

### 7.4 Provider prompt and output

Prompt the configured vision-capable model to describe visible actions and changes in plain language. For screen recordings, prefer visible interface actions and outcomes. It must:

- describe only what is visibly supported by supplied frames;
- avoid quoting or transcribing text unless it is clearly legible and materially important;
- never infer intent, identity, speech, emotions, or unseen events;
- avoid repeating static content across adjacent segments;
- return concise descriptions, one sentence per meaningful action/change;
- identify start and end frame indices from the supplied ordered samples; never invent raw timestamps.

Require structured JSON output validated by Zod, conceptually:

```json
{
  "segments": [
    {
      "startFrameIndex": 1,
      "endFrameIndex": 3,
      "text": "The settings panel opens, showing notification options."
    }
  ]
}
```

Frame indices reference the ordered images supplied to that chunk; `endFrameIndex` is inclusive as an evidence reference. Both indices must address output-eligible samples. Map start to the selected sample's source frame and end to just before the next output-eligible sample after it, clamped to the chunk/source range. Store evidence frame references on each segment, separate from its editable narration timing.

Use provider structured output support where stable; otherwise parse a single JSON object and reject malformed output. Do not silently salvage arbitrary prose. Validate each chunk's indices against supplied frames, reject context-only/invalid/reversed ranges, trim text, reject empty/overlong segments, and keep sentences grounded to evidence frames. After every chunk has validated, sort the combined output by source time, run the seam de-duplication pass, then perform final whole-result bounds, ordering, and overlap checks. Do not silently repair real overlaps. Blank/black/uninformative footage must produce no descriptions, not invented content.

## 8. Job lifecycle, progress, cancellation, and atomicity

Register `analysis.visualNarration` in `AnalysisService` and use the existing persistent queue. Suggested stages and weighted progress:

| Stage                       | Progress range |
| --------------------------- | -------------: |
| Checking video and provider |           0–5% |
| Detecting/reusing scenes    |          5–20% |
| Sampling frames             |         20–35% |
| Generating visual narration |         35–90% |
| Validating and saving draft |        90–100% |

Map generation progress by completed chunks, not individual tokens: `completedChunks / totalChunks` is stable regardless of request completion order. The provider API may not report useful progress. Use stage text for user-facing state.

Build transcript segments in memory and validate the complete result before writing. Check the abort signal before starting each wave. If any chunk in a wave fails, abort its in-flight siblings, wait for them to settle and clean up, then fail the job; do not start a later wave. Cancellation or any failed chunk leaves the prior transcript untouched. After all chunks succeed, run the deterministic seam pass and final validation. On successful completion, save the transcript, reindex search, and refresh the current project snapshot. If project is closed or asset removed before save, fail without writing. Ensure cleanup runs in `finally`.

Use the job queue's abort signal for ffmpeg and provider requests when the SDK supports it. If provider cancellation is not supported, request cancellation of sibling work, wait for in-flight calls to settle, discard all in-memory results, and do not start another wave.

## 9. Persistence, search, captions

- Save using the repository's transcript save method and validated model schema.
- Reindex the project so transcript search finds visual narration. Search results should display a “Visual narration” badge and seek to the generated source frame interval.
- Do not add visual entries to scene description fields; scene search remains its own data type.
- Existing caption generation should accept either transcript source, with the caption clips carrying the segment text and timing. It must be an explicit user action; generated text is never auto-added to the timeline.
- Caption clips are snapshots: editing or regenerating a transcript does not mutate existing timeline captions. Offer an explicit **Update captions from transcript** action that previews which linked clips will change and applies the update only after confirmation. Preserve unrelated/manual caption clips. Link generated caption clips to transcript and segment IDs; if that cannot be added safely in v1, the action must replace only clips created by the last explicit caption operation for this transcript.
- Empty result should not create a misleading “successful transcript” with blank text. Return job success with zero segments only if the user-facing UI clearly explains that no usable visual descriptions were generated; otherwise classify as a recoverable job error.

## 10. UI behavior

### Entry point and status

- Add **Generate visual narration** to the selected video asset's analysis actions, separate from **Describe scenes** and **Transcribe audio**.
- On video with no audio stream, make it the suggested action; do not claim the video has no speech based solely on stream metadata.
- Show configured provider name and an estimate based on primary samples, overlap images, and chunks (including provider-billable duplicated overlap images). Explain that sampled frames are sent to that provider before user starts.
- Disable with actionable explanations when there is no video stream, provider consent/configuration is missing, media is unavailable, or duration/frame limits are exceeded.
- Show queued/running/cancelled/failed/succeeded job status using existing job UI. A retry queues a new job.

### Transcript review

- Reuse `TranscriptPanel`, with explicit mode label: **Visual narration · AI draft** or **Visual narration · Reviewed**.
- Rows show timestamp, description, origin badge, and evidence indicator; clicking a row seeks to its evidence start frame. Allow text editing, timing adjustment, split, merge, manual add, delete, undo, and redo.
- Provide “Create captions” and “Update captions from transcript” actions. Caption creation remains disabled until at least one segment exists.
- V1 blocks visual narration when a non-empty speech transcript exists; do not present a second transcript selector. Never show “language” or “word count” metadata for visual narration; show segment count and source provider/model instead.
- Add a clear limitation notice: descriptions are inferred from sampled frames and may miss events between them. User remains responsible for review.

Use only the narrow, versioned IPC operations listed under “Versioned transcript writes and edit operations.” Validate ownership and frame ranges in main; do not let the renderer submit a replacement transcript blob.

## 11. Errors and recovery

Provide specific, user-readable errors for:

- missing/unreadable source media;
- unsupported or missing video stream;
- provider missing, disabled, consent absent, or provider no longer available;
- duration/frame budget exceeded;
- ffmpeg sampling failure;
- provider timeout, rate limit, or unsupported image request;
- malformed structured response or invalid frame indices;
- cancellation and project/asset removal;
- database/save/index failure.

Keep the old transcript and scene data intact on all failed runs. A provider error must not trigger a different provider or local/network fallback. A failed indexing step should be logged/recoverable without losing the saved transcript; a later project reindex can repair it.

## 12. Security, privacy, and resource constraints

- Only main process reads media and sends images to the configured provider.
- Use existing path validation and ffmpeg argument construction; pass file paths as arguments, never interpolate into a shell command.
- No keys in job payloads, logs, errors, or renderer events.
- Do not retain uploaded frame payloads after the request. Local temporary frames live in the project work directory and are deleted in `finally`.
- Honor explicit provider consent and local-first decisions. No hidden network activity, fallback, analytics, or automatic retry.
- Bound duration, frame count, image dimensions, output tokens, and response bytes. Cap each segment text length and total segment count.
- Add provider timeout and cancellation propagation if supported by the AI SDK adapter; avoid blocking the Electron main event loop during image encoding/decoding.

## 13. Testing plan (implementation gate)

### Pure/model tests

- Backward-compatible transcript parsing defaults for legacy speech rows.
- Source/status validation and visual segments with empty word arrays.
- Deterministic scene-aware sampling: boundaries, long scenes, max fps, per-chunk and total caps, duration clamping.
- Provider timestamp normalization, malformed JSON, overlap/bounds rejection, empty output, and chronological ordering.
- Visual-change sampling thresholds, duplicate suppression, temporal-coverage budget, crop generation, and deterministic evidence-index-to-frame mapping.
- Static wave/context assignment for any N and W; overlap samples excluded from output ranges; seam pass merges true duplicates and preserves distinct adjacent actions.
- Stable segment IDs/origins, revision conflicts, each edit operation's invariants, and undo/redo persistence.

### Main-process tests

- Enqueue validation, provider/consent checks, source missing, duration/frame limit, missing video stream.
- Successful pipeline persists visual provenance and segments, reindexes, refreshes snapshot, and cleans temporary files.
- Provider error/cancel midway preserves the prior transcript and cleans up files.
- A failed chunk aborts in-flight siblings in its wave, starts no later wave, and discards all partial output.
- Output normalization order is per-chunk validation, deterministic seam pass, then final whole-result bounds/order/overlap validation.
- Replacement requires explicit intent and only affects visual draft.
- Range regeneration preserves manual and edited rows by default, reports skipped intervals, and requires confirmation before replacing edits.
- Same fixture under W=1 and W=3 remains source-ordered with valid evidence/ranges; record seam repetition and inspect any output differences, accounting for provider nondeterminism.
- Project closed / asset removed before commit does not write.
- No fallback provider and no Whisper invocation.

### Renderer/E2E tests

- Entry action, provider disclosure, queued/running progress and cancel.
- Draft label, timing and evidence frames; click seeks; editing, split/merge/add/delete and undo/redo persist.
- Non-empty speech transcript blocks generation; empty Whisper junk requires explicit confirmation before replacement.
- Create captions uses selected visual segments and does not silently modify the timeline before confirmation.
- Caption clips stay unchanged after transcript edits; explicit update previews and updates only linked clips.
- Failure presents actionable error and existing transcript remains visible.

Do not claim support based only on mocked provider tests. Before release, exercise a short screen recording, a camera video with changing action, a static/blank clip, a long clip near the limit, and a provider failure with a real configured provider.

## 14. Delivery phases

0. **Real-media quality gate:** run the throwaway script on the five clips, inspect all outputs, tune visual-change sampling, frame resolution/cropping, prompts, and evidence mapping. Measure seam repetition for W=1/W=3 and overlap on/off. If overlap-only approaches W=1 quality, drop text-context dependency and allow full concurrency within provider limits. Stop if output misses the go/no-go bar.
1. **Model and repository groundwork:** provenance/status/revision, stable segment IDs and origin, backward-compatible defaults, one-transcript-per-asset block behavior, versioned writes and persistent scoped undo/redo.
2. **Pure media pipeline:** stream preflight, visual-change sampler with scene-cut support, budget-aware temporal coverage, high-resolution/cropped samples, contextual chunks, cleanup, structured output schema and frame-index mapping.
3. **Provider/job orchestration:** new job kind, explicit provider resolution/consent, bounded concurrency, cancellation, atomic range regeneration, search reindex and snapshot refresh.
4. **User review surface:** entry point, disclosure/estimate, job status, visual transcript editor with timing/split/merge/add/delete/undo/redo, captions and explicit regeneration choices.
5. **Hardening and release validation:** migration compatibility, provider failure/cancel, resource limits, measured performance/cost, representative-media regression review, and caption-update behavior.

Keep each phase shippable behind the UI entry point; do not expose partial results as a committed transcript.

## 15. Acceptance criteria

- A user can explicitly generate a timestamped visual narration draft from a silent video with a configured, consented vision provider.
- Every row has a valid source frame interval, seeks correctly, and contains text generated from visual evidence only.
- Speech transcripts are never overwritten or mislabeled; legacy projects load unchanged.
- The user can edit text/timing, split, merge, add, delete, undo, and redo rows; edits persist as reviewed visual narration.
- The user can explicitly create captions from the reviewed visual narration using the existing timeline path.
- Existing caption clips remain unchanged after transcript edits; an explicit update action previews and applies only linked caption clips.
- Progress, cancellation, failures, and retries are understandable; failed/cancelled work does not replace prior transcripts.
- Frames are bounded, temporary, and sent only to the selected provider after explicit user action.
- Search, status, and transcript UI distinguish visual narration from speech.

## 16. Decisions to settle during implementation

1. **Provider structured output:** check current `ai` SDK and provider adapters for consistent JSON-schema output. Fall back to strict JSON parsing, not freeform heuristics.
2. **Sampling defaults:** tune visual-change threshold/rate, 1280px versus crop strategy, chunk duration, 600-frame ceiling, and 20-minute duration using Phase 0 evidence.
3. **No-content result:** zero segments is a successful analysis with an explicit “No useful visual changes found” result and no saved transcript replacement.
