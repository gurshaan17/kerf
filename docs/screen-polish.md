# Screen polish

Open **Effects → Screen polish → Suggest polish** with video clips on the timeline.
Kerf proposes up to twelve short zoom lenses at clip starts, skipping hidden or
locked video tracks and clips with existing linked effects. These are timing
cues, not detected clicks: imported video does not include cursor metadata.

Review each suggestion to seek to its timestamp. Choose Zoom lens, Spotlight or
Callout; adjust normalized focus percentages, start frame and duration in frames.
Callouts have editable text. Dismiss unwanted suggestions before applying.

**Apply screen polish** inserts the reviewed effects together as one undoable
edit. Timing is checked against the current source clip at apply time. If a source
was deleted or trimmed, correct the timing or regenerate suggestions. Unlock the
Effects track before applying.

Applied effects use the existing overlay preview/export path and persist with the
project. Select them in Effects or the timeline to adjust region, focus, text,
zoom amount and transition timing in the inspector or preview. Zoom uses the
existing magnifying lens; it does not animate a whole-frame camera.

## Implementation phases

1. Engine planner: conservative timing suggestions and validated, linked overlay
   commands with smooth transitions and atomic undo.
2. Effects panel review: focus, timing, preset choice, dismissal and apply controls.
3. Verification: planner boundaries, stale inputs, locked tracks, rendering and
   undo regression checks; usage documentation.

Future detection work needs interaction evidence (capture metadata or a validated
visual detector) before claiming automatic click targeting or tracking. User-defined
focuses currently share the built-in overlay styles; saved custom polish presets
are not implemented.
