import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import type { ApplyContext } from './apply';
import { EngineError, isEngineError } from './errors';
import {
  makeSequence,
  makeTextClip,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';
import { rippleDeleteCommand, rippleTrimCommand } from './ripple';

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

describe('clip.split', () => {
  it('allocates the right half and restores the unsplit clip', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 30,
      sourceInFrame: 100,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.split',
      clipId: clip.id,
      frame: 25,
    });
    const clips = result.sequence.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    const [left, right] = clips;
    expect(left?.id).toBe(clip.id);
    expect(left?.startFrame).toBe(10);
    expect(left?.durationFrames).toBe(15);
    expect(right?.startFrame).toBe(25);
    expect(right?.durationFrames).toBe(15);
    expect(right?.id).not.toBe(clip.id);

    if (left?.type === 'video' && right?.type === 'video') {
      expect(left.sourceInFrame + left.durationFrames).toBe(
        right.sourceInFrame,
      );
    }

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('rebases time maps across the split point', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 20,
      timeMap: [
        { frame: 0, sourceFrame: 100 },
        { frame: 20, sourceFrame: 0 },
      ],
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.split',
      clipId: clip.id,
      frame: 20,
    });
    const [left, right] = result.sequence.tracks[0]?.clips ?? [];
    if (left?.type === 'video' && right?.type === 'video') {
      expect(left.timeMap).toEqual([
        { frame: 0, sourceFrame: 100 },
        { frame: 10, sourceFrame: 50 },
      ]);
      expect(right.timeMap).toEqual([
        { frame: 0, sourceFrame: 50 },
        { frame: 10, sourceFrame: 0 },
      ]);
      expect(left.timeMap.at(-1)?.sourceFrame).toBe(
        right.timeMap[0]?.sourceFrame,
      );
    }

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('splits non-media clips and rejects edges or locked tracks', () => {
    const track = makeTrack('overlay', 0);
    const clip = makeTextClip(track.id, 0, 20);
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.split',
      clipId: clip.id,
      frame: 10,
    });
    expect(result.sequence.tracks[0]?.clips).toHaveLength(2);
    if (result.inverse) {
      expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
        sequence,
      );
    }

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.split',
          clipId: clip.id,
          frame: 0,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.split',
          clipId: clip.id,
          frame: 20,
        }),
      'invalid-range',
    );

    const locked = makeSequence([
      withClips({ ...track, locked: true }, [clip]),
    ]);
    expectEngineError(
      () =>
        applyCommand(locked, {
          type: 'clip.split',
          clipId: clip.id,
          frame: 10,
        }),
      'locked',
    );
  });
});

describe('clip.duplicate', () => {
  it('offsets a duplicate and removes it exactly on undo', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.duplicate',
      clipId: clip.id,
      offsetFrames: 24,
    });
    const clips = result.sequence.tracks[0]?.clips ?? [];
    expect(clips).toHaveLength(2);
    expect(clips[1]?.id).not.toBe(clip.id);
    expect(clips[1]?.startFrame).toBe(24);
    expect(result.inverse).toEqual({
      type: 'clip.remove',
      clipId: clips[1]?.id,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('can duplicate onto another compatible track', () => {
    const first = makeTrack('video', 0);
    const second = makeTrack('video', 1);
    const clip = makeVideoClip({
      trackId: first.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(first, [clip]), second]);

    const result = applyCommand(sequence, {
      type: 'clip.duplicate',
      clipId: clip.id,
      trackId: second.id,
      offsetFrames: 0,
    });
    expect(result.sequence.tracks[1]?.clips[0]?.id).not.toBe(clip.id);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('rejects overlaps, negative offsets, locked targets and wrong tracks', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.duplicate',
          clipId: clip.id,
          offsetFrames: 0,
        }),
      'overlap',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.duplicate',
          clipId: clip.id,
          offsetFrames: -1,
        }),
      'invalid-range',
    );

    const lockedTarget = { ...makeTrack('video', 1), locked: true };
    const locked = makeSequence([withClips(track, [clip]), lockedTarget]);
    expectEngineError(
      () =>
        applyCommand(locked, {
          type: 'clip.duplicate',
          clipId: clip.id,
          trackId: lockedTarget.id,
          offsetFrames: 0,
        }),
      'locked',
    );

    const audioTarget = makeTrack('audio', 1);
    const wrongTrack = makeSequence([withClips(track, [clip]), audioTarget]);
    expectEngineError(
      () =>
        applyCommand(wrongTrack, {
          type: 'clip.duplicate',
          clipId: clip.id,
          trackId: audioTarget.id,
          offsetFrames: 0,
        }),
      'incompatible-track',
    );
  });
});

describe('clip.slip', () => {
  it('shifts linear source frames without moving the clip', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 100,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const context: ApplyContext = {
      sourceDurationFrames: () => 200,
    };

    const result = applyCommand(
      sequence,
      { type: 'clip.slip', clipId: clip.id, deltaFrames: 20 },
      context,
    );
    const updated = result.sequence.tracks[0]?.clips[0];
    expect(updated?.startFrame).toBe(0);
    if (updated?.type === 'video') {
      expect(updated.sourceInFrame).toBe(120);
    }
    expect(result.inverse).toEqual({
      type: 'clip.slip',
      clipId: clip.id,
      deltaFrames: -20,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(result.sequence, result.inverse, context).sequence,
    ).toEqual(sequence);
  });

  it('shifts every point in a time map', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      timeMap: [
        { frame: 0, sourceFrame: 100 },
        { frame: 20, sourceFrame: 0 },
      ],
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.slip',
      clipId: clip.id,
      deltaFrames: 10,
    });
    const updated = result.sequence.tracks[0]?.clips[0];
    if (updated?.type === 'video') {
      expect(updated.timeMap).toEqual([
        { frame: 0, sourceFrame: 110 },
        { frame: 20, sourceFrame: 10 },
      ]);
    }

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('rejects slips outside the source and non-media clips', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 5,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.slip',
          clipId: clip.id,
          deltaFrames: -10,
        }),
      'invalid-range',
    );

    const longClip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 20,
      sourceInFrame: 100,
    });
    const longSequence = makeSequence([withClips(track, [longClip])]);
    expectEngineError(
      () =>
        applyCommand(
          longSequence,
          { type: 'clip.slip', clipId: longClip.id, deltaFrames: 20 },
          { sourceDurationFrames: () => 130 },
        ),
      'invalid-range',
    );

    const textTrack = makeTrack('overlay', 0);
    const text = makeTextClip(textTrack.id);
    const textSequence = makeSequence([withClips(textTrack, [text])]);
    expectEngineError(
      () =>
        applyCommand(textSequence, {
          type: 'clip.slip',
          clipId: text.id,
          deltaFrames: 1,
        }),
      'invalid-command',
    );
  });

  it('rejects slip on locked tracks', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([
      withClips({ ...track, locked: true }, [clip]),
    ]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.slip',
          clipId: clip.id,
          deltaFrames: 1,
        }),
      'locked',
    );
  });
});

describe('ripple helpers', () => {
  it('closes the gap left by a ripple delete', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
    });
    const middle = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 10,
    });
    const last = makeVideoClip({
      trackId: track.id,
      startFrame: 20,
      durationFrames: 10,
    });
    const sequence = makeSequence([withClips(track, [first, middle, last])]);

    const command = rippleDeleteCommand(sequence, middle.id);
    expect(command.type).toBe('batch');
    const result = applyCommand(sequence, command);
    expect(
      result.sequence.tracks[0]?.clips.map((clip) => [
        clip.id,
        clip.startFrame,
      ]),
    ).toEqual([
      [first.id, 0],
      [last.id, 10],
    ]);

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('ripples a shorter trim to the next clips', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
    });
    const second = makeVideoClip({
      trackId: track.id,
      startFrame: 20,
      durationFrames: 10,
    });
    const third = makeVideoClip({
      trackId: track.id,
      startFrame: 30,
      durationFrames: 10,
    });
    const sequence = makeSequence([withClips(track, [first, second, third])]);

    const result = applyCommand(
      sequence,
      rippleTrimCommand(sequence, first.id, 'out', -4),
    );
    expect(
      result.sequence.tracks[0]?.clips.map((clip) => clip.startFrame),
    ).toEqual([0, 16, 26]);
    expect(result.sequence.tracks[0]?.clips[0]?.durationFrames).toBe(6);

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('moves neighbours before extending a clip', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 10,
    });
    const second = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 10,
    });
    const sequence = makeSequence([withClips(track, [first, second])]);

    const result = applyCommand(
      sequence,
      rippleTrimCommand(sequence, first.id, 'out', 4),
    );
    const clips = result.sequence.tracks[0]?.clips ?? [];
    expect(clips[0]?.durationFrames).toBe(14);
    expect(clips[1]?.startFrame).toBe(14);

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });
});
