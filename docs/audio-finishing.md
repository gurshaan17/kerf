# Audio finishing

Audio finishing is optional and independent of rough-cut approval. Select audio
or video clips with ready source audio, open **Assistant**, then expand **Audio
finishing**. No chat provider is required for the desktop controls.

## Reduce background noise

Select one audible, unlocked, normal-speed clip. If the video and its sound
are on separate tracks, select the audio clip. Under **Reduce background noise**,
choose **Light** or **Strong**, then **Preview noise reduction**. Use
**Original** and **Cleaned** to listen at the same position. Choose
**Apply noise reduction** to keep the cleaned audio. Undo restores the previous
setting. **Remove noise reduction** turns it off for that clip.

This local FFmpeg filter targets steady noise such as fan hum and hiss. Listen
for changes to the voice before applying. The cleaned audio is processed before
clip gain, fades, and ducking, and the same audio serves playback, measurement,
and export. The preview plays the selected clip's source audio in isolation.
Source recordings up to 30 minutes are supported. Kerf regenerates a missing
cleaned audio cache from the saved clip setting when needed.

## Measure and adjust gain

**Measure selected audio** measures the processed mix of exactly the selected
clips, from the earliest start to the latest end. It includes clip gain, volume
keyframes, fades, timing and track mute state. It excludes other clips and the
exporter's existing master limiter. Results identify clip IDs, sequence frame
range, source/project revision, integrated loudness in LUFS and true peak in
dBTP. Silent/muted selections and audio too short or quiet for integrated
loudness have explicit states instead of invented values.

Choose a loudness target, peak ceiling and minimum fade duration, then **Plan gain
and fades**. Review the target, estimated gain/peak and per-clip changes. Planning
does not edit. **Apply reviewed audio changes** creates one ordinary undo step.
Gain scales all selected clips equally, preserving their relative levels. Short
fades round up to sequence frames, are capped at half the clip duration, and
never shorten existing fades. Existing volume automation is rejected explicitly.

Targets range from −40 to −8 LUFS and ceilings from −24 to 0 dBTP. The initial
−16 LUFS/−1 dBTP controls are editable starting values, not a delivery-standard
guarantee. Clip gain remains within 0–4. If gain alone would exceed the ceiling
or gain range, the plan is unattainable and Apply is disabled. No limiter is
introduced to force the target. The existing export master limiter remains.
Fades and mixed material affect final loudness: listen and remeasure after Apply.

## Duck background under speech

Select background clips, then choose the speech clips listed under
**Speech-envelope ducking**. Speech sources must have reviewed speech transcripts;
visual descriptions are insufficient. Set background gain during speech, attack
and release, then plan and review before Apply. Defaults are 35%, 100 ms attack
and 250 ms release. Ramp durations round to the nearest sequence frame, minimum
one frame; review shows the actual frame counts and attenuation.

Word intervals are used where available, otherwise transcript segments. Native
source timing is mapped through source trims into sequence time. Nearby intervals
merge when their ramps overlap. Only intersecting background spans are lowered;
existing speech clips and unrelated clips remain unchanged. Indexed speech cannot
be chosen as background. Existing background volume automation is rejected rather
than replaced. Base gain and fades are preserved. Undo restores the exact prior
sequence. The existing `duckUnderSpeech` macro also uses these envelopes, with
100/250 ms ramps; it continues to apply directly as an ordinary macro.

## Local limits and lifecycle

Finishing supports one to twenty explicit, normal-speed clips per scope, without
time remapping. Measurements span at most ten minutes and stop after sixty
seconds. **Cancel measurement**, project switching, turn cancellation and app
shutdown cancel the applicable local process. FFmpeg errors are shown; no provider
fallback or automatic retry occurs.

Measurements and plans use a bounded in-memory cache of 32 entries each with a
five-minute lifetime. Reopening the app does not restore plans, measure audio,
start a model call or apply changes. Project/source/index changes invalidate
review eligibility. Relink changed sources, then explicitly measure or plan again.
An applied plan cannot be replayed, including after Undo, while it remains in the
session cache. Chat retains plan/measurement IDs as navigation facts; actual
reviewed commit receipts are persisted immediately to their originating
conversation, including an inactive conversation.

## Implementation and verification

The existing command model stores absolute clip-local volume keyframes. A shared
model sampler multiplies volume automation by fades. Playback uses Web Audio gain
nodes, supporting amplification above 100%; export and measurement derive
sample-level FFmpeg expressions from the same curve, preserving input channels.
Continuous curves are flattened within 0.0001 gain error, with subframe step
transitions and a 256-point limit. Filter graphs above 100,000 characters fail
explicitly. Gain and ducking use the existing volume automation model.

Unit coverage checks frame mapping, clipped ramps, unrelated clips, automation
conflicts, exact undo, gain calculations, silence, stale sources, cancellation and
receipt persistence across database reopen. The Electron journey measures a known
stereo tone, rejects an unattainable target, applies and remeasures gain, checks
actual playback gain nodes, renders the ducking filter, compares background RMS
inside/outside speech, and checks ramp continuity and replay rejection.

The journey also writes ignored local audition files:

- `.cache/e2e/phase5-listening-before.wav`
- `.cache/e2e/phase5-listening-after.wav`
- `.cache/e2e/phase5-ducked-background.wav`

For a listening check, compare the before/after speech mix at equal playback
volume, especially the indexed 3–4 and 5–6 second spans. Check that speech remains
intelligible, background recovers between spans, and ramp boundaries do not click
or pump abruptly. Then audition representative real project material. Automated
signal checks and unchanged speech clips do not establish subjective
intelligibility; human listening evaluation remains to be recorded.

Denoising, source separation and generated audio are outside this phase.
