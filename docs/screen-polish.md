# Screen polish

Select a timeline video and open **Effects → Screen polish**. Choose a configured
vision provider and click **Analyse screen recording**. The provider needs to be
enabled with Vision consent in Analysis settings. Chat consent and speech
transcription are not required. Sampled images leave the device when using a
remote provider; a configured local vision model keeps inference local.

## Analyse and review

Kerf samples visual changes and static intervals locally, then sends chronological
image batches to the selected vision model. The model proposes important visible
screen interactions and results, with a target rectangle, effect type, short
callout label when appropriate, and an evidence-based reason. Static or uncertain
footage can produce no suggestions. There is no fallback that presents clip-start
cues as AI detections.

Each suggestion includes source evidence timestamps. Review a suggestion to seek
the timeline, inspect its evidence frames, and see the target rectangle over the
recording. Click the evidence preview to reposition the focus, or use the numeric
fields. Choose Zoom lens, Spotlight or Callout; edit focus size, position, start,
duration, transitions, zoom amount and callout text. Dismiss unwanted suggestions
or discard the whole draft. No timeline edit occurs during analysis or review.

**Apply screen polish** inserts the reviewed linked effects as one undoable edit.
Applied effects persist with the project and use the same compositor for preview
and export. Select an effect in the timeline or Effects list to refine it in the
inspector or preview. Source trims and letterboxing are accounted for when mapping
AI evidence to the timeline and canvas.

**Add manual suggestions** remains available without a provider. It creates a
clip-start cue for the selected video (or first eligible video), explicitly marked
as manual, for the same editing workflow.

## Bounds and lifecycle

- Analyse one normal-speed video clip of up to five minutes per job. Reset its
  transform and motion before analysis so the proposed regions match the source.
- The visual sampler has a 600-frame budget. Very dense recordings may need to be
  split further. Results are limited to 60 suggestions per clip.
- Unlock and show the source track; unlock the Effects track before applying.
- A changed timeline, source file or project invalidates the AI proposal. Analyse
  again before applying. Provider settings and consent are checked throughout
  analysis; changing them stops subsequent provider calls.
- Cancel from the panel. Closing the panel or switching projects cancels active
  work. Interrupted queued/running jobs do not resume provider use on app restart.
- Malformed model output, invalid evidence or failed analysis never edits the
  timeline. Temporary evidence images are removed after success or failure.

Detection uses sampled visual evidence, not recorded clicks or continuous cursor
tracking. Very brief interactions can be missed; scrolling or moving targets need
review and shorter timing. Zoom uses Kerf's magnifying lens, not a whole-frame
camera move. Built-in overlay styles are reused; custom saved polish presets and
capture metadata are separate future work.

## Verification

Automated tests cover image requests to a fixture vision provider, response and
region validation, source trim and letterbox mapping, consent changes, stale and
forged proposals, cancellation, restart behavior and one-step undo. The desktop
journey covers review, editable focus, all three effect kinds, export-quality
frame rendering, undo/redo, project reopening, empty and invalid results, and
cancellation. These verify the integration; real-model detection quality depends
on the chosen vision model and recording and still needs review on real demos.
