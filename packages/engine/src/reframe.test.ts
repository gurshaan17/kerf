import { expect, it } from 'vitest';
import { buildReframedSequence, reframeTransform } from './reframe';
import { trackReframe } from './reframe-tracking';
import {
  makeAudioClip,
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

it('covers the output without empty edges, including portrait media', () => {
  const vertical = { width: 1080, height: 1920 };
  expect(
    reframeTransform({ width: 1920, height: 1080 }, vertical, { x: 0, y: 0 }),
  ).toMatchObject({ y: 0, x: (1920 * (1920 / 1080) - 1080) / 2 });
  expect(
    reframeTransform({ width: 1080, height: 1920 }, vertical, { x: 0, y: 1 }),
  ).toEqual({ scale: 1, x: 0, y: 0 });
  expect(
    reframeTransform(
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 },
      { x: 1, y: 1 },
    ),
  ).toEqual({ scale: 1920 / 1080, x: 0, y: -420 });
});

it('starts the selected range at zero and retains matching audio source offsets', () => {
  const v = makeTrack('video', 0);
  const a = makeTrack('audio', 1);
  const video = {
    ...makeVideoClip({
      trackId: v.id,
      startFrame: 20,
      sourceInFrame: 10,
      durationFrames: 60,
    }),
    volume: 0,
  };
  const audio = makeAudioClip({
    trackId: a.id,
    assetId: video.assetId,
    startFrame: 20,
    sourceInFrame: 10,
    durationFrames: 60,
  });
  const parent = makeSequence([withClips(v, [video]), withClips(a, [audio])]);
  const child = buildReframedSequence(
    parent,
    video.id,
    { width: 1920, height: 1080 },
    'square',
    [
      { frame: 0, x: 0.15, y: 0.5 },
      { frame: 48, x: 0.85, y: 0.5 },
    ],
  );
  expect(child).toMatchObject({
    width: 1080,
    height: 1080,
    durationFrames: 60,
  });
  expect(child.tracks[0]?.clips[0]).toMatchObject({
    startFrame: 0,
    sourceInFrame: 10,
    volume: 0,
    keyframes: {
      x: [
        { frame: 0, value: 420 },
        { frame: 48, value: -420 },
      ],
    },
  });
  expect(child.tracks[1]?.clips[0]).toMatchObject({
    startFrame: 0,
    sourceInFrame: 10,
    durationFrames: 60,
    volume: 1,
  });
  expect(parent.tracks[0]?.clips[0]?.startFrame).toBe(20);
});

it('follows a textured subject, holds through occlusion, and accepts a new-shot anchor', () => {
  const width = 80;
  const height = 60;
  const image = (x?: number, background = 20) => {
    const values = new Uint8Array(width * height).fill(background);
    if (x !== undefined)
      for (let y = -10; y <= 10; y++)
        for (let dx = -10; dx <= 10; dx++)
          values[(30 + y) * width + x + dx] =
            60 + Math.abs((dx * 93 + y * 47 + dx * y * 11) % 185);
    return values;
  };
  const anchors = [
    { frame: 0, x: 24 / 79, y: 30 / 59 },
    { frame: 24, x: 48 / 79, y: 30 / 59 },
  ];
  const points = [
    ...trackReframe(
      [
        { frame: 0, pixels: image(24) },
        { frame: 6, pixels: image(32) },
        { frame: 12, pixels: image() },
        { frame: 18, pixels: image(48), cut: true },
        { frame: 24, pixels: image(48) },
        { frame: 30, pixels: image(56) },
      ],
      anchors,
      width,
      height,
    ),
  ];
  expect(points.map((point) => point.status)).toEqual([
    'manual',
    'tracked',
    'uncertain',
    'scene-change',
    'manual',
    'tracked',
  ]);
  expect(points[1]!.x).toBeGreaterThan(points[0]!.x);
  expect(points[2]!.x).toBe(points[1]!.x);
  expect(points[2]!.hold).toBe(true);
  expect(points[3]!.x).toBe(points[1]!.x);
  expect(points[5]!.x).toBeGreaterThan(points[4]!.x);
});
