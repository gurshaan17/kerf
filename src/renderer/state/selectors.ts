import type { Clip, Sequence } from '@kerf/model';
import type { StudioState } from './studio';

const EMPTY_CLIPS: readonly Clip[] = Object.freeze([]);

export function selectSequence(state: StudioState): Sequence | null {
  return state.snapshot?.project.sequence ?? null;
}

export function selectSelectedClipIds(state: StudioState): readonly string[] {
  return state.selection.clipIds;
}

let cachedSequence: Sequence | null = null;
let cachedIds: readonly string[] | null = null;
let cachedClips: readonly Clip[] = EMPTY_CLIPS;

/**
 * Resolves selected clips to their live project objects. The one-entry cache
 * matters because clip objects are immutable: unrelated project edits can
 * therefore skip inspector and preview work.
 */
export function selectSelectedClips(state: StudioState): readonly Clip[] {
  const sequence = selectSequence(state);
  const ids = state.selection.clipIds;
  if (sequence === cachedSequence && ids === cachedIds) {
    return cachedClips;
  }

  if (!sequence || ids.length === 0) {
    cachedSequence = sequence;
    cachedIds = ids;
    cachedClips = EMPTY_CLIPS;
    return cachedClips;
  }

  const clipsById = new Map<string, Clip>();
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      clipsById.set(clip.id, clip);
    }
  }
  const clips = ids.flatMap((id) => {
    const clip = clipsById.get(id);
    return clip ? [clip] : [];
  });

  cachedSequence = sequence;
  cachedIds = ids;
  cachedClips = clips;
  return clips;
}

export function selectSelectedClip(state: StudioState): Clip | null {
  return selectSelectedClips(state)[0] ?? null;
}
