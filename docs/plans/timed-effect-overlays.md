# Timed Effect Overlays — Implementation Plan

> Status: proposed, awaiting decision confirmation
> Scope: Blur, Callout, Spotlight and magnifier Zoom overlays as timed `fxOverlay` clips on a dedicated Effects track.
> Baseline: `56fd626` (`feat(brand): replace the Kerf mark with the new logo`)

---

## 1. Objective

Add four timed effect overlays:

- **Blur** — `gaussian` or `pixelate`
- **Callout** — labelled region with an optional pointer
- **Spotlight** — dim everything outside a region
- **Zoom** — magnifier lens that redraws footage under the lens

Overlays are separate clips on a dedicated Effects track. Each has a normalized canvas-space region. Linked overlays follow their source clip on move, ripple, remove, clone and split. Trim/slip/speed do not move overlays.

All overlay edits must be reversible through the existing command/inverse/history system. Creating the Effects track and adding the first overlay must be one undo step.

Out of scope for v1: keyframes, tracking, solid redaction, speed retiming, auto-generated overlays.

Preview and export must match. All absolute sizes are expressed in 1080p-height units.

---

## 2. Corrections to the spec

These assumptions in the original spec do not match the current code:

| Spec assumption                                                       | Actual code                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview/export media is 540p                                          | Proxies are **720p** (`scale=-2:'min(720,ih)'`). Export and `renderSingleFrame` currently use the same proxy-backed `MediaPool`.                                                                                                                                |
| `renderFrame` returns a frame/image block                             | `renderFrame` is a compositor function returning `RenderStats`. The agent tool `renderFrame` returns `{ frame, width, height, mimeType, path }` where `path` is a local PNG written by `RendererBridge`. There is no `captureFrame` and no image content block. |
| Ripple shifts all tracks                                              | `rippleDeleteCommand` / `rippleTrimCommand` only move later clips **on the same track**.                                                                                                                                                                        |
| Move doesn’t check track locks                                        | `clip.move` delegates to `applyUpdate`, which calls `assertTrackUnlocked`. `clip.trim` also checks. Direct edits are already blocked on locked tracks. Only **follower** updates need an internal lock bypass.                                                  |
| Text/shape export as gaps                                             | They export as `Clip.1` entries with `metadata.kerf`, not gaps.                                                                                                                                                                                                 |
| There is no Effects track kind                                        | `trackKindSchema` already has `overlay`, which accepts all visual clip types. The new `effects` kind must be added alongside it, not replace it.                                                                                                                |
| Effects can sit directly above the video track and still draw over it | `tracksInOrder` sorts ascending from the top, and `renderFrame` draws in that order. The current compositor has no phase for “always over footage”. This needs an explicit compositing rule.                                                                    |

---

## 3. Recommended design decisions

These are the choices this plan assumes unless changed:

| #   | Decision                                      | Recommendation                                                                                                                                                           |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Effects z-order                               | Effects composite **above all footage** and **below text/captions**. Text/caption clips are deferred to a final pass when an overlay is active.                          |
| 2   | Effects track placement                       | Insert at the top of the timeline, directly above the main video track. Renumber existing track `order` values in the same batch so it stays the single source of truth. |
| 3   | Source clip deletion                          | Remove linked overlays automatically. Undo restores the clip and overlays as one step.                                                                                   |
| 4   | Dragging an overlay fully off its linked clip | Auto-unlink with a toast, one undo step.                                                                                                                                 |
| 5   | Region bounds                                 | Allow partially off-canvas overlays, requiring at least a small visible intersection. UI handles clamp to the canvas for v1.                                             |
| 6   | Transition clamp                              | Each transition ≤ `floor(duration / 2)`, and `in + out ≤ duration`. Clamp silently on insert/update/trim/split.                                                          |
| 7   | `props` shape                                 | Nested discriminated union under `props`; `props.kind` is immutable after creation.                                                                                      |
| 8   | OTIO                                          | Lane-pack overlapping overlays into multiple metadata-only OTIO tracks.                                                                                                  |
| 9   | Golden-frame dependency                       | Add `@napi-rs/canvas` as a root dev dependency.                                                                                                                          |
| 10  | Duplicating a linked overlay                  | Keep the same `linkedItemId`.                                                                                                                                            |
| 11  | Speed retiming                                | Deferred to P1, as the spec says.                                                                                                                                        |

---

## 4. Data model

### Files

- **New:** `packages/model/src/overlays.ts`
- `packages/model/src/clips.ts`
- `packages/model/src/commands.ts`
- `packages/model/src/sequence.ts`
- `packages/model/src/index.ts`

### Track kind

```ts
export const trackKindSchema = z.enum([
  'video',
  'audio',
  'caption',
  'overlay',
  'effects',
]);
```

Keep `overlay` as-is. `effects` is additive. Add `defaultTrackName('effects') => 'Effects'`.

Do **not** add an Effects track to `createSequence` by default. It is created lazily. That avoids breaking every fixture that assumes three default tracks.

### `fxOverlay` clip

```ts
export const overlayKindSchema = z.enum([
  'blur',
  'callout',
  'spotlight',
  'zoom',
]);

export const overlayShapeSchema = z.enum(['rect', 'ellipse']);

export const normalizedRegionSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  w: z.number().positive().max(2),
  h: z.number().positive().max(2),
});
```

The region is normalized to the canvas. Common props live inside `props`:

```ts
const overlayCommon = {
  region: normalizedRegionSchema,
  shape: overlayShapeSchema.default('rect'),
  cornerRadius: z.number().nonnegative().default(0),
  transitionInFrames: z.number().int().nonnegative().default(0),
  transitionOutFrames: z.number().int().nonnegative().default(0),
  easing: overlayEasingSchema.default('ease-in-out'),
};
```

Kind-specific props:

- `blur`: `{ kind: 'blur', mode: 'gaussian' | 'pixelate', amount: number }`
- `callout`: `{ kind: 'callout', text, textColor, background, borderColor, borderWidth, fontSize, pointer: { x, y } | null }`
- `spotlight`: `{ kind: 'spotlight', dim, feather, color }`
- `zoom`: `{ kind: 'zoom', zoom, focus: { x, y }, borderColor, borderWidth, shadow }`

Exact field names should mirror the spec; the important structural choice is that all visual parameters live under `props`, so there is no collision with the existing flat `shape` patch field.

```ts
export const fxOverlayClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('fxOverlay'),
  linkedItemId: idSchema('clip').nullable().default(null),
  props: fxOverlayPropsSchema,
});
```

Add the variant to `clipSchema`. `ClipType` grows automatically.

### Command patches

No new command family is needed. Reuse `clip.insert`, `clip.update`, `clip.move`, `clip.trim`, `clip.split`, `clip.remove`, `clip.duplicate`, and `track.add`.

Add to `clipPatchSchema`:

```ts
props: overlayPropsPatchSchema.optional(),
linkedItemId: idSchema('clip').nullable().optional(),
```

`overlayPropsPatchSchema` is a partial object covering the common fields plus every kind-specific field. The engine:

1. Rejects a `props.kind` change.
2. Deep-merges `props` with the existing props, including nested `region`, `focus`, and `pointer`.
3. Revalidates the full overlay clip.
4. Clamps transitions against the current duration.

Keep the inverse simple: `capturePreviousPatch` captures the old `props` object wholesale.

### Duration helpers

`packages/engine/src/queries.ts`:

- `sequenceDurationFrames` must **exclude** `fxOverlay` clips so a trailing overlay never extends export.
- Add `timelineDurationFrames` that **includes** overlays for the timeline scroll area and ruler.
- Add `clipsAtFrame(track, frame)` returning all active clips sorted by start frame, then insertion index. Keep `clipAtFrame` for single-active-clip tracks.

---

## 5. Engine: link propagation and inverses

### Files

- **New:** `packages/engine/src/links.ts`
- **New:** `packages/engine/src/effects-track.ts`
- **New:** `packages/engine/src/overlays.test.ts`

### Compatibility

`packages/engine/src/compatibility.ts`:

```ts
effects: ['fxOverlay'],
```

Add `'effects'` to `trackKindLabel`. Restrict `fxOverlay` to `effects` tracks only. Keep `overlay` tracks for the existing visual clips.

Also update `assertVisualClip` in `apply.ts` so `clip.addEffect` / masks cannot be applied to an `fxOverlay`; those are unrelated systems.

### Overlap

`assertNoOverlap` should return early when `track.kind === 'effects'`. Overlays are allowed to overlap; they draw in start order, then insertion order.

Also update `pasteClipsCommand`’s collision loop so pasted overlays do not push themselves past existing overlays.

### Operation matrix

| Operation                                             | Linked overlay behavior                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `clip.move` / `clip.update` changing `startFrame`     | Shift linked overlays by the same delta                                                                             |
| `clip.move` changing track only                       | No overlay shift                                                                                                    |
| `clip.remove`                                         | Remove linked overlays in the same result                                                                           |
| `clip.duplicate`                                      | Clone linked overlays with new ids, actual offset, linked to the copy                                               |
| `clip.split`                                          | Left keeps original id; overlays starting at/after the split re-link to the right half; spanning overlays stay left |
| `clip.trim`                                           | No overlay movement; if trimming the overlay itself, clamp its transitions                                          |
| `clip.slip`, `setSpeed`, `setTimeMap`, `setKeyframes` | No overlay movement                                                                                                 |
| ripple delete / ripple trim                           | No special code; follow falls out of `clip.remove` / `clip.move`                                                    |
| `track.remove`                                        | Remove overlays linked to clips on the removed track; restore them in the inverse                                   |
| Overlay move / trim / split                           | Never move the source clip                                                                                          |

### Inverse correctness

This is the part most likely to break, so centralize it in `links.ts`:

- `linkedOverlays(sequence, sourceClipId)`
- `shiftLinkedOverlays(tracks, sourceClipId, delta)`
- `removeLinkedOverlays(tracks, sourceClipId)`
- `cloneLinkedOverlays(tracks, sourceClipId, newClipId, delta)`
- `relinkAfterSplit(tracks, sourceClipId, rightId, splitFrame)`
- `clampOverlayTransitions(props, duration)`

For `clip.move`, always return a `clip.move` inverse back to the original track/start, even for cross-track moves. That way the inverse re-runs the follow logic and shifts overlays back. Do not return the generic remove/insert batch that `applyUpdate` currently produces for cross-track moves.

For `clip.remove`, return a batch inverse that inserts the source clip and each removed overlay at its original index.

For `clip.split`, the inverse must run in this order:

1. Re-link relinked overlays back to the left clip.
2. Remove the right half.
3. Restore the left half’s duration and media timing.

If the right half is removed while overlays are still linked to it, the remove follow would delete them.

For `clip.duplicate`, the inverse can stay `clip.remove` of the duplicate because the cloned overlays are linked to the duplicate and cascade with it.

### Follower lock bypass

Direct overlay edits must still respect locks. Follower updates must not. Implement follower helpers as direct track-map transforms that:

- validate the updated clip with `clipSchema.parse`
- skip `assertTrackUnlocked`
- skip overlap assertions on effects tracks

That satisfies “linked overlays follow even when the Effects track is locked” without weakening direct-edit locking.

### Lazy Effects track

`effects-track.ts`:

```ts
findEffectsTrack(sequence)
ensureEffectsTrackCommands(sequence): {
  commands: EditCommand[];
  trackId: TrackId;
  created: boolean;
}
```

When creating:

1. Shift every existing track’s `order` by `+1` with `track.update` order-only patches. Order-only updates are allowed on locked tracks.
2. `track.add` an `effects` track with `order: 0`, `index: 0`, name `Effects`.
3. `clip.insert` the first overlay.

All three go in one `batch`, so the first overlay add is one undo/redo step. The inverse is applied in reverse by `applyBatch` and works correctly.

Placement is “directly above the main video track” visually because the new track gets the lowest order. The compositor phase below makes the drawing order explicit rather than relying on timeline position.

---

## 6. Compositor

### Files

- **New:** `packages/canvas/src/overlays.ts`
- **New:** `packages/canvas/src/scratch.ts`
- **New:** `packages/canvas/src/overlay-golden.test.ts`
- `packages/canvas/src/media-pool.ts`
- `packages/canvas/src/render.ts`
- `packages/canvas/src/index.ts`
- `src/renderer/export/render-export.ts`
- `src/renderer/preview/Preview.tsx`

### Render phases

`renderFrame` should use explicit phases:

```text
1. background / checkerboard
2. base visual clips in track order
     - video, image, shape, composition, non-deferred text
3. effects tracks in track order
     - all active overlays, sorted by start then insertion order
4. deferred text/caption clips at normal scale
5. selection outline
```

Only defer text/caption when at least one overlay is active at the current frame. If no overlay is active, preserve current behavior exactly. This avoids changing existing z-order for projects without overlays.

This guarantees:

- Blur/spotlight/callout never affect captions.
- Zoom never magnifies captions.
- Effects always draw above footage regardless of where the Effects track appears in the timeline.

### Media quality

`MediaPool` currently always uses `asset.cache.proxyPath`. Change it to support slots:

```ts
media(assetId, quality?: 'proxy' | 'source')
video(assetId, quality?: 'proxy' | 'source')
isReady(assetId, quality?: 'proxy' | 'source')
ensure(assetId, quality: 'proxy' | 'source')
```

Implementation:

- Store `{ proxy?: HTMLVideoElement; source?: HTMLVideoElement }` per video asset.
- Images always use the source.
- Create the proxy slot by default.
- Create the source slot lazily when `ensure` / `media(..., 'source')` is called.
- Fall back to the other slot if the requested slot is not ready.
- Source-slot videos stay muted; the proxy slot owns preview audio.
- Notify listeners when either slot loads.

Export and `renderSingleFrame` use `defaultQuality: 'source'`. Preview uses proxy for normal drawing, and the zoom lens requests source. If the source is not ready, the lens falls back to proxy; `MediaPool.onReady` triggers a re-render when it loads.

Update `Preview.tsx`’s `syncVideos`, `seekVideos`, and `pauseVideos` to seek/play both slots. Update `render-export.ts`’s `seekFrameMedia` to seek the source slot.

Refactor `mediaReady` / `sourceSize` in `render.ts` to duck-type instead of using `instanceof HTMLVideoElement`. This is required for Node golden tests and also makes the compositor less DOM-coupled.

### Overlay renderer

`drawOverlay(context, overlay, frame, sequence, options)`:

- Compute the region in canvas pixels from normalized values.
- Build the clip path once for rect-with-radius or ellipse.
- Compute transition opacity with easing and multiply by `transform.opacity`.
- Scale all absolute sizes by `sequence.height / 1080`. Region stays normalized.
- Rasterize each kind:

**Blur**

- Copy the region into a scratch canvas.
- Gaussian: use a 3-pass separable box blur on `ImageData` in `scratch.ts`, so results are identical in Chromium and Node goldens. Do not depend on `context.filter`.
- Pixelate: downscale into a small scratch canvas, then upscale with `imageSmoothingEnabled = false`.
- Draw back clipped to the shape with the transition alpha.

**Spotlight**

- Create an alpha mask scratch canvas.
- Fill the canvas, punch out the region shape, feather with the same blur helper.
- Draw a dim color layer through the mask at `props.dim * transitionOpacity`.

**Callout**

- Draw rounded rect/ellipse background and border.
- Reuse a shared text-layout helper extracted from `drawText`.
- Draw optional pointer line/triangle from the nearest region edge to `props.pointer`.
- Scale font size, padding, border width, and corner radius by the 1080p unit.

**Zoom / magnifier**

- Clip to the lens shape.
- Apply `translate(lensCenter) -> scale(zoom) -> translate(-focusPoint)`.
- Redraw only non-text visual layers that intersect the lens region: video, image, shape, composition. Skip text/caption.
- Use source-quality media for the redraw.
- Draw the lens border/shadow after restoring the transform.
- The focus point is the content point that should appear at the lens center. Default it to the region center.

**Transitions**

- Fade in over `transitionInFrames`, out over `transitionOutFrames`.
- Clamp at the model/engine layer, but the renderer should also guard against `in + out > duration`.

**Scratch surfaces**

`scratch.ts` owns reusable offscreen canvases keyed by size and purpose. Reuse them across frames to avoid allocating multiple full-frame canvases per overlay per frame.

---

## 7. UI

### Left rail Effects panel

- `packages/ui/src/shell/StudioShell.tsx`
  - Add an `effectsPanel?: ReactNode` prop.
  - Add `{ id: 'effects', label: 'Effects', icon: <Wand2 /> }` to `railItems`.
  - Render it when `rail === 'effects'` and include it in `showLeftPanel`.
- `packages/ui/src/shell/shell.css`
  - Styles for overlay cards, kind badges, effect list rows, and the effects track lane.
- `src/renderer/App.tsx`
  - Pass `<EffectsPanel />`.
- **New:** `src/renderer/effects/EffectsPanel.tsx`
  - Cards for Blur, Callout, Spotlight, Zoom with an Add button.
  - Existing overlay list with kind, timing, linked-source label, and selection.
  - Delete/unlink actions.
  - Add flow:
    - If a non-overlay clip is selected, create a linked overlay spanning that clip.
    - Otherwise create an unlinked 3-second overlay at the playhead.
    - Build the overlay via the engine helper, ensure the Effects track, and apply one batch.
    - Select the new overlay and seek the playhead to its start.

### Inspector

`src/renderer/inspector/Inspector.tsx`:

- Rename tab id `'effects'` → `'filters'`, label `Effects` → `Filters`. Rename `EffectsPanel` → `FiltersPanel` to match.
- For `clip.type === 'fxOverlay'`:
  - Replace the tab strip with a single `Overlay` tab.
  - Show timing, link, region, shape, corner radius, transitions, easing, and kind-specific controls.
  - Hide transform, motion, masks, and filters (not applicable in v1).
  - Add “Unlink” and “Delete overlay” actions.
- Every control dispatches one `clip.update` with a partial `props` patch. Continuous edits commit on `NumberInput` commit, matching the existing inspector pattern.

### Preview handles

- **New:** `src/renderer/preview/OverlayControls.tsx`
- Render an absolutely positioned HTML layer over the canvas, never inside the canvas, so handles never appear in export.
- Region: move by dragging the body; eight resize handles.
- Zoom: draggable focus dot.
- Callout: draggable pointer dot with a connector line.
- Use local drag state for live feedback. Commit one `clip.update` on pointer up; Escape cancels.
- Clamp handles to the canvas for v1.
- Hide handles during playback or when the selected clip is not an overlay.
- Account for letterboxing by measuring the canvas element’s bounding rect.

### Timeline

`src/renderer/timeline/Timeline.tsx`:

- Add an `effects` track row style/icon.
- Label overlay clips as `Blur · <linked clip label>` etc.
- Stack overlapping overlays vertically within the lane so they remain clickable.
- Add “Effects track” to the Add Track menu.
- Add overlay-specific context menu actions: Unlink, Delete.
- Use `timelineDurationFrames` for scroll/ruler extent, not `sequenceDurationFrames`.

`src/renderer/timeline/clip-commands.ts`:

- `nextTrackName` handles `effects`.
- `deleteClipsCommand` filters out overlay ids whose linked source is also selected, so the source remove cascade does not then fail on a missing overlay.
- `pasteClipsCommand` allows effects-track overlaps and auto-creates an Effects track if pasting an overlay with none present.
- Duplicate/delete already work through the engine, but add tests for overlays.

---

## 8. Tools and MCP

### Files

- **New:** `packages/tools/src/overlays.ts`
- `packages/tools/src/edit.ts`
- `packages/tools/src/read.ts`
- `packages/tools/src/index.ts`
- `src/main/mcp/server.ts`
- `src/main/agent/service.ts`

### New tools

`addOverlay`:

- Input: discriminated union on `kind` with common timing/region/link fields.
- Defaults:
  - linked source selected → span the source clip
  - otherwise → start at playhead, 3 seconds
  - centered region sized per kind
- Ensures the Effects track via the engine helper.
- Applies one batch.
- Returns `{ overlayId, trackId, trackCreated, startFrame, durationFrames }`.

`updateOverlay`:

- Input: `overlayId`, optional `startFrame`, `durationFrames`, `linkedItemId`, `label`, and partial `props`.
- Engine merges partial props.
- Returns the updated timing/link summary.

`readTimeline`:

- Extend `clipSummary` for `fxOverlay` with `{ overlayKind, region, shape, linkedItemId, transitionInFrames, transitionOutFrames, easing, props }`.

`listEffects`:

- Add `overlayKinds`, `overlayShapes`, and default overlay props.

### Captured-frame verification

`renderFrame` already returns a PNG path. Add image content in both transport paths:

- `src/main/mcp/server.ts`: when the tool is `renderFrame` and the result has a `path`, read the PNG and return an MCP `image` content block followed by the JSON text block.
- `src/main/agent/service.ts`: use the AI SDK v7 `toModelOutput` hook for `renderFrame` to return a text part plus an image part. Verify the exact content-part shape against the installed `ai` version.
- Keep the path in the text result for clients that cannot render images.

Add `renderFrame` tests for the image block and an agent test that a rendered overlay frame is returned as image content.

---

## 9. OTIO

`src/main/export/otio.ts`:

- Add `fxOverlay` metadata: `overlayKind`, `region`, `shape`, `linkedItemId`, transitions, easing, `props`, `effectsTrackId`.
- For `track.kind === 'effects'`, lane-pack overlays by start/end so overlapping overlays become separate OTIO tracks. Non-overlapping overlays stay on one track.
- Emit `Clip.1` entries with `MissingReference.1`, explicit gaps, and `metadata.kerf`.
- Exclude `fxOverlay` from the timeline duration calculation.

This is metadata-only: external NLEs will not render the overlays, but timing and parameters survive a round-trip.

`src/main/export/otio.test.ts`:

- One overlay: one effects track with correct gap.
- Two overlapping overlays: two lanes/tracks.
- Trailing overlay does not change `durationFrames`.
- Metadata round-trips.

---

## 10. Implementation phases

### Phase 1 — Model

Files:

- `packages/model/src/overlays.ts` (new)
- `packages/model/src/clips.ts`
- `packages/model/src/commands.ts`
- `packages/model/src/sequence.ts`
- `packages/model/src/index.ts`

Tests:

- `packages/model/src/clips.test.ts`
- `packages/model/src/commands.test.ts`

Done when:

- All four prop variants parse.
- Invalid kind/props/region are rejected with useful messages.
- `fxOverlay` is in the clip union.
- `effects` is in the track kind enum.
- Patch schema accepts partial props and rejects a kind change.

### Phase 2 — Engine core

Files:

- `packages/engine/src/compatibility.ts`
- `packages/engine/src/apply.ts`
- `packages/engine/src/queries.ts`
- `packages/engine/src/links.ts` (new)
- `packages/engine/src/effects-track.ts` (new)

Tests:

- `packages/engine/src/overlays.test.ts` (new)
- extend `inverse-suite.test.ts`
- extend `queries.test.ts`
- extend `compatibility.test.ts`
- extend `move-trim.test.ts`

Done when:

- Effects tracks allow overlapping overlays.
- All non-overlay tracks still reject overlaps.
- Link follow works for move, ripple, remove, duplicate, split, and track removal.
- Trim/slip/speed/time-map do not move overlays.
- Every operation’s inverse restores the exact sequence.
- First overlay add creates the track and clip in one undo.
- Trailing overlays do not extend `sequenceDurationFrames`, but do extend `timelineDurationFrames`.
- Locked Effects tracks still follow source edits; direct overlay edits remain blocked.

### Phase 3 — Compositor

Files:

- `packages/canvas/src/media-pool.ts`
- `packages/canvas/src/render.ts`
- `packages/canvas/src/overlays.ts` (new)
- `packages/canvas/src/scratch.ts` (new)
- `packages/canvas/src/index.ts`
- `src/renderer/export/render-export.ts`
- `src/renderer/preview/Preview.tsx`
- root `package.json` / lockfile for `@napi-rs/canvas` (dev-only)

Tests:

- `packages/canvas/src/render.test.ts`
- `packages/canvas/src/overlay-golden.test.ts` (new)

Done when:

- Four overlay kinds render at 1920×1080 and 960×540.
- 960×540 output matches a downscaled 1920×1080 render within tolerance.
- Text/caption glyphs are unchanged inside a zoom lens.
- Overlapping overlays draw in start/insertion order.
- Export and single-frame rendering request source-quality media.
- Preview falls back to proxy only until the source slot is ready.

### Phase 4 — Tools and MCP

Files:

- `packages/tools/src/overlays.ts` (new)
- `packages/tools/src/edit.ts`
- `packages/tools/src/read.ts`
- `packages/tools/src/index.ts`
- `src/main/mcp/server.ts`
- `src/main/agent/service.ts`

Tests:

- `packages/tools/src/edit.test.ts`
- `packages/tools/src/read.test.ts`
- `src/main/mcp/server.test.ts`
- `src/main/agent/service.test.ts`

Done when:

- `addOverlay` and `updateOverlay` are in the shared registry and therefore in both agent and MCP.
- Adding the first overlay through a tool is one undo.
- `readTimeline` exposes overlay details.
- `renderFrame` returns image content over MCP and to the built-in agent.

### Phase 5 — UI

Files:

- `packages/ui/src/shell/StudioShell.tsx`
- `packages/ui/src/shell/shell.css`
- `src/renderer/App.tsx`
- `src/renderer/effects/EffectsPanel.tsx` (new)
- `src/renderer/inspector/Inspector.tsx`
- `src/renderer/preview/OverlayControls.tsx` (new)
- `src/renderer/preview/Preview.tsx`
- `src/renderer/timeline/Timeline.tsx`
- `src/renderer/timeline/clip-commands.ts`

Tests:

- `src/renderer/timeline/clip-commands.test.ts`
- new e2e `test/e2e/overlays.spec.ts`

Done when:

- Left rail has a working Effects panel.
- Inspector tab says “Filters” for normal clips.
- Selecting an overlay shows editable overlay controls.
- Preview region/focus/pointer handles commit one update per drag.
- Timeline shows overlapping overlays as clickable bars.
- Effects track is created lazily on first add.
- Add/undo/redo of the first overlay leaves no stray Effects track.

### Phase 6 — OTIO, docs, acceptance

Files:

- `src/main/export/otio.ts`
- `src/main/export/otio.test.ts`
- `docs/architecture.md`
- `docs/tools.md`
- `docs/decisions.md`
- `test/e2e/overlays.spec.ts`

Done when:

- OTIO lane-packing and metadata tests pass.
- Docs describe the effects track, compositing phases, source/proxy policy, and link rules.
- The e2e acceptance suite covers all four overlay kinds, linked movement, deletion, undo, and preview/export parity.

---

## 11. Test plan

### Engine

- Parse and validate each overlay kind.
- Effects-track overlap accepted; all other tracks rejected.
- Move shifts linked overlays; trim/slip/speed/time-map do not.
- Ripple delete and ripple trim move/remove overlays correctly.
- Split relinks right-half overlays; undo relinks them left.
- Duplicate clones overlays and links them to the copy.
- Remove source deletes linked overlays; undo restores both.
- Track removal removes linked overlays and restores them on undo.
- Locked Effects track follows; direct overlay move/trim is rejected.
- First overlay add is one batch/inverse.
- Trailing overlay excluded from sequence duration.
- Inverse round-trip for every operation.

### Compositor

- Golden frame per kind at 1920×1080.
- Same frame at 960×540 matches the downscaled 1920×1080 frame.
- Transition start/mid/end opacity.
- Overlapping overlay order.
- Zoom lens redraws source-quality media, not proxy.
- Caption/text bounding boxes are identical with and without a zoom overlay at the same frame.
- Blur/spotlight do not affect deferred captions.

### Tools/MCP

- `addOverlay` creates the track and clip in one undo.
- `updateOverlay` merges partial props and preserves kind.
- `readTimeline` includes overlay details.
- `renderFrame` returns an image block.
- MCP and agent registries expose the same new tools.

### E2E acceptance

- Add each of the four overlays from the left rail.
- Drag/resize a region and see preview update.
- Move the source clip and confirm the overlay follows.
- Delete the source and confirm the overlay disappears; undo restores both.
- Undo the first overlay add and confirm the Effects track is gone.
- Export a frame with each overlay and compare against the preview.
- Add an overlay through the agent and verify with `renderFrame`.

Run after each phase:

```bash
pnpm typecheck
pnpm test
```

At the end:

```bash
pnpm test:e2e
```

---

## 12. Main risks

1. **Inverse complexity.** Link follow touches move, remove, duplicate, split, and track removal. Centralize in `links.ts` and add every operation to the inverse suite before UI work.
2. **Compositing order change.** Deferring text/caption only when an overlay is active limits the behavior change, but it still needs a regression test.
3. **Lens performance.** Redrawing layers under the lens is more expensive than a transform. Reuse scratch canvases and restrict redraws to intersecting clips.
4. **Double video decoding.** Lazy source slots help, but a lens over many clips can still load several source videos. Cap source slot creation to clips intersecting an active lens.
5. **Overlapping overlay UI.** Bars must remain selectable. Lane stacking is the simplest solution.
6. **Golden tests.** `@napi-rs/canvas` avoids a Playwright dependency, but the compositor must be duck-typed and must not rely on Chromium-only `context.filter` for overlays.
7. **OTIO consumers.** Lane-packed effects tracks are metadata-only; document that external NLEs will not render them.

---

## 13. Decisions to confirm

The plan above uses the recommended defaults. Confirm or change these before implementation:

1. **Compositing order:** Effects above all footage, text/captions last.
2. **Effects track placement:** Top of the timeline, directly above Video 1, by renumbering existing track orders in the same undo batch.
3. **Dragging an overlay fully off its linked clip:** Auto-unlink with a toast, or keep the link?
4. **Region bounds:** Allow partially off-canvas overlays with a visible intersection; UI clamps handles to the canvas.
5. **OTIO:** Lane-packed, metadata-only effects tracks.
6. **Golden tests:** Add `@napi-rs/canvas` as a dev dependency.

If these are acceptable, the next step is Phase 1: add the model schemas and tests, then run `pnpm typecheck && pnpm test` before touching the engine.
