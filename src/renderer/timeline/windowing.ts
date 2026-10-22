export interface FrameWindow {
  readonly startFrame: number;
  readonly endFrame: number;
}

/**
 * Returns the frame range plus a small overscan on each side of the visible
 * timeline. Clip bars outside this range are not mounted, which keeps a
 * 500-clip sequence responsive while scrolling.
 */
export function visibleFrameWindow(
  scrollLeft: number,
  viewportWidth: number,
  pixelsPerFrame: number,
  overscanPixels = 640,
): FrameWindow {
  const scale = Math.max(0.0001, pixelsPerFrame);
  const startFrame = Math.max(
    0,
    Math.floor((scrollLeft - overscanPixels) / scale),
  );
  const endFrame = Math.max(
    startFrame + 1,
    Math.ceil(
      (scrollLeft + Math.max(1, viewportWidth) + overscanPixels) / scale,
    ),
  );
  return { startFrame, endFrame };
}

export function clipsInWindow<
  T extends { readonly startFrame: number; readonly durationFrames: number },
>(clips: readonly T[], window: FrameWindow): T[] {
  return clips.filter(
    (clip) =>
      clip.startFrame < window.endFrame &&
      clip.startFrame + clip.durationFrames > window.startFrame,
  );
}
