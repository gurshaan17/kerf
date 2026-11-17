import { expect, it } from 'vitest';
import { clipSchema } from './clips';
import { newId } from './ids';
import { audioGainPoints, clipAudioGain } from './audio';

it('shares absolute automated gain, boosts and fades with a bounded export approximation', () => {
  const clip = clipSchema.parse({
    id: newId('clip'),
    trackId: newId('track'),
    assetId: newId('asset'),
    type: 'audio',
    startFrame: 0,
    durationFrames: 120,
    volume: 0.4,
    fade: { inFrames: 12, outFrames: 12 },
    keyframes: {
      volume: [
        { frame: 0, value: 2, easing: 'linear' },
        { frame: 120, value: 1, easing: 'linear' },
      ],
    },
  });
  if (clip.type !== 'audio') throw new Error('Expected audio');
  expect(clipAudioGain(clip, 0)).toBe(0);
  expect(clipAudioGain(clip, 60)).toBe(1.5);
  expect(clipAudioGain(clip, 120)).toBe(0);
  const points = audioGainPoints(clip);
  for (let frame = 0.125; frame < 120; frame += 0.25) {
    const index = points.findIndex((p) => p.frame > frame);
    const a = points[index - 1]!;
    const b = points[index]!;
    const exported =
      a.value + ((b.value - a.value) * (frame - a.frame)) / (b.frame - a.frame);
    expect(Math.abs(exported - clipAudioGain(clip, frame))).toBeLessThan(
      0.00011,
    );
  }
});
