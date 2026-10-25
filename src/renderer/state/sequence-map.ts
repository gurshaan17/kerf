import type { Sequence } from '@kerf/model';

export interface SequenceFrameMatch {
  readonly clipId: string;
  readonly sequenceFrame: number;
}

/**
 * Map a frame of an asset's source media to the sequence frame that shows it.
 * Returns null when the moment was trimmed away or the asset is not on the
 * timeline, so callers can stay silent instead of raising a misleading toast.
 */
export function findSequenceFrame(
  sequence: Sequence,
  assetId: string,
  sourceFrame: number,
): SequenceFrameMatch | null {
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'video' && clip.type !== 'audio') {
        continue;
      }
      if (clip.assetId !== assetId) {
        continue;
      }
      const local = Math.round((sourceFrame - clip.sourceInFrame) / clip.speed);
      if (local >= 0 && local < clip.durationFrames) {
        return { clipId: clip.id, sequenceFrame: clip.startFrame + local };
      }
    }
  }
  return null;
}
