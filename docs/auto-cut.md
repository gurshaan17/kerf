# Auto cut

Auto cut selects useful content from one normal-speed video clip. It proposes
removals from visual evidence and speech in context, keeps uncertain material,
and lets the editor review the result before applying one undoable edit.
Duration is an outcome, not a quota.

## Using Auto cut

1. Select exactly one video clip on the timeline and click **Auto cut** in the
   timeline toolbar. A clip up to five minutes long can be analysed.
2. Optionally describe what to keep. Choose a vision-capable provider with both
   Vision and Chat consent enabled. The dialog explains what will be sent.
3. Choose **Analyse clip**. Progress and cancellation are available; closing the
   dialog cancels unfinished analysis. No cuts happen during this step.
4. Review the original/result duration and reasons for each proposed removal.
   Uncheck a section to keep it. **View section** plays the source at that point;
   **Preview edit** plays source footage while skipping checked removals. This
   source preview does not render timeline effects or mix other audio tracks.
5. Choose **Apply cuts**. Matching source audio is cut with video, later clips
   and markers shift, and one timeline Undo restores the entire edit.

If nothing is clearly irrelevant, the full clip stays and Apply is disabled.
If the timeline, speech evidence or source changes, analyse again. Failed,
cancelled and interrupted requests can be explicitly retried; no other provider
is chosen automatically. Use **Change purpose or analyse again** to revise a
completed proposal. Closing a completed review leaves its result in the local
job queue; the UI starts a fresh request when reopened.

## Implementation phases

1. **Cut planning:** build source-frame evidence units without splitting speech
   segments; validate provider decisions; merge adjacent removals with breathing
   margins; construct an ordinary atomic edit batch. Cut matching source audio
   with video, ripple subsequent timeline clips and markers, and preserve undo.
2. **Analysis service:** run explicitly requested, cancellable analysis through
   the existing provider and job infrastructure. Sample across continuous shots,
   combine visuals with local transcription, validate structured decisions, and
   reject stale project/source/provider state. Expose narrow IPC operations.
3. **Review UI:** select a timeline clip, open Auto cut, set an optional purpose,
   analyse, preview the kept ranges, restore individual removals, and apply.
   Verify the user journey and document provider use and limitations.

## Initial boundaries

- One normal-speed video clip, with at most one exact matching source audio
  clip. Cuts preserve source order and never modify the original media file.
- Overlapping media, captions, overlays, clip animation, retiming and affected
  locked tracks are rejected explicitly. Auto cut must not guess their sync.
- Later timeline content moves together to preserve relative timing.
- Analysis is a proposal. No edit is applied until the user selects Apply.
- No forced target duration, automatic publishing, or cloud fallback.

## Analysis service

The main-process AutoCutService owns generation, proposal retrieval and apply.
Its narrow preload API is `autoCut.generate`, `autoCut.proposal` and
`autoCut.apply`. Results are persisted in the existing job result, scoped to the
open project; no additional database or dependency is introduced.

Clips up to five minutes are sampled for temporal coverage and visual change.
Up to approximately 120 evidence frames are sent in one contextual request to
the selected vision-capable model. Providers with smaller image/context limits
may reject the request; there is no retry or automatic provider switch.
Previously detected scene boundaries are included when available; new scene
detection is not required to notice changes inside a continuous shot.

Video with audio requires a local Whisper installation/model unless a speech
transcript already exists. Only the selected source range is transcribed when
needed. This transient transcript does not replace stored speech or visual
narration. Speech timings are converted into the sequence frame rate and
sentence/pause boundaries are reconstructed from word timings before proposing
cuts. Units without speech remain eligible for contextual visual decisions.

Only clear removal decisions survive validation. Adjacent cuts are merged,
150 ms breathing margins are retained at interior boundaries, and removals
under 750 ms are discarded. A proposal that deletes all footage is rejected.

Generation and application check source file metadata and a fingerprint of the
project timeline, speech evidence and source identity. Consent/provider changes
stop generation; a changed timeline or source requires fresh analysis. Apply
accepts only IDs from the stored proposal, never model-generated edit commands
or renderer-provided timestamps. Queued/running jobs are cancelled on project
switch and require explicit re-analysis after an application restart.

## Verification

Model/engine tests cover evidence validation, uncertain decisions, speech
boundaries, source offsets, matching audio, head/tail cuts, a 120-second to
90-second edit, later linked overlays, marker ripple, and full undo/redo.
Service tests cover consent, source/timeline changes, cancellation, project
scope, restart behaviour and error redaction. Electron journeys use a controlled
local provider with real frame sampling, real Whisper transcription and actual
review/apply playback paths. They exercise restore, cancellation, invalid output,
empty output, stale review, smaller windows, audio sync and undo/redo.

These integration tests prove the editing path, not the editorial judgement of
any particular model. Real-provider quality should be evaluated on representative
talking-head, silent demonstration and repeated-take footage before relying on
its suggestions. Sampling can miss brief actions; review remains required.
