import { describe, expect, it } from 'vitest';
import {
  clipSourceRange,
  sampleTimeMap,
  sourceEndFrame,
  sourceFrameAt,
  timelineFrameAtSource,
} from './source';
import { makeVideoClip } from './test-fixtures';

describe('source frame mapping', () => {
  it('maps linear clips with speed and clamps outside the clip', () => {
    const clip = makeVideoClip({
      startFrame: 100,
      durationFrames: 48,
      sourceInFrame: 200,
      speed: 2,
    });

    expect(sourceFrameAt(clip, 0)).toBe(200);
    expect(sourceFrameAt(clip, 100)).toBe(200);
    expect(sourceFrameAt(clip, 112)).toBe(224);
    expect(sourceFrameAt(clip, 124)).toBe(248);
    expect(sourceFrameAt(clip, 148)).toBe(296);
    expect(sourceFrameAt(clip, 1000)).toBe(296);
    expect(sourceEndFrame(clip)).toBe(296);
    expect(clipSourceRange(clip)).toEqual({
      startFrame: 200,
      endFrame: 296,
    });
  });

  it('inverts a linear source mapping', () => {
    const clip = makeVideoClip({
      startFrame: 100,
      durationFrames: 48,
      sourceInFrame: 200,
      speed: 2,
    });

    expect(timelineFrameAtSource(clip, 200)).toBe(100);
    expect(timelineFrameAtSource(clip, 224)).toBe(112);
    expect(timelineFrameAtSource(clip, 296)).toBe(148);

    const slow = makeVideoClip({
      startFrame: 10,
      durationFrames: 20,
      sourceInFrame: 40,
      speed: 0.5,
    });
    expect(sourceFrameAt(slow, 20)).toBe(45);
    expect(timelineFrameAtSource(slow, 45)).toBe(20);
  });

  it('samples time maps with clamping and interpolation', () => {
    const points = [
      { frame: 0, sourceFrame: 100 },
      { frame: 20, sourceFrame: 0 },
    ];

    expect(sampleTimeMap([], 4)).toBeUndefined();
    expect(sampleTimeMap(points, -5)).toBe(100);
    expect(sampleTimeMap(points, 0)).toBe(100);
    expect(sampleTimeMap(points, 10)).toBe(50);
    expect(sampleTimeMap(points, 20)).toBe(0);
    expect(sampleTimeMap(points, 40)).toBe(0);
  });

  it('maps reversed time-mapped clips in both directions', () => {
    const clip = makeVideoClip({
      startFrame: 10,
      durationFrames: 20,
      sourceInFrame: 0,
      timeMap: [
        { frame: 0, sourceFrame: 100 },
        { frame: 20, sourceFrame: 0 },
      ],
    });

    expect(sourceFrameAt(clip, 10)).toBe(100);
    expect(sourceFrameAt(clip, 20)).toBe(50);
    expect(sourceFrameAt(clip, 30)).toBe(0);
    expect(sourceFrameAt(clip, 0)).toBe(100);
    expect(sourceFrameAt(clip, 40)).toBe(0);
    expect(sourceEndFrame(clip)).toBe(0);
    expect(clipSourceRange(clip)).toEqual({
      startFrame: 0,
      endFrame: 100,
    });

    expect(timelineFrameAtSource(clip, 100)).toBe(10);
    expect(timelineFrameAtSource(clip, 50)).toBe(20);
    expect(timelineFrameAtSource(clip, 0)).toBe(30);
    expect(timelineFrameAtSource(clip, 101)).toBeNull();
    expect(timelineFrameAtSource(clip, -1)).toBeNull();
  });

  it('handles a single time-map point', () => {
    const clip = makeVideoClip({
      startFrame: 0,
      durationFrames: 10,
      timeMap: [{ frame: 0, sourceFrame: 42 }],
    });

    expect(timelineFrameAtSource(clip, 42)).toBe(0);
    expect(timelineFrameAtSource(clip, 41)).toBeNull();
  });
});
