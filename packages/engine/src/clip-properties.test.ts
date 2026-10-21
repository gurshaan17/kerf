import { effectSchema, maskSchema, newId } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import type { ApplyContext } from './apply';
import { EngineError, isEngineError } from './errors';
import {
  makeAudioClip,
  makeSequence,
  makeTextClip,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function expectEngineError(fn: () => unknown, code: EngineError['code']): void {
  try {
    fn();
    throw new Error(`expected an EngineError with code ${code}`);
  } catch (error) {
    expect(isEngineError(error)).toBe(true);
    if (error instanceof EngineError) {
      expect(error.code).toBe(code);
      expect(error.hint).toBeTruthy();
    }
  }
}

function makeEffect(amount = 2) {
  return effectSchema.parse({
    id: newId('effect'),
    type: 'blur',
    amount,
  });
}

function makeMask() {
  return maskSchema.parse({
    id: newId('mask'),
    type: 'ellipse',
  });
}

describe('clip.setSpeed', () => {
  it('changes speed and restores the previous value', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 0,
      speed: 1,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const context: ApplyContext = { sourceDurationFrames: () => 100 };

    const result = applyCommand(
      sequence,
      { type: 'clip.setSpeed', clipId: clip.id, speed: 2 },
      context,
    );
    const updated = result.sequence.tracks[0]?.clips[0];
    if (updated?.type === 'video') {
      expect(updated.speed).toBe(2);
    }
    expect(result.inverse).toEqual({
      type: 'clip.setSpeed',
      clipId: clip.id,
      speed: 1,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(result.sequence, result.inverse, context).sequence,
    ).toEqual(sequence);
  });

  it('rejects non-media clips, bad speeds and source overruns', () => {
    const textTrack = makeTrack('overlay', 0);
    const text = makeTextClip(textTrack.id);
    const textSequence = makeSequence([withClips(textTrack, [text])]);
    expectEngineError(
      () =>
        applyCommand(textSequence, {
          type: 'clip.setSpeed',
          clipId: text.id,
          speed: 2,
        }),
      'invalid-command',
    );

    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 0,
      speed: 1,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.setSpeed',
          clipId: clip.id,
          speed: 0,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        applyCommand(
          sequence,
          { type: 'clip.setSpeed', clipId: clip.id, speed: 2 },
          { sourceDurationFrames: () => 30 },
        ),
      'invalid-range',
    );
  });
});

describe('clip.setTimeMap', () => {
  it('sets forward and reverse maps with exact inverses', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 0,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const forward = [
      { frame: 0, sourceFrame: 0 },
      { frame: 20, sourceFrame: 40 },
    ];
    const reverse = [
      { frame: 0, sourceFrame: 100 },
      { frame: 20, sourceFrame: 0 },
    ];

    const forwardResult = applyCommand(sequence, {
      type: 'clip.setTimeMap',
      clipId: clip.id,
      points: forward,
    });
    const updated = forwardResult.sequence.tracks[0]?.clips[0];
    if (updated?.type === 'video') {
      expect(updated.timeMap).toEqual(forward);
    }
    if (!forwardResult.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(forwardResult.sequence, forwardResult.inverse).sequence,
    ).toEqual(sequence);

    const reverseResult = applyCommand(sequence, {
      type: 'clip.setTimeMap',
      clipId: clip.id,
      points: reverse,
    });
    if (!reverseResult.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(reverseResult.sequence, reverseResult.inverse).sequence,
    ).toEqual(sequence);
  });

  it('rejects unordered points and source overruns', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.setTimeMap',
          clipId: clip.id,
          points: [
            { frame: 20, sourceFrame: 0 },
            { frame: 0, sourceFrame: 10 },
          ],
        }),
      'invalid-command',
    );
    expectEngineError(
      () =>
        applyCommand(
          sequence,
          {
            type: 'clip.setTimeMap',
            clipId: clip.id,
            points: [
              { frame: 0, sourceFrame: 0 },
              { frame: 20, sourceFrame: 60 },
            ],
          },
          { sourceDurationFrames: () => 50 },
        ),
      'invalid-range',
    );
  });
});

describe('clip.setKeyframes', () => {
  it('replaces a keyframe track and restores the old one', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);
    const keyframes = [
      { frame: 0, value: 0, easing: 'linear' as const },
      { frame: 12, value: 1, easing: 'ease-in' as const },
    ];

    const result = applyCommand(sequence, {
      type: 'clip.setKeyframes',
      clipId: clip.id,
      property: 'opacity',
      keyframes,
    });
    const updated = result.sequence.tracks[0]?.clips[0];
    expect(updated?.keyframes.opacity).toEqual(keyframes);
    expect(result.inverse).toEqual({
      type: 'clip.setKeyframes',
      clipId: clip.id,
      property: 'opacity',
      keyframes: [],
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('rejects unordered keyframes and properties the clip cannot animate', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.setKeyframes',
          clipId: clip.id,
          property: 'opacity',
          keyframes: [
            { frame: 12, value: 1, easing: 'linear' },
            { frame: 0, value: 0, easing: 'linear' },
          ],
        }),
      'invalid-command',
    );

    const textTrack = makeTrack('overlay', 0);
    const text = makeTextClip(textTrack.id);
    const textSequence = makeSequence([withClips(textTrack, [text])]);
    expectEngineError(
      () =>
        applyCommand(textSequence, {
          type: 'clip.setKeyframes',
          clipId: text.id,
          property: 'volume',
          keyframes: [],
        }),
      'invalid-command',
    );

    const audioTrack = makeTrack('audio', 0);
    const audio = makeAudioClip({ trackId: audioTrack.id });
    const audioSequence = makeSequence([withClips(audioTrack, [audio])]);
    expectEngineError(
      () =>
        applyCommand(audioSequence, {
          type: 'clip.setKeyframes',
          clipId: audio.id,
          property: 'x',
          keyframes: [],
        }),
      'invalid-command',
    );
  });
});

describe('effects', () => {
  it('adds effects at an index and restores array order on undo', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);
    const first = makeEffect(2);
    const second = makeEffect(3);

    const withFirst = applyCommand(sequence, {
      type: 'clip.addEffect',
      clipId: clip.id,
      effect: first,
    });
    const withBoth = applyCommand(withFirst.sequence, {
      type: 'clip.addEffect',
      clipId: clip.id,
      effect: second,
    });
    expect(
      withBoth.sequence.tracks[0]?.clips[0]?.effects.map((item) => item.id),
    ).toEqual([first.id, second.id]);

    const removed = applyCommand(withBoth.sequence, {
      type: 'clip.removeEffect',
      clipId: clip.id,
      effectId: first.id,
    });
    expect(
      removed.sequence.tracks[0]?.clips[0]?.effects.map((item) => item.id),
    ).toEqual([second.id]);

    if (!removed.inverse) {
      throw new Error('expected an inverse');
    }
    const restored = applyCommand(removed.sequence, removed.inverse);
    expect(
      restored.sequence.tracks[0]?.clips[0]?.effects.map((item) => item.id),
    ).toEqual([first.id, second.id]);
  });

  it('updates an effect and returns the previous patch', () => {
    const track = makeTrack('video', 0);
    const effect = makeEffect(2);
    const clip = makeVideoClip({ trackId: track.id, effects: [effect] });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.updateEffect',
      clipId: clip.id,
      effectId: effect.id,
      patch: { amount: 5, enabled: false },
    });
    const updated = result.sequence.tracks[0]?.clips[0]?.effects[0];
    expect(updated?.amount).toBe(5);
    expect(updated?.enabled).toBe(false);
    expect(result.inverse).toEqual({
      type: 'clip.updateEffect',
      clipId: clip.id,
      effectId: effect.id,
      patch: { amount: 2, enabled: true },
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('rejects effects on audio, duplicates and missing effects', () => {
    const audioTrack = makeTrack('audio', 0);
    const audio = makeAudioClip({ trackId: audioTrack.id });
    const audioSequence = makeSequence([withClips(audioTrack, [audio])]);
    expectEngineError(
      () =>
        applyCommand(audioSequence, {
          type: 'clip.addEffect',
          clipId: audio.id,
          effect: makeEffect(),
        }),
      'invalid-command',
    );

    const track = makeTrack('video', 0);
    const effect = makeEffect();
    const clip = makeVideoClip({ trackId: track.id, effects: [effect] });
    const sequence = makeSequence([withClips(track, [clip])]);
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.addEffect',
          clipId: clip.id,
          effect,
        }),
      'invalid-command',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.removeEffect',
          clipId: clip.id,
          effectId: newId('effect'),
        }),
      'not-found',
    );
  });
});

describe('masks', () => {
  it('adds, updates and removes masks with exact inverses', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);
    const first = makeMask();
    const second = makeMask();

    const withFirst = applyCommand(sequence, {
      type: 'clip.addMask',
      clipId: clip.id,
      mask: first,
    });
    const withBoth = applyCommand(withFirst.sequence, {
      type: 'clip.addMask',
      clipId: clip.id,
      mask: second,
    });
    expect(
      withBoth.sequence.tracks[0]?.clips[0]?.masks.map((mask) => mask.id),
    ).toEqual([first.id, second.id]);

    const removed = applyCommand(withBoth.sequence, {
      type: 'clip.removeMask',
      clipId: clip.id,
      maskId: first.id,
    });
    if (!removed.inverse) {
      throw new Error('expected an inverse');
    }
    const restored = applyCommand(removed.sequence, removed.inverse);
    expect(
      restored.sequence.tracks[0]?.clips[0]?.masks.map((mask) => mask.id),
    ).toEqual([first.id, second.id]);

    const updated = applyCommand(withBoth.sequence, {
      type: 'clip.updateMask',
      clipId: clip.id,
      maskId: second.id,
      patch: { feather: 0.5, inverted: true },
    });
    const updatedMask = updated.sequence.tracks[0]?.clips[0]?.masks[1];
    expect(updatedMask?.feather).toBe(0.5);
    expect(updatedMask?.inverted).toBe(true);
    if (!updated.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(updated.sequence, updated.inverse).sequence).toEqual(
      withBoth.sequence,
    );
  });

  it('rejects masks on audio and missing masks', () => {
    const audioTrack = makeTrack('audio', 0);
    const audio = makeAudioClip({ trackId: audioTrack.id });
    const audioSequence = makeSequence([withClips(audioTrack, [audio])]);
    expectEngineError(
      () =>
        applyCommand(audioSequence, {
          type: 'clip.addMask',
          clipId: audio.id,
          mask: makeMask(),
        }),
      'invalid-command',
    );

    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.removeMask',
          clipId: clip.id,
          maskId: newId('mask'),
        }),
      'not-found',
    );
  });
});
