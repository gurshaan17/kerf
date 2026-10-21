import type {
  Clip,
  ClipPatch,
  ClipType,
  EditCommand,
  Effect,
  EffectPatch,
  Mask,
  MaskPatch,
  NumberKeyframes,
  Sequence,
  TimeMapPoint,
  Track,
} from '@kerf/model';
import {
  clipSchema,
  effectSchema,
  isMediaClip,
  maskSchema,
  newId,
  numberKeyframesSchema,
  timeMapSchema,
} from '@kerf/model';
import { assertClipCompatible } from './compatibility';
import { EngineError } from './errors';
import { findClip, findOverlap, requireClip, requireTrack } from './queries';
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

function assertVisualClip(clip: Clip, feature: string): void {
  if (clip.type === 'audio') {
    throw new EngineError(
      'invalid-command',
      `An audio clip does not support ${feature}.`,
      'Add the edit to a video, image, text or shape clip instead.',
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

  const clip = parseClip(command.clip);
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

  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.filter((clip) => clip.id !== location.clip.id),
        }
      : candidate,
  );

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'clip.insert',
      clip: location.clip,
      index: location.index,
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

  const updated = parseClip({ ...location.clip, ...patch });
  const trackChanged = updated.trackId !== location.track.id;

  if (!trackChanged) {
    assertClipCompatible(location.track, updated);
    assertNoOverlap(location.track, updated, updated.id);

    const tracks = sequence.tracks.map((candidate) =>
      candidate.id === location.track.id
        ? {
            ...candidate,
            clips: candidate.clips.map((clip) =>
              clip.id === updated.id ? updated : clip,
            ),
          }
        : candidate,
    );

    return {
      sequence: withTracks(sequence, tracks),
      inverse: {
        type: 'clip.update',
        clipId: updated.id,
        patch: capturePreviousPatch(location.clip, patch),
      },
    };
  }

  const target = requireTrack(sequence, updated.trackId);
  assertTrackUnlocked(target);
  assertClipCompatible(target, updated);
  assertNoOverlap(target, updated, updated.id);

  const insertionIndex = Math.min(location.index, target.clips.length);
  const tracks = sequence.tracks.map((candidate) => {
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
  });

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'batch',
      label: 'Undo clip move',
      commands: [
        { type: 'clip.remove', clipId: updated.id },
        {
          type: 'clip.insert',
          clip: location.clip,
          index: location.index,
        },
      ],
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
  });

  if (!trackChanged && result.inverse?.type === 'clip.update') {
    return {
      sequence: result.sequence,
      inverse: {
        type: 'clip.move',
        clipId: command.clipId,
        trackId: location.track.id,
        startFrame: location.clip.startFrame,
      },
    };
  }

  return result;
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

  const inversePatch: ClipPatch = isMediaClip(clip)
    ? {
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
        sourceInFrame: clip.sourceInFrame,
        timeMap: clip.timeMap,
      }
    : {
        startFrame: clip.startFrame,
        durationFrames: clip.durationFrames,
      };

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

  const left = parseClip({ ...clip, ...leftChanges });
  const right = parseClip({ ...clip, ...rightChanges });
  const tracks = sequence.tracks.map((candidate) =>
    candidate.id === location.track.id
      ? {
          ...candidate,
          clips: candidate.clips.flatMap((candidateClip) =>
            candidateClip.id === clip.id ? [left, right] : [candidateClip],
          ),
        }
      : candidate,
  );

  const inversePatch: ClipPatch = { durationFrames: clip.durationFrames };
  if (isMediaClip(clip)) {
    inversePatch.sourceInFrame = clip.sourceInFrame;
    inversePatch.timeMap = clip.timeMap;
    inversePatch.fade = clip.fade;
  }

  return {
    sequence: withTracks(sequence, tracks),
    inverse: {
      type: 'batch',
      label: 'Undo split',
      commands: [
        { type: 'clip.remove', clipId: right.id },
        {
          type: 'clip.update',
          clipId: left.id,
          patch: inversePatch,
        },
      ],
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

  return {
    sequence: withTracks(sequence, tracks),
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
    case 'batch':
      return applyBatch(sequence, command, context);
    default:
      throw new EngineError(
        'invalid-command',
        `The engine does not implement ${command.type} yet.`,
        'Update the app or remove this command from the batch.',
      );
  }
}
