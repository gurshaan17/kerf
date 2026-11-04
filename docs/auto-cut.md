# Auto cut

Auto cut selects useful content from one normal-speed video clip. It proposes
removals from visual evidence and speech in context, keeps uncertain material,
and lets the editor review the result before applying one undoable edit.
Duration is an outcome, not a quota.

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
