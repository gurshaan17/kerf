/** A half-open frame range: the start is included, the end is excluded. */
export interface FrameRange {
  readonly startFrame: number;
  readonly endFrame: number;
}

export function normalizeFrameRange(
  startFrame: number,
  endFrame: number,
): FrameRange {
  return startFrame <= endFrame
    ? { startFrame, endFrame }
    : { startFrame: endFrame, endFrame: startFrame };
}

export function frameRangeLength(range: FrameRange): number {
  return range.endFrame - range.startFrame;
}

export function frameRangeContains(range: FrameRange, frame: number): boolean {
  return range.startFrame <= frame && frame < range.endFrame;
}

export function frameRangesOverlap(
  left: FrameRange,
  right: FrameRange,
): boolean {
  return (
    Math.max(left.startFrame, right.startFrame) <
    Math.min(left.endFrame, right.endFrame)
  );
}

/** The shared portion of two ranges, or null when they only touch. */
export function intersectFrameRanges(
  left: FrameRange,
  right: FrameRange,
): FrameRange | null {
  const startFrame = Math.max(left.startFrame, right.startFrame);
  const endFrame = Math.min(left.endFrame, right.endFrame);
  return startFrame < endFrame ? { startFrame, endFrame } : null;
}

/** The shared portion of every range, or null when any range is disjoint. */
export function intersectAllFrameRanges(
  ranges: readonly FrameRange[],
): FrameRange | null {
  const first = ranges[0];
  if (!first) {
    return null;
  }

  let result = first;
  for (let index = 1; index < ranges.length; index += 1) {
    const range = ranges[index];
    if (!range) {
      continue;
    }
    const next = intersectFrameRanges(result, range);
    if (!next) {
      return null;
    }
    result = next;
  }
  return result;
}
