import type {
  Clip,
  ClipId,
  FxOverlayClip,
  OverlayProps,
  OverlayPropsPatch,
  Track,
  TrackId,
} from '@kerf/model';
import { applyOverlayPropsPatch, clipSchema, newId } from '@kerf/model';
import { EngineError } from './errors';

export interface OverlayLocation {
  trackId: TrackId;
  index: number;
  clip: FxOverlayClip;
}

function parseOverlay(value: unknown): FxOverlayClip {
  try {
    const clip = clipSchema.parse(value);
    if (clip.type !== 'fxOverlay') {
      throw new Error('expected an effect overlay');
    }
    return clip;
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The effect overlay could not be updated.',
      error instanceof Error ? error.message : undefined,
    );
  }
}

function isLinkedOverlay(
  clip: Clip,
  sourceClipId: ClipId,
): clip is FxOverlayClip {
  return clip.type === 'fxOverlay' && clip.linkedItemId === sourceClipId;
}

export function linkedOverlays(
  tracks: readonly Track[],
  sourceClipId: ClipId,
): OverlayLocation[] {
  const found: OverlayLocation[] = [];
  for (const track of tracks) {
    track.clips.forEach((clip, index) => {
      if (isLinkedOverlay(clip, sourceClipId)) {
        found.push({ trackId: track.id, index, clip });
      }
    });
  }
  return found;
}

/**
 * Shifts linked overlays with their source clip. This is a follower update, so
 * it deliberately does not check track locks or overlap rules.
 */
export function shiftLinkedOverlays(
  tracks: readonly Track[],
  sourceClipId: ClipId,
  delta: number,
): Track[] {
  if (delta === 0) {
    return [...tracks];
  }
  return tracks.map((track) => {
    let changed = false;
    const clips = track.clips.map((clip) => {
      if (!isLinkedOverlay(clip, sourceClipId)) {
        return clip;
      }
      changed = true;
      return parseOverlay({
        ...clip,
        startFrame: clip.startFrame + delta,
      });
    });
    return changed ? { ...track, clips } : track;
  });
}

export interface OverlayRemoval {
  tracks: Track[];
  removed: OverlayLocation[];
}

/** Removes every overlay linked to a source clip and reports where it was. */
export function removeLinkedOverlays(
  tracks: readonly Track[],
  sourceClipId: ClipId,
): OverlayRemoval {
  const removed = linkedOverlays(tracks, sourceClipId);
  if (removed.length === 0) {
    return { tracks: [...tracks], removed };
  }
  const ids = new Set(removed.map((entry) => entry.clip.id));
  return {
    removed,
    tracks: tracks.map((track) => {
      const clips = track.clips.filter((clip) => !ids.has(clip.id));
      return clips.length === track.clips.length ? track : { ...track, clips };
    }),
  };
}

export interface OverlayClones {
  tracks: Track[];
  clones: FxOverlayClip[];
}

/**
 * Clones every overlay linked to a source clip so the copy follows the
 * duplicated clip. Clones keep the source offset and gain fresh identifiers.
 */
export function cloneLinkedOverlays(
  tracks: readonly Track[],
  sourceClipId: ClipId,
  duplicateClipId: ClipId,
  delta: number,
): OverlayClones {
  const clones: FxOverlayClip[] = [];
  const next = tracks.map((track) => {
    const additions = track.clips
      .filter((clip): clip is FxOverlayClip =>
        isLinkedOverlay(clip, sourceClipId),
      )
      .map((clip) =>
        parseOverlay({
          ...clip,
          id: newId('clip'),
          linkedItemId: duplicateClipId,
          startFrame: clip.startFrame + delta,
        }),
      );
    if (additions.length === 0) {
      return track;
    }
    clones.push(...additions);
    return { ...track, clips: [...track.clips, ...additions] };
  });
  return { tracks: next, clones };
}

export interface OverlayRelink {
  tracks: Track[];
  relinked: FxOverlayClip[];
}

/**
 * Moves overlays that begin at or after the split onto the right-hand clip.
 * Overlays that span the split stay with the left-hand clip.
 */
export function relinkAfterSplit(
  tracks: readonly Track[],
  sourceClipId: ClipId,
  rightClipId: ClipId,
  splitFrame: number,
): OverlayRelink {
  const relinked: FxOverlayClip[] = [];
  const next = tracks.map((track) => {
    let changed = false;
    const clips = track.clips.map((clip) => {
      if (
        !isLinkedOverlay(clip, sourceClipId) ||
        clip.startFrame < splitFrame
      ) {
        return clip;
      }
      changed = true;
      const updated = { ...clip, linkedItemId: rightClipId };
      relinked.push(updated);
      return updated;
    });
    return changed ? { ...track, clips } : track;
  });
  return { tracks: next, relinked };
}

/** Keeps transitions short enough to fit inside the overlay duration. */
export function clampOverlayTransitions<T extends OverlayProps>(
  props: T,
  durationFrames: number,
): T {
  const limit = Math.floor(durationFrames / 2);
  let transitionInFrames = Math.min(props.transitionInFrames, limit);
  let transitionOutFrames = Math.min(props.transitionOutFrames, limit);
  if (transitionInFrames + transitionOutFrames > durationFrames) {
    transitionOutFrames = Math.max(0, durationFrames - transitionInFrames);
  }
  if (
    transitionInFrames === props.transitionInFrames &&
    transitionOutFrames === props.transitionOutFrames
  ) {
    return props;
  }
  return {
    ...props,
    transitionInFrames,
    transitionOutFrames,
  };
}

/** Applies a partial overlay patch, reporting schema failures as engine errors. */
export function resolveOverlayPropsPatch(
  current: OverlayProps,
  patch: OverlayPropsPatch,
  durationFrames: number,
): OverlayProps {
  try {
    return clampOverlayTransitions(
      applyOverlayPropsPatch(current, patch),
      durationFrames,
    );
  } catch (error) {
    throw new EngineError(
      'invalid-command',
      'The overlay properties patch is not valid.',
      error instanceof Error ? error.message : undefined,
    );
  }
}
