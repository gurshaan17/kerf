import type {
  Clip,
  ClipPatch,
  ClipType,
  EditCommand,
  Sequence,
  TimeMapPoint,
  Track,
} from '@kerf/model';
import { clipSchema, isMediaClip } from '@kerf/model';
import { assertClipCompatible } from './compatibility';
import { EngineError } from './errors';
import { findClip, findOverlap, requireClip, requireTrack } from './queries';
import { clipSourceRange, sampleTimeMap } from './source';

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
