import type { MediaClip, TimeMapPoint } from '@kerf/model';

/**
 * Linear interpolation across a time map. Points are timeline-local frames;
 * source frames may descend for reversed footage.
 */
export function sampleTimeMap(
  points: readonly TimeMapPoint[],
  frame: number,
): number | undefined {
  const list = [...points].sort((left, right) => left.frame - right.frame);
  const first = list[0];
  const last = list.at(-1);
  if (!first || !last) {
    return undefined;
  }
  if (frame <= first.frame) {
    return first.sourceFrame;
  }
  if (frame >= last.frame) {
    return last.sourceFrame;
  }

  for (let index = 1; index < list.length; index += 1) {
    const left = list[index - 1];
    const right = list[index];
    if (!left || !right || frame > right.frame) {
      continue;
    }

    const span = right.frame - left.frame;
    if (span <= 0) {
      return right.sourceFrame;
    }
    const progress = (frame - left.frame) / span;
    return Math.round(
      left.sourceFrame + (right.sourceFrame - left.sourceFrame) * progress,
    );
  }

  return last.sourceFrame;
}

/**
 * Maps an absolute timeline frame to the source frame a media clip should
 * display. Values outside the clip are clamped to its first or last source
 * frame, which keeps scrubbing stable.
 */
export function sourceFrameAt(clip: MediaClip, timelineFrame: number): number {
  const relative = Math.min(
    Math.max(timelineFrame - clip.startFrame, 0),
    clip.durationFrames,
  );
  const mapped = sampleTimeMap(clip.timeMap, relative);
  if (mapped !== undefined) {
    return mapped;
  }

  return clip.sourceInFrame + Math.round(relative * clip.speed);
}

export function sourceEndFrame(clip: MediaClip): number {
  return sourceFrameAt(clip, clip.startFrame + clip.durationFrames);
}

export interface SourceRange {
  startFrame: number;
  endFrame: number;
}

export function clipSourceRange(clip: MediaClip): SourceRange {
  const startFrame = sourceFrameAt(clip, clip.startFrame);
  const endFrame = sourceEndFrame(clip);
  return {
    startFrame: Math.min(startFrame, endFrame),
    endFrame: Math.max(startFrame, endFrame),
  };
}

function timelineOffsetAtSource(
  points: readonly TimeMapPoint[],
  sourceFrame: number,
): number | undefined {
  const list = [...points].sort((left, right) => left.frame - right.frame);
  const first = list[0];
  const last = list.at(-1);
  if (!first || !last) {
    return undefined;
  }
  if (list.length === 1) {
    return sourceFrame === first.sourceFrame ? first.frame : undefined;
  }

  for (let index = 1; index < list.length; index += 1) {
    const left = list[index - 1];
    const right = list[index];
    if (!left || !right) {
      continue;
    }
    const low = Math.min(left.sourceFrame, right.sourceFrame);
    const high = Math.max(left.sourceFrame, right.sourceFrame);
    if (sourceFrame < low || sourceFrame > high) {
      continue;
    }

    const span = right.sourceFrame - left.sourceFrame;
    if (span === 0) {
      return left.frame;
    }
    const progress = (sourceFrame - left.sourceFrame) / span;
    return left.frame + (right.frame - left.frame) * progress;
  }

  return undefined;
}

/**
 * The inverse of `sourceFrameAt` for linear clips, and the best matching
 * segment for time-mapped clips. Returns null when a source frame is not
 * represented by the map.
 */
export function timelineFrameAtSource(
  clip: MediaClip,
  sourceFrame: number,
): number | null {
  if (clip.timeMap.length > 0) {
    const offset = timelineOffsetAtSource(clip.timeMap, sourceFrame);
    return offset === undefined ? null : clip.startFrame + Math.round(offset);
  }

  return (
    clip.startFrame +
    Math.round((sourceFrame - clip.sourceInFrame) / clip.speed)
  );
}
