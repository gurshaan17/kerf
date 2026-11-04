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
