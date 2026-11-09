# Transcript editing

Open a speech transcript from the Footage bin or the command palette. The Timeline view shows transcript passages in edit order; Full source retains the complete recording text. When the asset is absent from the timeline, the panel shows source text and seeking still works.

## Edit a passage

1. Check one or more segments. The passage includes the material between them.
2. Choose the timeline occurrence. Repeated uses of the same source are separate choices; matching video and audio are edited together through the timeline range.
3. Choose an action and select **Review passage**.
4. Review the struck-through text for removal, adjust start/end frames if needed, and optionally use **Preview source join**.
5. Select **Apply media edit**. **Undo media edit** restores the complete operation; the editor's normal redo also works.

Actions:

- **Remove and close gap:** removes the range across all tracks, closes the gap and retimes markers.
- **Extract copy to timeline end:** appends an editable copy across tracks, preserving the original passage.
- **Move to timeline end:** removes the passage, closes its gap and appends it across tracks.
- **Mute speech, keep visuals:** silences matching video/audio from this source in the selected interval without changing visual timing. Captions stay unchanged.

Kerf currently has one sequence per project. Extract creates timeline clips, not a separate project or exported file. Use the ordinary export workflow for delivery.

## Correct text

Select one segment and choose **Correct transcript text**. Saving changes the transcript and search index, with its own persistent text undo/redo history. It does not change speech or existing captions. Word timing is cleared for the corrected segment because the old word text no longer matches. Caption generation can still use the segment text and timing.

## Timing and safeguards

Transcript timestamps use the asset frame rate; edits convert them into sequence frames, including source trims and constant playback speeds. Each occurrence is bounded by the clip that contains it. If a selection spans several already-split clips, review/edit their overlapping portions separately with the occurrence picker. The review frame fields can also define an explicit timeline range across clips.

Cuts are segment-level, not acoustically aligned word edits. Source-join preview skips the removed interval in the original recording and plays about one second around the join. It is an approximate listening aid; review the edited timeline for the final mix, transitions, overlays and other tracks.

Edits refuse affected locked clips/tracks, speed ramps, keyframes and linked overlays. Unlink overlays or simplify those affected clips first. Partial captions require word timing; adjust boundaries or remove a caption that cannot be safely divided. Source recordings are never modified.

Automatic retake suggestions, precise word editing, arbitrary sentence drag-and-drop, and standalone extracted sequences remain future work.
