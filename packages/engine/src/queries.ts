import type { Clip, Sequence, Track } from '@kerf/model';
import { clipEndFrame } from '@kerf/model';
import { EngineError } from './errors';

export interface ClipLocation {
  track: Track;
  clip: Clip;
  index: number;
}

export function clipStart(clip: Clip): number {
  return clip.startFrame;
}

export function clipEnd(clip: Clip): number {
  return clipEndFrame(clip);
}

/** Tracks ordered from the top of the timeline downward. */
export function tracksInOrder(sequence: Sequence): Track[] {
  return [...sequence.tracks].sort(
    (left, right) =>
      left.order - right.order || left.id.localeCompare(right.id),
  );
}

export function visualTracksInOrder(sequence: Sequence): Track[] {
  return tracksInOrder(sequence).filter(
    (track) => track.kind === 'video' || track.kind === 'overlay',
  );
}

export function audioTracksInOrder(sequence: Sequence): Track[] {
  return tracksInOrder(sequence).filter((track) => track.kind === 'audio');
}

export function findTrack(
  sequence: Sequence,
  trackId: string,
): Track | undefined {
  return sequence.tracks.find((track) => track.id === trackId);
}

export function requireTrack(sequence: Sequence, trackId: string): Track {
  const track = findTrack(sequence, trackId);
  if (!track) {
    throw new EngineError(
      'not-found',
      `Track ${trackId} is not part of this sequence.`,
      'Refresh the sequence and try again.',
    );
  }
  return track;
}

export function findClip(
  sequence: Sequence,
  clipId: string,
): ClipLocation | undefined {
  for (const track of sequence.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    const clip = index >= 0 ? track.clips[index] : undefined;
    if (clip) {
      return { track, clip, index };
    }
  }
  return undefined;
}

export function requireClip(sequence: Sequence, clipId: string): ClipLocation {
  const location = findClip(sequence, clipId);
  if (!location) {
    throw new EngineError(
      'not-found',
      `Clip ${clipId} is not part of this sequence.`,
      'The clip may have been removed by another edit.',
    );
  }
  return location;
}

export function clipsOnTrack(track: Track): Clip[] {
  return [...track.clips].sort(
    (left, right) =>
      left.startFrame - right.startFrame ||
      left.durationFrames - right.durationFrames ||
      left.id.localeCompare(right.id),
  );
}

export function clipAtFrame(track: Track, frame: number): Clip | undefined {
  return clipsOnTrack(track).find(
    (clip) => clip.startFrame <= frame && frame < clipEnd(clip),
  );
}

/**
 * Every clip active at a frame, ordered by start frame and then by insertion
 * order. Effects tracks can stack overlapping overlays, so they need all hits.
 */
export function clipsAtFrame(track: Track, frame: number): Clip[] {
  return track.clips
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => clip.startFrame <= frame && frame < clipEnd(clip))
    .sort(
      (left, right) =>
        left.clip.startFrame - right.clip.startFrame ||
        left.index - right.index,
    )
    .map(({ clip }) => clip);
}

export function clipsInRange(
  track: Track,
  startFrame: number,
  endFrame: number,
): Clip[] {
  if (endFrame <= startFrame) {
    return [];
  }
  return clipsOnTrack(track).filter(
    (clip) => clip.startFrame < endFrame && clipEnd(clip) > startFrame,
  );
}

export function findOverlap(
  track: Track,
  startFrame: number,
  durationFrames: number,
  ignoreClipId?: string,
): Clip | undefined {
  const endFrame = startFrame + durationFrames;
  return track.clips.find(
    (clip) =>
      clip.id !== ignoreClipId &&
      clip.startFrame < endFrame &&
      clipEnd(clip) > startFrame,
  );
}

export function hasOverlap(
  track: Track,
  startFrame: number,
  durationFrames: number,
  ignoreClipId?: string,
): boolean {
  return (
    findOverlap(track, startFrame, durationFrames, ignoreClipId) !== undefined
  );
}

/** The sequence ends at the last non-overlay clip edge, or an explicit duration. */
export function sequenceDurationFrames(sequence: Sequence): number {
  return durationFromClips(sequence, false);
}

/**
 * The timeline extent including timed overlays. Overlays can extend past the
 * footage, so the ruler and scroll area use this instead of the export length.
 */
export function timelineDurationFrames(sequence: Sequence): number {
  return durationFromClips(sequence, true);
}

function durationFromClips(
  sequence: Sequence,
  includeOverlays: boolean,
): number {
  const lastClip = sequence.tracks.reduce((latest, track) => {
    const trackEnd = track.clips.reduce((end, clip) => {
      if (!includeOverlays && clip.type === 'fxOverlay') {
        return end;
      }
      return Math.max(end, clipEnd(clip));
    }, 0);
    return Math.max(latest, trackEnd);
  }, 0);

  return Math.max(sequence.durationFrames, lastClip);
}

export function nextTrackOrder(sequence: Sequence): number {
  return sequence.tracks.reduce(
    (next, track) => Math.max(next, track.order + 1),
    0,
  );
}

export function clipsForAsset(sequence: Sequence, assetId: string): Clip[] {
  return sequence.tracks.flatMap((track) =>
    track.clips.filter(
      (clip) =>
        (clip.type === 'video' ||
          clip.type === 'audio' ||
          clip.type === 'image') &&
        clip.assetId === assetId,
    ),
  );
}
