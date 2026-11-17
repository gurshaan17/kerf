import type { AudioClip, VideoClip } from './clips';
import type { NumberKeyframe } from './keyframes';
import { sampleNumberKeyframes } from './keyframes';

export type AudibleClip = AudioClip | VideoClip;
/** Volume automation is absolute linear gain in clip-local frames, followed by fades. */
export function clipAudioGain(clip: AudibleClip, localFrame: number): number {
  const volume = Math.max(
    0,
    Math.min(
      4,
      sampleNumberKeyframes(clip.keyframes.volume, localFrame) ?? clip.volume,
    ),
  );
  const fadeIn = clip.fade.inFrames
    ? Math.max(0, Math.min(1, localFrame / clip.fade.inFrames))
    : 1;
  const fadeOut = clip.fade.outFrames
    ? Math.max(
        0,
        Math.min(1, (clip.durationFrames - localFrame) / clip.fade.outFrames),
      )
    : 1;
  return volume * fadeIn * fadeOut;
}

/** Flatten the shared gain curve with bounded continuous error and sub-frame step transitions. */
export function audioGainPoints(clip: AudibleClip): NumberKeyframe[] {
  const boundaries = [
    ...new Set([
      0,
      clip.durationFrames,
      ...clip.keyframes.volume.map((k) => k.frame),
      clip.fade.inFrames,
      clip.durationFrames - clip.fade.outFrames,
    ]),
  ]
    .filter((f) => f >= 0 && f <= clip.durationFrames)
    .sort((a, b) => a - b);
  const points: NumberKeyframe[] = [];
  const append = (frame: number) => {
    points.push({ frame, value: clipAudioGain(clip, frame), easing: 'linear' });
    if (points.length > 256)
      throw new Error(
        'Audio automation is too complex to render. Simplify the volume curve.',
      );
  };
  const segment = (a: number, b: number, depth: number) => {
    const va = clipAudioGain(clip, a);
    const vb = clipAudioGain(clip, b);
    const error = [0.25, 0.5, 0.75].some(
      (t) =>
        Math.abs(clipAudioGain(clip, a + (b - a) * t) - (va + (vb - va) * t)) >
        0.0001,
    );
    if (error && b - a > 0.0001 && depth < 20) {
      const mid = (a + b) / 2;
      segment(a, mid, depth + 1);
      segment(mid, b, depth + 1);
    } else append(b);
  };
  append(0);
  for (let i = 1; i < boundaries.length; i++)
    segment(boundaries[i - 1]!, boundaries[i]!, 0);
  return points;
}
