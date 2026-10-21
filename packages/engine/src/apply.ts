import type {
  Clip,
  ClipPatch,
  ClipType,
  EditCommand,
  Sequence,
  Track,
} from '@kerf/model';
import { clipSchema } from '@kerf/model';
import { assertClipCompatible } from './compatibility';
import { EngineError } from './errors';
import { findClip, findOverlap, requireClip, requireTrack } from './queries';

export interface ApplyResult {
  sequence: Sequence;
  inverse: EditCommand | null;
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

function applyBatch(
  sequence: Sequence,
  command: Extract<EditCommand, { type: 'batch' }>,
): ApplyResult {
  let next = sequence;
  const inverses: EditCommand[] = [];

  for (const child of command.commands) {
    const result = applyCommand(next, child);
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
): ApplyResult {
  switch (command.type) {
    case 'clip.insert':
      return applyInsert(sequence, command);
    case 'clip.remove':
      return applyRemove(sequence, command);
    case 'clip.update':
      return applyUpdate(sequence, command);
    case 'batch':
      return applyBatch(sequence, command);
    default:
      throw new EngineError(
        'invalid-command',
        `The engine does not implement ${command.type} yet.`,
        'Update the app or remove this command from the batch.',
      );
  }
}
