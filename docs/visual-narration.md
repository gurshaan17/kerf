# Visual narration

Kerf can turn a silent video into a timestamped, editable visual narration draft. Descriptions come from sampled frames, so review their wording and timing before publishing or making captions. This feature does not recover inaudible speech.

## Use it

1. Import a video, select it in Footage, and choose **Visual narration**.
2. Choose an enabled vision provider with image-analysis consent, select a source range up to 20 minutes, and choose **Send frames and generate draft**. This sends sampled images to that account; provider charges may apply. No provider is substituted on failure.
3. Review the draft alongside Source Preview. **View evidence** and **Evidence timestamps** seek to the source images used for each description. These evidence times are separate from the editable narration interval.
4. Save text or timing changes, split at the source playhead, select consecutive rows to merge, add manual rows, or delete rows. Splitting divides text approximately by its position in the interval; it does not infer word timings. Undo/redo restores the last 30 committed narration states and survives project reopening. The narration controls have separate history from timeline Undo.
5. Choose **Mark reviewed** after checking all rows. Add the source video to the timeline, then use **Create / update captions**. The preview reports how many generated caption clips will be replaced. Confirm to apply one undoable timeline batch.

Save or clear pending text/timing edits before reviewing, regenerating, or updating captions. Editing and regeneration return a draft to unreviewed status. Existing caption clips stay unchanged until you explicitly update them; manual caption clips are preserved. Updating linked generated clips replaces changes made directly to those clips.

## Regeneration and safety

**Regenerate range** replaces generated rows fully contained in the chosen source range. Edited and manual rows are kept by default; replacing edited rows requires an explicit checkbox with the affected-row count. Manual rows and rows crossing the range boundary are preserved. New proposals overlapping protected rows are discarded rather than clipped; analysis still examines the requested range, including protected intervals. Regeneration itself can be undone.

Writes carry the transcript revision and stale writes are rejected. Source media and provider/model settings are pinned when queueing and checked again while running. Editing from another client while generation runs invalidates that generated result. Closing/reopening the project cancels outstanding narration jobs. Interrupted requests require an explicit restart. Empty, failed, cancelled or stale runs keep the previous transcript. Temporary provider images are deleted after the run.

A nonempty speech transcript blocks visual generation, including questionable nonempty Whisper output. Empty speech output can be replaced only with explicit confirmation. Visual narration is never used as speech evidence by silence-cutting, speech-ducking or spoken rough-cut tools.

## Current limits

- Up to 600 unique primary frames per request, with chronological boundary frames repeated between chunks. Sampling follows visual change at a 4 fps probe rate, periodic context, and existing scene-cut hints. A full-frame 1280px image is used; changed-region crops are not included.
- Requests use deterministic waves (three concurrent chunks for Google; one for other adapters), previous-wave text context, and a context-only overlap image. Frame-index references are validated; no retries or provider fallback are used.
- Evidence may overlap. Initial narration intervals start at the first evidence frame, end at the next row's start, and use a maximum 3-second final hold. Invalid or unordered starts reject the result. Disjoint intervals still need human alignment review.
- Caption mapping converts source frames to the sequence frame rate. Each row must fit a normal-speed timeline clip; rows crossing trims or speed/time-map changes need adjustment. The first matching timeline occurrence is used when footage is repeated.
- The Phase 0 quality gate remains unresolved: ground-truth drafts need user approval, sampled alignment flags remain open, and monetary rates are unset. See [Phase 0 observations](visual-narration-phase0-review.md). Unit and local-provider desktop tests prove mechanics, not model accuracy on every video.

## Storage and verification

Visual provenance, revision, per-row origin/evidence, and bounded edit history live in the existing transcript JSON payload. Legacy records default to speech, revision zero and empty history; no SQL schema migration is required. Caption clips retain their transcript/segment linkage and generation revision. Project, transcript, job and provider ownership checks run in main through narrow Zod-validated IPC operations.

Focused tests cover generation commit/failure/empty output, source/provider changes, closure and interruption, stale revisions, persistent undo/redo, regeneration preservation, source-rate caption conversion, and explicit caption updates. The desktop journey uses real ffmpeg ingest/sampling and a local mock vision server to exercise generation → edit → undo/redo → split/merge → retime → manual add → regenerate → review → caption update.
