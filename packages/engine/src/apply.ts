import type {
  Clip,
  ClipPatch,
  ClipType,
  EditCommand,
  Effect,
  EffectPatch,
  Mask,
  MaskPatch,
  Marker,
  MarkerPatch,
  NumberKeyframes,
  ReferenceProfile,
  Sequence,
  StyleConfig,
  TimeMapPoint,
  Track,
  TrackId,
  TrackPatch,
} from '@kerf/model';
import {
  clipSchema,
  effectSchema,
  fpsToNumber,
  isMediaClip,
  markerSchema,
  maskSchema,
  newId,
  numberKeyframesSchema,
  referenceProfileSchema,
  sequenceSchema,
  styleConfigSchema,
  timeMapSchema,
  trackSchema,
} from '@kerf/model';
import { assertClipCompatible } from './compatibility';
import { EngineError } from './errors';
import {
  clampOverlayTransitions,
  cloneLinkedOverlays,
  relinkAfterSplit,
  removeLinkedOverlays,
  resolveOverlayPropsPatch,
  shiftLinkedOverlays,
} from './links';
import type { OverlayLocation } from './links';
import {
  findClip,
  findOverlap,
  findTrack,
  requireClip,
  requireTrack,
  tracksInOrder,
} from './queries';
import {
  captureSequenceTiming,
  restoreSequenceTiming,
  retimeSequence,
} from './retime';
import { clipSourceRange, sampleTimeMap, sourceFrameAt } from './source';

export interface ApplyResult {
  sequence: Sequence;
  inverse: EditCommand | null;
}

/**
 * Optional facts the engine cannot read from a sequence. Ingest supplies the
 * source duration so trims can refuse to run past the end of the media.
 */
export interface ApplyContext {
  sourceDurationFrames?: (assetId: string) => number | undefined;
}

const COMMON_PATCH_KEYS = [
  'trackId',
  'startFrame',
  'durationFrames',
  'label',
  'locked',
  'transform',
  'blendMode',
] as const satisfies readonly (keyof ClipPatch)[];

const PATCH_KEYS_BY_TYPE: Record<ClipType, readonly (keyof ClipPatch)[]> = {
  video: ['assetId', 'sourceInFrame', 'speed', 'volume', 'fade', 'timeMap'],
  audio: ['assetId', 'sourceInFrame', 'speed', 'volume', 'fade', 'timeMap'],
  image: ['assetId', 'fit'],
  text: ['text', 'style'],
  caption: ['text', 'style', 'words', 'transcriptId', 'segmentId'],
  shape: ['shape', 'width', 'height', 'fill', 'stroke', 'strokeWidth', 'path'],
  composition: ['compositionId', 'name'],
  fxOverlay: ['props', 'linkedItemId'],
};

function withTracks(sequence: Sequence, tracks: Sequence['tracks']): Sequence {
  return { ...sequence, tracks };
}

function parseClip(value: unknown): Clip {
  try {
    return clipSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The clip payload is not valid for its type.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseEffect(value: unknown): Effect {
  try {
    return effectSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The effect payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseMask(value: unknown): Mask {
  try {
    return maskSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The mask payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseKeyframes(value: unknown): NumberKeyframes {
  try {
    return numberKeyframesSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'Keyframes must be ordered by frame.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseTimeMap(value: unknown): TimeMapPoint[] {
  try {
    return timeMapSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'Time map points must be ordered by timeline frame.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseTrack(value: unknown): Track {
  try {
    return trackSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The track payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseMarker(value: unknown): Marker {
  try {
    return markerSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The marker payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseStyle(value: unknown): StyleConfig {
  try {
    return styleConfigSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The style payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseReference(value: unknown): ReferenceProfile {
  try {
    return referenceProfileSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The reference payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function parseSequence(value: unknown): Sequence {
  try {
    return sequenceSchema.parse(value);
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The sequence payload is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function assertVisualClip(clip: Clip, feature: string): void {
  if (clip.type === 'audio') {
    throw new EngineError(
      'invalid-command',
      `An audio clip does not support ${feature}.`,
      'Add the edit to a video, image, text or shape clip instead.',
    );
  }
  if (clip.type === 'fxOverlay') {
    throw new EngineError(
      'invalid-command',
      `An effect overlay does not support ${feature}.`,
      'Edit the overlay from the Effects panel instead.',
    );
  }
}

function assertEffectPatchKeys(patch: EffectPatch): void {
  const allowed = new Set(['type', 'enabled', 'amount']);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `An effect has no editable "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }
}

function assertMaskPatchKeys(patch: MaskPatch): void {
  const allowed = new Set([
    'type',
    'x',
    'y',
    'width',
    'height',
    'rotation',
    'feather',
    'opacity',
    'inverted',
    'path',
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `A mask has no editable "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }
}

function compactEffectPatch(patch: EffectPatch): EffectPatch {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as EffectPatch;
}

function capturePreviousEffectPatch(
  effect: Effect,
  patch: EffectPatch,
): EffectPatch {
  const result: Record<string, unknown> = {};
  const source = effect as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as EffectPatch;
}

function compactMaskPatch(patch: MaskPatch): MaskPatch {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as MaskPatch;
}

function capturePreviousMaskPatch(mask: Mask, patch: MaskPatch): MaskPatch {
  const result: Record<string, unknown> = {};
  const source = mask as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as MaskPatch;
}

function assertTrackClips(track: Track): void {
  for (const clip of track.clips) {
    if (clip.trackId !== track.id) {
      throw new EngineError(
        'invalid-command',
        `Clip ${clip.id} points at track ${clip.trackId}, not ${track.id}.`,
        'Set the clip trackId to the track it belongs to.',
      );
    }
    assertClipCompatible(track, clip);
  }
}

function compactTrackPatch(patch: TrackPatch): TrackPatch {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as TrackPatch;
}

function capturePreviousTrackPatch(
  track: Track,
  patch: TrackPatch,
): TrackPatch {
  const result: Record<string, unknown> = {};
  const source = track as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as TrackPatch;
}

function compactMarkerPatch(patch: MarkerPatch): MarkerPatch {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as MarkerPatch;
}

function capturePreviousMarkerPatch(
  marker: Marker,
  patch: MarkerPatch,
): MarkerPatch {
  const result: Record<string, unknown> = {};
  const source = marker as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as MarkerPatch;
}

function compactStylePatch(patch: Partial<StyleConfig>): Partial<StyleConfig> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as Partial<StyleConfig>;
}

function capturePreviousStylePatch(
  style: StyleConfig,
  patch: Partial<StyleConfig>,
): Partial<StyleConfig> {
  const result: Record<string, unknown> = {};
  const source = style as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as Partial<StyleConfig>;
}

function assertTrackUnlocked(track: Track): void {
  if (track.locked) {
    throw new EngineError(
      'locked',
      `Track "${track.name}" is locked.`,
      'Unlock the track before editing its clips.',
    );
  }
}

function assertNoOverlap(
  track: Track,
  clip: Clip,
  ignoreClipId?: string,
): void {
  if (track.kind === 'effects') {
    return;
  }
  const overlap = findOverlap(
    track,
    clip.startFrame,
    clip.durationFrames,
    ignoreClipId,
  );
  if (!overlap) {
    return;
  }

  throw new EngineError(
    'overlap',
    `"${overlap.label || overlap.id}" already occupies those frames on "${
      track.name
    }".`,
    'Move the clip to an empty range, or trim the neighbouring clip first.',
  );
}

function assertIndex(index: number, length: number): void {
  if (index < 0 || index > length) {
    throw new EngineError(
      'invalid-range',
      `Cannot insert at index ${index} on a track with ${length} clips.`,
      `Use an index between 0 and ${length}.`,
    );
  }
}

function assertListIndex(index: number, length: number, label: string): void {
  if (index < 0 || index > length) {
    throw new EngineError(
      'invalid-range',
      `Cannot insert ${label} at index ${index} in a list of ${length}.`,
      `Use an index between 0 and ${length}.`,
    );
  }
}

function assertChildIndex(
  index: number,
  length: number,
  kind: 'effect' | 'mask',
): void {
  if (index < 0 || index > length) {
    throw new EngineError(
      'invalid-range',
      `Cannot insert ${kind} ${index} on a clip with ${length} ${kind}s.`,
      `Use an index between 0 and ${length}.`,
    );
  }
}

function patchKeys(clip: Clip): Set<string> {
  return new Set<string>([
    ...COMMON_PATCH_KEYS,
    ...PATCH_KEYS_BY_TYPE[clip.type],
  ]);
}

function assertPatchKeys(clip: Clip, patch: ClipPatch): void {
  const allowed = patchKeys(clip);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    if (!allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `A ${clip.type} clip has no editable "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }
}

function compactPatch(patch: ClipPatch): ClipPatch {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result as ClipPatch;
}

function capturePreviousPatch(clip: Clip, patch: ClipPatch): ClipPatch {
  const result: Record<string, unknown> = {};
  const source = clip as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) {
      result[key] = source[key];
    }
  }
  return result as ClipPatch;
}

function applyInsert(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.insert' }>,
): ApplyResult {
  const track = requireTrack(sequence, command.clip.trackId);
  assertTrackUnlocked(track);

  let clip = parseClip(command.clip);
  if (clip.type === 'fxOverlay') {
    const props = clampOverlayTransitions(clip.props, clip.durationFrames);
    if (props !== clip.props) {
      clip = parseClip({ ...clip, props });
    }
  }
  if (findClip(sequence, clip.id)) {
    throw new EngineError(
      'invalid-command',
      `Clip ${clip.id} already exists in this sequence.`,
      'Give the new clip a fresh identifier.',
    );
  }

  assertClipCompatible(track, clip);
  assertNoOverlap(track, clip);

  const index = command.index ?? track.clips.length;
  assertIndex(index, track.clips.length);

  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === track.id
      ? {
          ...candidate,
          clips: [
            ...candidate.clips.slice(0, index),
            clip,
            ...candidate.clips.slice(index),
          ],
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: { type: 'clip.remove', clipId: clip.id },
  };
}

function applyRemove(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.remove' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);

  const cascade = removeLinkedOverlays(sequence.tracks, location.clip.id);
  const tracks = cascade.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.filter((clip) => clip.id !== location.clip.id),
        }
      : candidate,
  );

  const inserts: Array<{ trackId: TrackId; index: number; clip: Clip }> = [
    {
      trackId: location.track.id,
      index: location.index,
      clip: location.clip,
    },
    ...cascade.removed.map((entry) => ({
      trackId: entry.trackId,
      index: entry.index,
      clip: entry.clip,
    })),
  ];
  const trackOrder = new Map(
    sequence.tracks.map((candidate, index) => [candidate.id, index]),
  );
  inserts.sort(
    (left, right) =>
      (trackOrder.get(left.trackId) ?? 0) -
        (trackOrder.get(right.trackId) ?? 0) || left.index - right.index,
  );

  if (inserts.length === 1) {
    return {
      sequence: withTracks(sequence, tracks),
      inverse: {
        type: 'clip.insert',
        clip: location.clip,
        index: location.index,
      },
    };
  }

  const lockedOverlayTracks = [
    ...new Set(cascade.removed.map((entry) => entry.trackId)),
  ].filter(
    (trackId) =>
      sequence.tracks.find((candidate) => candidate.id === trackId)?.locked,
  );
  const inverseCommands: EditCommand[] = [];
  for (const trackId of lockedOverlayTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: false },
    });
  }
  for (const entry of inserts) {
    inverseCommands.push({
      type: 'clip.insert',
      clip: entry.clip,
      index: entry.index,
    });
  }
  for (const trackId of lockedOverlayTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: true },
    });
  }

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'batch',
      label: 'Undo remove',
      commands: inverseCommands,
    },
  };
}

function applyUpdate(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.update' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);

  const patch = compactPatch(command.patch);
  assertPatchKeys(location.clip, patch);

  const effectivePatch: ClipPatch =
    location.clip.type === 'fxOverlay'
      ? {
          ...patch,
          props: resolveOverlayPropsPatch(
            location.clip.props,
            patch.props ?? {},
            patch.durationFrames ?? location.clip.durationFrames,
          ),
        }
      : patch;

  let updated = parseClip({ ...location.clip, ...effectivePatch });
  if (updated.type === 'fxOverlay') {
    const props = clampOverlayTransitions(
      updated.props,
      updated.durationFrames,
    );
    if (props !== updated.props) {
      updated = parseClip({ ...updated, props });
    }
  }

  const shift = updated.startFrame - location.clip.startFrame;
  const trackChanged = updated.trackId !== location.track.id;
  const inversePatch = capturePreviousPatch(location.clip, effectivePatch);

  if (!trackChanged) {
    assertClipCompatible(location.track, updated);
    assertNoOverlap(location.track, updated, updated.id);

    const tracks = shiftLinkedOverlays(
      sequence.tracks.map((candidate) =>
        candidate.id === location.track.id
          ? {
              ...candidate,
              clips: candidate.clips.map((clip) =>
                clip.id === updated.id ? updated : clip,
              ),
            }
          : candidate,
      ),
      updated.id,
      shift,
    );

    return {
      sequence: withTracks(sequence, tracks),
      inverse: {
        type: 'clip.update',
        clipId: updated.id,
        patch: inversePatch,
      },
    };
  }

  const target = requireTrack(sequence, updated.trackId);
  assertTrackUnlocked(target);
  assertClipCompatible(target, updated);
  assertNoOverlap(target, updated, updated.id);

  const insertionIndex = Math.min(
    command.index ?? location.index,
    target.clips.length,
  );
  const tracks = shiftLinkedOverlays(
    sequence.tracks.map((candidate) => {
      if (candidate.id === location.track.id) {
        return {
          ...candidate,
          clips: candidate.clips.filter((clip) => clip.id !== location.clip.id),
        };
      }
      if (candidate.id === target.id) {
        return {
          ...candidate,
          clips: [
            ...candidate.clips.slice(0, insertionIndex),
            updated,
            ...candidate.clips.slice(insertionIndex),
          ],
        };
      }
      return candidate;
    }),
    updated.id,
    shift,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.update',
      clipId: updated.id,
      patch: inversePatch,
      index: location.index,
    },
  };
}

function applyMove(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.move' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  const targetTrackId = command.trackId ?? location.track.id;
  const trackChanged = targetTrackId !== location.track.id;

  const result = applyUpdate(sequence, {
    type: 'clip.update',
    clipId: command.clipId,
    patch: {
      trackId: targetTrackId,
      startFrame: command.startFrame,
    },
    index: command.index,
  });

  return {
    sequence: result.sequence,
    inverse: {
      type: 'clip.move',
      clipId: command.clipId,
      trackId: location.track.id,
      startFrame: location.clip.startFrame,
      ...(trackChanged ? { index: location.index } : {}),
    },
  };
}

function trimTimeMapIn(
  points: readonly TimeMapPoint[],
  offset: number,
  newDuration: number,
): TimeMapPoint[] {
  const startSource = sampleTimeMap(points, offset) ?? 0;
  const endSource = sampleTimeMap(points, offset + newDuration) ?? startSource;
  const shifted = points
    .map((point) => ({
      frame: point.frame - offset,
      sourceFrame: point.sourceFrame,
    }))
    .filter((point) => point.frame > 0 && point.frame < newDuration);

  return [
    { frame: 0, sourceFrame: startSource },
    ...shifted,
    { frame: newDuration, sourceFrame: endSource },
  ];
}

function trimTimeMapOut(
  points: readonly TimeMapPoint[],
  newDuration: number,
): TimeMapPoint[] {
  const startSource = sampleTimeMap(points, 0) ?? 0;
  const endSource = sampleTimeMap(points, newDuration) ?? startSource;
  const kept = points.filter(
    (point) => point.frame > 0 && point.frame < newDuration,
  );

  return [
    { frame: 0, sourceFrame: startSource },
    ...kept,
    { frame: newDuration, sourceFrame: endSource },
  ];
}

function assertSourceBounds(clip: Clip, context: ApplyContext): void {
  if (!isMediaClip(clip)) {
    return;
  }

  const range = clipSourceRange(clip);
  const limit = context.sourceDurationFrames?.(clip.assetId);
  if (range.startFrame < 0 || (limit !== undefined && range.endFrame > limit)) {
    throw new EngineError(
      'invalid-range',
      `The trim would run past the available source for "${clip.label || clip.id}".`,
      limit === undefined
        ? 'Keep the source range at or after frame zero.'
        : `This source is ${limit} frames long. Trim inside that range.`,
    );
  }
}

function applyTrim(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.trim' }>,
  context: ApplyContext,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  const clip = location.clip;
  assertClipCompatible(location.track, clip);
  const movingIn = command.edge === 'in';
  const newStartFrame = movingIn
    ? clip.startFrame + command.frames
    : clip.startFrame;
  const newDuration = movingIn
    ? clip.durationFrames - command.frames
    : clip.durationFrames + command.frames;

  if (newStartFrame < 0) {
    throw new EngineError(
      'invalid-range',
      'A trim cannot move the clip before frame zero.',
      'Trim by a smaller amount or move the clip later first.',
    );
  }
  if (newDuration <= 0) {
    throw new EngineError(
      'invalid-range',
      'A trim must leave at least one frame.',
      'Use a smaller trim or remove the clip instead.',
    );
  }

  const changes: Record<string, unknown> = {
    startFrame: newStartFrame,
    durationFrames: newDuration,
  };

  if (isMediaClip(clip)) {
    if (clip.timeMap.length > 0) {
      changes.timeMap = movingIn
        ? trimTimeMapIn(clip.timeMap, command.frames, newDuration)
        : trimTimeMapOut(clip.timeMap, newDuration);
    } else if (movingIn) {
      const sourceInFrame =
        clip.sourceInFrame + Math.round(command.frames * clip.speed);
      if (sourceInFrame < 0) {
        throw new EngineError(
          'invalid-range',
          'The trim would start before the first source frame.',
          'Trim less, or extend the clip to the right instead.',
        );
      }
      changes.sourceInFrame = sourceInFrame;
    }
  }

  if (clip.type === 'fxOverlay') {
    changes.props = clampOverlayTransitions(clip.props, newDuration);
  }

  const updated = parseClip({ ...clip, ...changes });
  assertSourceBounds(updated, context);
  assertNoOverlap(location.track, updated, clip.id);

  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  let inversePatch: ClipPatch;
  if (clip.type === 'fxOverlay') {
    inversePatch = {
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      props: clip.props,
    };
  } else if (isMediaClip(clip)) {
    inversePatch = {
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
      sourceInFrame: clip.sourceInFrame,
      timeMap: clip.timeMap,
    };
  } else {
    inversePatch = {
      startFrame: clip.startFrame,
      durationFrames: clip.durationFrames,
    };
  }

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.update',
      clipId: clip.id,
      patch: inversePatch,
    },
  };
}

function applySplit(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.split' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertClipCompatible(location.track, location.clip);
  const clip = location.clip;
  const splitFrame = command.frame;
  const clipEnd = clip.startFrame + clip.durationFrames;

  if (splitFrame <= clip.startFrame || splitFrame >= clipEnd) {
    throw new EngineError(
      'invalid-range',
      'A split must land strictly inside the clip.',
      `Choose a frame between ${clip.startFrame + 1} and ${clipEnd - 1}.`,
    );
  }

  const leftDuration = splitFrame - clip.startFrame;
  const rightDuration = clipEnd - splitFrame;
  const leftChanges: Record<string, unknown> = {
    durationFrames: leftDuration,
  };
  const rightChanges: Record<string, unknown> = {
    id: newId('clip'),
    startFrame: splitFrame,
    durationFrames: rightDuration,
  };

  if (isMediaClip(clip)) {
    leftChanges.fade = {
      inFrames: Math.min(clip.fade.inFrames, leftDuration),
      outFrames: 0,
    };
    rightChanges.fade = {
      inFrames: 0,
      outFrames: Math.min(clip.fade.outFrames, rightDuration),
    };
    rightChanges.sourceInFrame = sourceFrameAt(clip, splitFrame);

    if (clip.timeMap.length > 0) {
      leftChanges.timeMap = trimTimeMapOut(clip.timeMap, leftDuration);
      rightChanges.timeMap = trimTimeMapIn(
        clip.timeMap,
        leftDuration,
        rightDuration,
      );
    }
  }

  if (clip.type === 'fxOverlay') {
    leftChanges.props = clampOverlayTransitions(clip.props, leftDuration);
    rightChanges.props = clampOverlayTransitions(clip.props, rightDuration);
  }

  const left = parseClip({ ...clip, ...leftChanges });
  const right = parseClip({ ...clip, ...rightChanges });
  const tracks = relinkAfterSplit(
    sequence.tracks.map((candidate) =>
      candidate.id === location.track.id
        ? {
            ...candidate,
            clips: candidate.clips.flatMap((candidateClip) =>
              candidateClip.id === clip.id ? [left, right] : [candidateClip],
            ),
          }
        : candidate,
    ),
    clip.id,
    right.id,
    splitFrame,
  );

  const inversePatch: ClipPatch = { durationFrames: clip.durationFrames };
  if (clip.type === 'fxOverlay') {
    inversePatch.props = clip.props;
  }
  if (isMediaClip(clip)) {
    inversePatch.sourceInFrame = clip.sourceInFrame;
    inversePatch.timeMap = clip.timeMap;
    inversePatch.fade = clip.fade;
  }

  const relinkedIds = new Set(tracks.relinked.map((overlay) => overlay.id));
  const lockedEffectsTracks = sequence.tracks
    .filter(
      (candidate) =>
        candidate.locked &&
        candidate.kind === 'effects' &&
        candidate.clips.some((candidateClip) =>
          relinkedIds.has(candidateClip.id),
        ),
    )
    .map((candidate) => candidate.id);
  const inverseCommands: EditCommand[] = [];
  for (const trackId of lockedEffectsTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: false },
    });
  }
  for (const overlay of tracks.relinked) {
    inverseCommands.push({
      type: 'clip.update',
      clipId: overlay.id,
      patch: { linkedItemId: clip.id },
    });
  }
  for (const trackId of lockedEffectsTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: true },
    });
  }
  inverseCommands.push({ type: 'clip.remove', clipId: right.id });
  inverseCommands.push({
    type: 'clip.update',
    clipId: left.id,
    patch: inversePatch,
  });

  return {
    sequence: withTracks(sequence, tracks.tracks),
    inverse: {
      type: 'batch',
      label: 'Undo split',
      commands: inverseCommands,
    },
  };
}

function applyDuplicate(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.duplicate' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  const target = command.trackId
    ? requireTrack(sequence, command.trackId)
    : location.track;
  assertTrackUnlocked(target);
  assertClipCompatible(target, location.clip);

  const startFrame = location.clip.startFrame + command.offsetFrames;
  if (startFrame < 0) {
    throw new EngineError(
      'invalid-range',
      'The duplicate offset would start before frame zero.',
      'Use a smaller negative offset or move the source clip first.',
    );
  }

  const duplicate = parseClip({
    ...location.clip,
    id: newId('clip'),
    trackId: target.id,
    startFrame,
  });
  assertNoOverlap(target, duplicate);

  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === target.id
      ? { ...candidate, clips: [...candidate.clips, duplicate] }
      : candidate,
  );
  const followed =
    duplicate.type === 'fxOverlay'
      ? tracks
      : cloneLinkedOverlays(
          tracks,
          location.clip.id,
          duplicate.id,
          duplicate.startFrame - location.clip.startFrame,
        ).tracks;

  return {
    sequence: withTracks(sequence, followed),
    inverse: { type: 'clip.remove', clipId: duplicate.id },
  };
}

function applySlip(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.slip' }>,
  context: ApplyContext,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertClipCompatible(location.track, location.clip);
  const clip = location.clip;

  if (!isMediaClip(clip)) {
    throw new EngineError(
      'invalid-command',
      `A ${clip.type} clip has no source footage to slip.`,
      'Slip is only available for video and audio clips.',
    );
  }

  const changes: Record<string, unknown> = {};
  if (clip.timeMap.length > 0) {
    const timeMap = clip.timeMap.map((point) => ({
      ...point,
      sourceFrame: point.sourceFrame + command.deltaFrames,
    }));
    if (timeMap.some((point) => point.sourceFrame < 0)) {
      throw new EngineError(
        'invalid-range',
        'The slip would move the time map before frame zero.',
        'Slip by a smaller amount.',
      );
    }
    changes.timeMap = timeMap;
  } else {
    const sourceInFrame = clip.sourceInFrame + command.deltaFrames;
    if (sourceInFrame < 0) {
      throw new EngineError(
        'invalid-range',
        'The slip would start before the first source frame.',
        'Slip by a smaller amount.',
      );
    }
    changes.sourceInFrame = sourceInFrame;
  }

  const updated = parseClip({ ...clip, ...changes });
  assertSourceBounds(updated, context);
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.slip',
      clipId: clip.id,
      deltaFrames: -command.deltaFrames,
    },
  };
}

function applySetSpeed(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.setSpeed' }>,
  context: ApplyContext,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertClipCompatible(location.track, location.clip);
  if (!isMediaClip(location.clip)) {
    throw new EngineError(
      'invalid-command',
      `A ${location.clip.type} clip has no playback speed.`,
      'Speed applies to video and audio clips only.',
    );
  }
  if (
    !Number.isFinite(command.speed) ||
    command.speed <= 0 ||
    command.speed > 16
  ) {
    throw new EngineError(
      'invalid-range',
      'Speed must be greater than zero and at most 16.',
      'Choose a speed inside that range.',
    );
  }

  const updated = parseClip({ ...location.clip, speed: command.speed });
  assertSourceBounds(updated, context);
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === location.clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.setSpeed',
      clipId: location.clip.id,
      speed: location.clip.speed,
    },
  };
}

function applySetTimeMap(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.setTimeMap' }>,
  context: ApplyContext,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertClipCompatible(location.track, location.clip);
  if (!isMediaClip(location.clip)) {
    throw new EngineError(
      'invalid-command',
      `A ${location.clip.type} clip has no source time map.`,
      'Time maps apply to video and audio clips only.',
    );
  }

  const points = parseTimeMap(command.points);
  const updated = parseClip({ ...location.clip, timeMap: points });
  assertSourceBounds(updated, context);
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === location.clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.setTimeMap',
      clipId: location.clip.id,
      points: location.clip.timeMap,
    },
  };
}

function applySetKeyframes(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.setKeyframes' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertClipCompatible(location.track, location.clip);
  const clip = location.clip;

  if (command.property === 'volume') {
    if (clip.type !== 'video' && clip.type !== 'audio') {
      throw new EngineError(
        'invalid-command',
        `A ${clip.type} clip has no volume to animate.`,
        'Volume keyframes apply to video and audio clips.',
      );
    }
  } else if (clip.type === 'audio') {
    throw new EngineError(
      'invalid-command',
      `An audio clip has no ${command.property} property to animate.`,
      'Audio clips support volume keyframes only.',
    );
  }

  const keyframes = parseKeyframes(command.keyframes);
  const updated = parseClip({
    ...clip,
    keyframes: { ...clip.keyframes, [command.property]: keyframes },
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.setKeyframes',
      clipId: clip.id,
      property: command.property,
      keyframes: clip.keyframes[command.property],
    },
  };
}

function applyAddEffect(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.addEffect' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'visual effects');
  const clip = location.clip;
  const effect = parseEffect(command.effect);
  if (clip.effects.some((candidate) => candidate.id === effect.id)) {
    throw new EngineError(
      'invalid-command',
      `Effect ${effect.id} is already on this clip.`,
      'Give the effect a fresh identifier.',
    );
  }

  const index = command.index ?? clip.effects.length;
  assertChildIndex(index, clip.effects.length, 'effect');
  const updated = parseClip({
    ...clip,
    effects: [
      ...clip.effects.slice(0, index),
      effect,
      ...clip.effects.slice(index),
    ],
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.removeEffect',
      clipId: clip.id,
      effectId: effect.id,
    },
  };
}

function applyUpdateEffect(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.updateEffect' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'visual effects');
  const clip = location.clip;
  const index = clip.effects.findIndex(
    (candidate) => candidate.id === command.effectId,
  );
  const effect = index >= 0 ? clip.effects[index] : undefined;
  if (!effect) {
    throw new EngineError(
      'not-found',
      `Effect ${command.effectId} is not on this clip.`,
      'Refresh the clip and try again.',
    );
  }

  const patch = compactEffectPatch(command.patch);
  assertEffectPatchKeys(patch);
  const updatedEffect = parseEffect({ ...effect, ...patch });
  const updated = parseClip({
    ...clip,
    effects: clip.effects.map((candidate) =>
      candidate.id === effect.id ? updatedEffect : candidate,
    ),
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.updateEffect',
      clipId: clip.id,
      effectId: effect.id,
      patch: capturePreviousEffectPatch(effect, patch),
    },
  };
}

function applyRemoveEffect(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.removeEffect' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'visual effects');
  const clip = location.clip;
  const index = clip.effects.findIndex(
    (candidate) => candidate.id === command.effectId,
  );
  const effect = index >= 0 ? clip.effects[index] : undefined;
  if (!effect) {
    throw new EngineError(
      'not-found',
      `Effect ${command.effectId} is not on this clip.`,
      'Refresh the clip and try again.',
    );
  }

  const updated = parseClip({
    ...clip,
    effects: clip.effects.filter((candidate) => candidate.id !== effect.id),
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.addEffect',
      clipId: clip.id,
      effect,
      index,
    },
  };
}

function applyAddMask(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.addMask' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'masks');
  const clip = location.clip;
  const mask = parseMask(command.mask);
  if (clip.masks.some((candidate) => candidate.id === mask.id)) {
    throw new EngineError(
      'invalid-command',
      `Mask ${mask.id} is already on this clip.`,
      'Give the mask a fresh identifier.',
    );
  }

  const index = command.index ?? clip.masks.length;
  assertChildIndex(index, clip.masks.length, 'mask');
  const updated = parseClip({
    ...clip,
    masks: [...clip.masks.slice(0, index), mask, ...clip.masks.slice(index)],
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: { type: 'clip.removeMask', clipId: clip.id, maskId: mask.id },
  };
}

function applyUpdateMask(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.updateMask' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'masks');
  const clip = location.clip;
  const index = clip.masks.findIndex(
    (candidate) => candidate.id === command.maskId,
  );
  const mask = index >= 0 ? clip.masks[index] : undefined;
  if (!mask) {
    throw new EngineError(
      'not-found',
      `Mask ${command.maskId} is not on this clip.`,
      'Refresh the clip and try again.',
    );
  }

  const patch = compactMaskPatch(command.patch);
  assertMaskPatchKeys(patch);
  const updatedMask = parseMask({ ...mask, ...patch });
  const updated = parseClip({
    ...clip,
    masks: clip.masks.map((candidate) =>
      candidate.id === mask.id ? updatedMask : candidate,
    ),
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.updateMask',
      clipId: clip.id,
      maskId: mask.id,
      patch: capturePreviousMaskPatch(mask, patch),
    },
  };
}

function applyRemoveMask(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'clip.removeMask' }>,
): ApplyResult {
  const location = requireClip(sequence, command.clipId);
  assertTrackUnlocked(location.track);
  assertVisualClip(location.clip, 'masks');
  const clip = location.clip;
  const index = clip.masks.findIndex(
    (candidate) => candidate.id === command.maskId,
  );
  const mask = index >= 0 ? clip.masks[index] : undefined;
  if (!mask) {
    throw new EngineError(
      'not-found',
      `Mask ${command.maskId} is not on this clip.`,
      'Refresh the clip and try again.',
    );
  }

  const updated = parseClip({
    ...clip,
    masks: clip.masks.filter((candidate) => candidate.id !== mask.id),
  });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.map((candidateClip) =>
            candidateClip.id === clip.id ? updated : candidateClip,
          ),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.addMask',
      clipId: clip.id,
      mask,
      index,
    },
  };
}

function applySequenceRename(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'sequence.rename' }>,
): ApplyResult {
  if (command.name.trim().length === 0) {
    throw new EngineError(
      'invalid-command',
      'A sequence needs a name.',
      'Enter at least one non-space character.',
    );
  }
  return {
    sequence: { ...sequence, name: command.name },
    inverse: { type: 'sequence.rename', name: sequence.name },
  };
}

function applySequenceSetCanvas(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'sequence.setCanvas' }>,
): ApplyResult {
  const frameRate = command.frameRate ?? sequence.frameRate;
  const retimed = command.timing
    ? restoreSequenceTiming(sequence, command.timing)
    : retimeSequence(sequence, frameRate);
  const next = parseSequence({
    ...retimed,
    width: command.width,
    height: command.height,
    frameRate,
  });
  const timingChanged =
    command.timing !== undefined ||
    fpsToNumber(sequence.frameRate) !== fpsToNumber(frameRate);
  return {
    sequence: next,
    inverse: {
      type: 'sequence.setCanvas',
      width: sequence.width,
      height: sequence.height,
      frameRate: sequence.frameRate,
      timing: timingChanged ? captureSequenceTiming(sequence) : undefined,
    },
  };
}

function applySequenceSetStyle(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'sequence.setStyle' }>,
): ApplyResult {
  const patch = compactStylePatch(command.style);
  const allowed = new Set(Object.keys(sequence.style));
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `The sequence style has no "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }

  const style = parseStyle({ ...sequence.style, ...patch });
  return {
    sequence: { ...sequence, style },
    inverse: {
      type: 'sequence.setStyle',
      style: capturePreviousStylePatch(sequence.style, patch),
    },
  };
}

function applySequenceSetReference(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'sequence.setReference' }>,
): ApplyResult {
  const reference =
    command.reference === null ? null : parseReference(command.reference);
  return {
    sequence: { ...sequence, reference },
    inverse: {
      type: 'sequence.setReference',
      reference: sequence.reference,
    },
  };
}

function applyTrackAdd(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'track.add' }>,
): ApplyResult {
  const track = parseTrack(command.track);
  if (findTrack(sequence, track.id)) {
    throw new EngineError(
      'invalid-command',
      `Track ${track.id} already exists.`,
      'Give the new track a fresh identifier.',
    );
  }
  assertTrackClips(track);

  const clipIds = new Set<string>();
  for (const clip of track.clips) {
    if (findClip(sequence, clip.id) || clipIds.has(clip.id)) {
      throw new EngineError(
        'invalid-command',
        `Clip ${clip.id} already exists in this sequence.`,
        'Give every clip a unique identifier.',
      );
    }
    clipIds.add(clip.id);
  }

  const index = command.index ?? sequence.tracks.length;
  assertListIndex(index, sequence.tracks.length, 'track');
  return {
    sequence: withTracks(sequence, [
      ...sequence.tracks.slice(0, index),
      track,
      ...sequence.tracks.slice(index),
    ]),
    inverse: { type: 'track.remove', trackId: track.id },
  };
}

function applyTrackRemove(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'track.remove' }>,
): ApplyResult {
  const track = requireTrack(sequence, command.trackId);
  assertTrackUnlocked(track);
  const index = sequence.tracks.findIndex(
    (candidate) => candidate.id === track.id,
  );

  const sourceIds = new Set(track.clips.map((clip) => clip.id));
  const removed: OverlayLocation[] = [];
  for (const candidate of sequence.tracks) {
    if (candidate.id === track.id) {
      continue;
    }
    candidate.clips.forEach((clip, clipIndex) => {
      if (
        clip.type === 'fxOverlay' &&
        clip.linkedItemId !== null &&
        sourceIds.has(clip.linkedItemId)
      ) {
        removed.push({
          trackId: candidate.id,
          index: clipIndex,
          clip,
        });
      }
    });
  }

  const removedIds = new Set(removed.map((entry) => entry.clip.id));
  const remainingTracks = sequence.tracks
    .filter((candidate) => candidate.id !== track.id)
    .map((candidate) => {
      const clips = candidate.clips.filter((clip) => !removedIds.has(clip.id));
      return clips.length === candidate.clips.length
        ? candidate
        : { ...candidate, clips };
    });
  const trackOrder = new Map(
    sequence.tracks.map((candidate, order) => [candidate.id, order]),
  );
  removed.sort(
    (left, right) =>
      (trackOrder.get(left.trackId) ?? 0) -
        (trackOrder.get(right.trackId) ?? 0) || left.index - right.index,
  );

  if (removed.length === 0) {
    return {
      sequence: withTracks(sequence, remainingTracks),
      inverse: { type: 'track.add', track, index },
    };
  }

  const lockedOverlayTracks = [
    ...new Set(removed.map((entry) => entry.trackId)),
  ].filter(
    (trackId) =>
      sequence.tracks.find((candidate) => candidate.id === trackId)?.locked,
  );
  const inverseCommands: EditCommand[] = [{ type: 'track.add', track, index }];
  for (const trackId of lockedOverlayTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: false },
    });
  }
  for (const entry of removed) {
    inverseCommands.push({
      type: 'clip.insert',
      clip: entry.clip,
      index: entry.index,
    });
  }
  for (const trackId of lockedOverlayTracks) {
    inverseCommands.push({
      type: 'track.update',
      trackId,
      patch: { locked: true },
    });
  }

  return {
    sequence: withTracks(sequence, remainingTracks),
    inverse: {
      type: 'batch',
      label: 'Undo remove track',
      commands: inverseCommands,
    },
  };
}

function applyTrackUpdate(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'track.update' }>,
): ApplyResult {
  const track = requireTrack(sequence, command.trackId);
  const patch = compactTrackPatch(command.patch);
  const allowed = new Set([
    'name',
    'kind',
    'order',
    'locked',
    'muted',
    'hidden',
    'height',
  ]);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `A track has no editable "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }

  const onlyOrder = Object.keys(patch).every((key) => key === 'order');
  if (track.locked && patch.locked !== false && !onlyOrder) {
    throw new EngineError(
      'locked',
      `Track "${track.name}" is locked.`,
      'Unlock the track before editing it.',
    );
  }

  if (patch.kind && patch.kind !== track.kind) {
    const candidate = { ...track, kind: patch.kind };
    for (const clip of track.clips) {
      assertClipCompatible(candidate, clip);
    }
  }

  const updated = parseTrack({ ...track, ...patch });
  return {
    sequence: withTracks(
      sequence,
      sequence.tracks.map((candidate) =>
        candidate.id === track.id ? updated : candidate,
      ),
    ),
    inverse: {
      type: 'track.update',
      trackId: track.id,
      patch: capturePreviousTrackPatch(track, patch),
    },
  };
}

function applyTrackReorder(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'track.reorder' }>,
): ApplyResult {
  const ordered = tracksInOrder(sequence);
  if (command.toIndex < 0 || command.toIndex >= ordered.length) {
    throw new EngineError(
      'invalid-range',
      `Cannot move a track to index ${command.toIndex}.`,
      `Use an index between 0 and ${ordered.length - 1}.`,
    );
  }

  const currentIndex = ordered.findIndex(
    (track) => track.id === command.trackId,
  );
  if (currentIndex < 0) {
    throw new EngineError(
      'not-found',
      `Track ${command.trackId} is not part of this sequence.`,
      'Refresh the sequence and try again.',
    );
  }

  const moved = [...ordered];
  const [track] = moved.splice(currentIndex, 1);
  if (!track) {
    throw new EngineError(
      'internal',
      'The track could not be reordered.',
      'Reload the project and try again.',
    );
  }
  moved.splice(command.toIndex, 0, track);

  const orderById = new Map(moved.map((item, index) => [item.id, index]));
  const inverses: EditCommand[] = [];
  for (const candidate of ordered) {
    const order = orderById.get(candidate.id);
    if (order !== undefined && order !== candidate.order) {
      inverses.push({
        type: 'track.update',
        trackId: candidate.id,
        patch: { order: candidate.order },
      });
    }
  }

  const tracks = sequence.tracks.map((candidate) => {
    const order = orderById.get(candidate.id);
    return order === undefined ? candidate : { ...candidate, order };
  });

  return {
    sequence: withTracks(sequence, tracks),
    inverse:
      inverses.length === 0
        ? null
        : { type: 'batch', label: 'Undo reorder', commands: inverses },
  };
}

function applyMarkerAdd(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'marker.add' }>,
): ApplyResult {
  const marker = parseMarker(command.marker);
  if (sequence.markers.some((candidate) => candidate.id === marker.id)) {
    throw new EngineError(
      'invalid-command',
      `Marker ${marker.id} already exists.`,
      'Give the new marker a fresh identifier.',
    );
  }

  const index = command.index ?? sequence.markers.length;
  assertListIndex(index, sequence.markers.length, 'marker');
  return {
    sequence: {
      ...sequence,
      markers: [
        ...sequence.markers.slice(0, index),
        marker,
        ...sequence.markers.slice(index),
      ],
    },
    inverse: { type: 'marker.remove', markerId: marker.id },
  };
}

function applyMarkerUpdate(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'marker.update' }>,
): ApplyResult {
  const index = sequence.markers.findIndex(
    (marker) => marker.id === command.markerId,
  );
  const marker = index >= 0 ? sequence.markers[index] : undefined;
  if (!marker) {
    throw new EngineError(
      'not-found',
      `Marker ${command.markerId} is not part of this sequence.`,
      'Refresh the sequence and try again.',
    );
  }

  const patch = compactMarkerPatch(command.patch);
  const allowed = new Set(['frame', 'label', 'kind', 'color']);
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined && !allowed.has(key)) {
      throw new EngineError(
        'invalid-command',
        `A marker has no editable "${key}" property.`,
        'Remove that field from the patch.',
      );
    }
  }

  const updated = parseMarker({ ...marker, ...patch });
  return {
    sequence: {
      ...sequence,
      markers: sequence.markers.map((candidate) =>
        candidate.id === marker.id ? updated : candidate,
      ),
    },
    inverse: {
      type: 'marker.update',
      markerId: marker.id,
      patch: capturePreviousMarkerPatch(marker, patch),
    },
  };
}

function applyMarkerRemove(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'marker.remove' }>,
): ApplyResult {
  const index = sequence.markers.findIndex(
    (marker) => marker.id === command.markerId,
  );
  const marker = index >= 0 ? sequence.markers[index] : undefined;
  if (!marker) {
    throw new EngineError(
      'not-found',
      `Marker ${command.markerId} is not part of this sequence.`,
      'Refresh the sequence and try again.',
    );
  }

  return {
    sequence: {
      ...sequence,
      markers: sequence.markers.filter(
        (candidate) => candidate.id !== marker.id,
      ),
    },
    inverse: { type: 'marker.add', marker, index },
  };
}

function applyBatch(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'batch' }>,
  context: ApplyContext,
): ApplyResult {
  let next = sequence;
  const inverses: EditCommand[] = [];

  for (const child of command.commands) {
    const result = applyCommand(next, child, context);
    next = result.sequence;
    if (result.inverse) {
      inverses.push(result.inverse);
    }
  }

  return {
    sequence: next,
    inverse:
      inverses.length === 0
        ? null
        : {
            type: 'batch',
            label: command.label ? `Undo ${command.label}` : undefined,
            commands: [...inverses].reverse(),
          },
  };
}

/**
 * Applies one edit and returns both the next sequence and the command that
 * exactly restores the previous one. Inputs are never mutated.
 */
export function applyCommand(
  sequence: Sequence,
  command: EditCommand,
  context: ApplyContext = {},
): ApplyResult {
  switch (command.type) {
    case 'clip.insert':
      return applyInsert(sequence, command);
    case 'clip.remove':
      return applyRemove(sequence, command);
    case 'clip.update':
      return applyUpdate(sequence, command);
    case 'clip.move':
      return applyMove(sequence, command);
    case 'clip.trim':
      return applyTrim(sequence, command, context);
    case 'clip.split':
      return applySplit(sequence, command);
    case 'clip.duplicate':
      return applyDuplicate(sequence, command);
    case 'clip.slip':
      return applySlip(sequence, command, context);
    case 'clip.setSpeed':
      return applySetSpeed(sequence, command, context);
    case 'clip.setTimeMap':
      return applySetTimeMap(sequence, command, context);
    case 'clip.setKeyframes':
      return applySetKeyframes(sequence, command);
    case 'clip.addEffect':
      return applyAddEffect(sequence, command);
    case 'clip.updateEffect':
      return applyUpdateEffect(sequence, command);
    case 'clip.removeEffect':
      return applyRemoveEffect(sequence, command);
    case 'clip.addMask':
      return applyAddMask(sequence, command);
    case 'clip.updateMask':
      return applyUpdateMask(sequence, command);
    case 'clip.removeMask':
      return applyRemoveMask(sequence, command);
    case 'sequence.rename':
      return applySequenceRename(sequence, command);
    case 'sequence.setCanvas':
      return applySequenceSetCanvas(sequence, command);
    case 'sequence.setStyle':
      return applySequenceSetStyle(sequence, command);
    case 'sequence.setReference':
      return applySequenceSetReference(sequence, command);
    case 'track.add':
      return applyTrackAdd(sequence, command);
    case 'track.remove':
      return applyTrackRemove(sequence, command);
    case 'track.update':
      return applyTrackUpdate(sequence, command);
    case 'track.reorder':
      return applyTrackReorder(sequence, command);
    case 'marker.add':
      return applyMarkerAdd(sequence, command);
    case 'marker.update':
      return applyMarkerUpdate(sequence, command);
    case 'marker.remove':
      return applyMarkerRemove(sequence, command);
    case 'batch':
      return applyBatch(sequence, command, context);
    default:
      throw new EngineError(
        'invalid-command',
        'The engine received an unknown edit command.',
        'Update the app or remove this command from the batch.',
      );
  }
}
