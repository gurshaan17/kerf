import { describe, expect, it } from 'vitest';
import { clipsInWindow, visibleFrameWindow } from './windowing';

describe('timeline windowing', () => {
  it('keeps a frame of overscan on each side of the viewport', () => {
    expect(visibleFrameWindow(1000, 800, 1, 200)).toEqual({
      startFrame: 800,
      endFrame: 2000,
    });
  });

  it('never returns a negative start or zero-width window', () => {
    const empty = visibleFrameWindow(0, 0, 0, 100);
    expect(empty.startFrame).toBe(0);
    expect(empty.endFrame).toBeGreaterThan(0);
    expect(visibleFrameWindow(0, 800, 1, 640)).toEqual({
      startFrame: 0,
      endFrame: 1440,
    });
  });

  it('mounts only the clips that intersect the visible range', () => {
    const clips = Array.from({ length: 500 }, (_, index) => ({
      id: `clip_${index}`,
      startFrame: index * 60,
      durationFrames: 50,
    }));

    const window = visibleFrameWindow(30000, 1920, 1.35);
    const mounted = clipsInWindow(clips, window);

    expect(clips).toHaveLength(500);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(50);
    expect(
      mounted.every(
        (clip) =>
          clip.startFrame < window.endFrame &&
          clip.startFrame + clip.durationFrames > window.startFrame,
      ),
    ).toBe(true);
  });
});
