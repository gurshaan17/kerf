import type {
  Asset,
  Clip,
  EditCommand,
  FrameRate,
  Sequence,
  Track,
} from '@kerf/model';
import { clipEndFrame, clipSchema, newId, secondsToFrames } from '@kerf/model';
import {
  clipsOnTrack,
  findClip,
  isClipCompatible,
  rippleDeleteCommand,
  tracksInOrder,
} from '@kerf/engine';

const FALLBACK_CLIP_SECONDS = 5;

function isMediaAsset(asset: Asset): boolean {
  return asset.kind === 'video' || asset.kind === 'audio';
}

function sourceDurationFrames(asset: Asset, rate: FrameRate): number {
  // Source frames share the sequence frame unit so clip timing stays linear
  // when the asset and sequence frame rates differ.
  return Math.max(1, secondsToFrames(asset.durationSeconds, rate, 'floor'));
}

export function clipDurationFrames(asset: Asset, rate: FrameRate): number {
  if (asset.kind === 'image') {
    return Math.max(
      1,
      Math.round(secondsToFrames(FALLBACK_CLIP_SECONDS, rate)),
    );
  }

  const timelineFrames = Math.max(
    1,
    secondsToFrames(asset.durationSeconds, rate, 'floor'),
  );
  // Keep the initial duration inside the source even when the asset duration
  // was rounded up from a slightly shorter container.
  return Math.min(timelineFrames, sourceDurationFrames(asset, rate));
}

export function createClipForAsset(
  asset: Asset,
  track: Track,
  startFrame: number,
  rate: FrameRate,
): Clip | null {
  const durationFrames = clipDurationFrames(asset, rate);
  const base = {
    id: newId('clip'),
    trackId: track.id,
    startFrame: Math.max(0, Math.round(startFrame)),
    durationFrames,
    label: asset.name,
  };

  if (asset.kind === 'video' && track.kind !== 'audio') {
    return clipSchema.parse({
      ...base,
      type: 'video',
      assetId: asset.id,
    });
  }
  if (asset.kind === 'audio' && track.kind === 'audio') {
    return clipSchema.parse({
      ...base,
      type: 'audio',
      assetId: asset.id,
    });
  }
  if (asset.kind === 'image' && track.kind !== 'audio') {
    return clipSchema.parse({
      ...base,
      type: 'image',
      assetId: asset.id,
    });
  }
  return null;
}

export function insertAssetCommand(
  asset: Asset,
  sequence: Sequence,
  trackId: string,
  startFrame: number,
): Extract<EditCommand, { type: 'clip.insert' }> | null {
  const track = sequence.tracks.find((candidate) => candidate.id === trackId);
  if (!track || track.locked) {
    return null;
  }
  const clip = createClipForAsset(asset, track, startFrame, sequence.frameRate);
  if (!clip) {
    return null;
  }
  return { type: 'clip.insert', clip };
}

export function preferredTrackForAsset(
  asset: Asset,
  sequence: Sequence,
): Track | null {
  const tracks = tracksInOrder(sequence);
  if (asset.kind === 'audio') {
    return (
      tracks.find((track) => track.kind === 'audio' && !track.locked) ?? null
    );
  }
  return (
    tracks.find(
      (track) =>
        (track.kind === 'video' || track.kind === 'overlay') && !track.locked,
    ) ?? null
  );
}

export function splitAtFrameCommand(
  sequence: Sequence,
  frame: number,
  clipIds: readonly string[],
): EditCommand | null {
  const selected = new Set(clipIds);
  const ids =
    selected.size > 0
      ? [...selected]
      : sequence.tracks.flatMap((track) =>
          track.clips
            .filter(
              (clip) => clip.startFrame < frame && frame < clipEndFrame(clip),
            )
            .map((clip) => clip.id),
        );

  const commands = ids
    .filter((id) => {
      const location = findClip(sequence, id);
      return (
        location !== undefined &&
        !location.track.locked &&
        location.clip.startFrame < frame &&
        frame < clipEndFrame(location.clip)
      );
    })
    .map<EditCommand>((clipId) => ({
      type: 'clip.split',
      clipId: clipId as Clip['id'],
      frame,
    }));

  if (commands.length === 0) {
    return null;
  }
  return commands.length === 1
    ? commands[0]!
    : {
        type: 'batch',
        label: 'Split at playhead',
        commands,
      };
}

export function deleteClipsCommand(
  sequence: Sequence,
  clipIds: readonly string[],
  ripple: boolean,
): EditCommand | null {
  const commands: EditCommand[] = [];
  // Ripple from right to left so earlier removals cannot invalidate the
  // starting frames used by later ripple helpers.
  const locations = clipIds
    .map((id) => findClip(sequence, id))
    .filter((location): location is NonNullable<typeof location> =>
      Boolean(location),
    )
    .sort((left, right) => right.clip.startFrame - left.clip.startFrame);

  for (const location of locations) {
    if (location.track.locked) {
      continue;
    }
    if (ripple) {
      commands.push(rippleDeleteCommand(sequence, location.clip.id));
    } else {
      commands.push({ type: 'clip.remove', clipId: location.clip.id });
    }
  }

  if (commands.length === 0) {
    return null;
  }
  return commands.length === 1
    ? commands[0]!
    : {
        type: 'batch',
        label: ripple ? 'Ripple delete' : 'Delete clips',
        commands,
      };
}

export function duplicateClipsCommand(
  sequence: Sequence,
  clipIds: readonly string[],
): EditCommand | null {
  const commands: EditCommand[] = [];
  for (const clipId of clipIds) {
    const location = findClip(sequence, clipId);
    if (!location || location.track.locked) {
      continue;
    }
    const offsetFrames = nextFreeOffset(sequence, location.clip);
    commands.push({
      type: 'clip.duplicate',
      clipId: location.clip.id,
      offsetFrames,
    });
  }

  if (commands.length === 0) {
    return null;
  }
  return commands.length === 1
    ? commands[0]!
    : {
        type: 'batch',
        label: 'Duplicate clips',
        commands,
      };
}

export interface PasteClipsResult {
  readonly command: EditCommand;
  readonly clipIds: Clip['id'][];
}

/**
 * Builds an insert batch that drops copied clips at `frame`, keeping their
 * relative spacing and pushing the whole group later until every copy fits on
 * a compatible unlocked track.
 */
export function pasteClipsCommand(
  sequence: Sequence,
  clips: readonly Clip[],
  frame: number,
): PasteClipsResult | null {
  const targets = clips.flatMap((clip) => {
    const original = sequence.tracks.find((track) => track.id === clip.trackId);
    const track =
      original && !original.locked && isClipCompatible(original.kind, clip.type)
        ? original
        : tracksInOrder(sequence).find(
            (candidate) =>
              !candidate.locked && isClipCompatible(candidate.kind, clip.type),
          );
    return track ? [{ clip, track }] : [];
  });
  if (targets.length === 0) {
    return null;
  }

  const firstStart = Math.min(...targets.map(({ clip }) => clip.startFrame));
  let shift = Math.max(0, Math.round(frame)) - firstStart;

  for (let attempts = 0; attempts < 1000; attempts += 1) {
    const collisions: number[] = [];
    for (const { clip, track } of targets) {
      const start = clip.startFrame + shift;
      const end = start + clip.durationFrames;
      for (const existing of track.clips) {
        if (existing.startFrame < end && clipEndFrame(existing) > start) {
          collisions.push(clipEndFrame(existing) - clip.startFrame);
        }
      }
    }
    if (collisions.length === 0) {
      break;
    }
    shift = Math.max(shift, ...collisions);
  }

  const commands: EditCommand[] = [];
  const clipIds: Clip['id'][] = [];
  for (const { clip, track } of targets) {
    const copy: Clip = clipSchema.parse({
      ...clip,
      id: newId('clip'),
      trackId: track.id,
      startFrame: clip.startFrame + shift,
      locked: false,
    });
    commands.push({ type: 'clip.insert', clip: copy });
    clipIds.push(copy.id);
  }

  if (commands.length === 0) {
    return null;
  }

  return {
    command:
      commands.length === 1
        ? commands[0]!
        : { type: 'batch', label: 'Paste clips', commands },
    clipIds,
  };
}

function nextFreeOffset(sequence: Sequence, clip: Clip): number {
  const track = sequence.tracks.find(
    (candidate) => candidate.id === clip.trackId,
  );
  if (!track) {
    return clip.durationFrames;
  }
  const clips = clipsOnTrack(track);
  let offset = clip.durationFrames;
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const candidate = {
      start: clip.startFrame + offset,
      end: clip.startFrame + offset + clip.durationFrames,
    };
    const overlaps = clips.some(
      (other) =>
        other.id !== clip.id &&
        other.startFrame < candidate.end &&
        clipEndFrame(other) > candidate.start,
    );
    if (!overlaps) {
      return offset;
    }
    offset += clip.durationFrames;
  }
  return offset;
}

export function allClipIdsInRange(
  sequence: Sequence,
  startFrame: number,
  endFrame: number,
): string[] {
  return sequence.tracks.flatMap((track) =>
    track.clips
      .filter(
        (clip) => clip.startFrame < endFrame && clipEndFrame(clip) > startFrame,
      )
      .map((clip) => clip.id),
  );
}

export function isMediaClipAsset(
  clip: Clip,
  assets: readonly Asset[],
): boolean {
  return (
    (clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') &&
    assets.some((asset) => asset.id === clip.assetId)
  );
}

export function assetForClip(
  clip: Clip,
  assets: readonly Asset[],
): Asset | undefined {
  if (clip.type === 'video' || clip.type === 'audio' || clip.type === 'image') {
    return assets.find((asset) => asset.id === clip.assetId);
  }
  return undefined;
}

export { isMediaAsset };
