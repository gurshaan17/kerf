import type { AutoCutRange } from '@kerf/model';

/** Source-frame destination for uninterrupted playback of the reviewed edit. */
export function autoCutPreviewDestination(
  frame: number,
  kept: readonly AutoCutRange[],
): number | null {
  const next = kept.find((range) => frame < range.endFrame);
  return next ? Math.max(frame, next.startFrame) : null;
}
