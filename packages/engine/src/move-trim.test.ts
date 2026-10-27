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

describe('clip.move', () => {
  it('moves a clip in time and restores the original start', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.move',
      clipId: clip.id,
      startFrame: 24,
    });
    expect(result.sequence.tracks[0]?.clips[0]?.startFrame).toBe(24);
    expect(result.inverse).toEqual({
      type: 'clip.move',
      clipId: clip.id,
      trackId: track.id,
      startFrame: 0,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('moves a clip across compatible tracks', () => {
    const firstTrack = makeTrack('video', 0);
    const secondTrack = makeTrack('video', 1);
    const clip = makeVideoClip({
      trackId: firstTrack.id,
      startFrame: 0,
      durationFrames: 16,
    });
    const sequence = makeSequence([withClips(firstTrack, [clip]), secondTrack]);

    const result = applyCommand(sequence, {
      type: 'clip.move',
      clipId: clip.id,
      trackId: secondTrack.id,
      startFrame: 32,
    });
    expect(result.sequence.tracks[0]?.clips).toEqual([]);
    expect(result.sequence.tracks[1]?.clips[0]?.startFrame).toBe(32);
    expect(result.inverse?.type).toBe('clip.move');

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('rejects incompatible, locked and overlapping destinations', () => {
    const videoTrack = makeTrack('video', 0);
    const audioTrack = makeTrack('audio', 1);
    const clip = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(videoTrack, [clip]), audioTrack]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.move',
          clipId: clip.id,
          trackId: audioTrack.id,
          startFrame: 0,
        }),
      'incompatible-track',
    );

    const lockedTarget = { ...makeTrack('video', 2), locked: true };
    const lockedSequence = makeSequence([
      withClips(videoTrack, [clip]),
      lockedTarget,
    ]);
    expectEngineError(
      () =>
        applyCommand(lockedSequence, {
          type: 'clip.move',
          clipId: clip.id,
          trackId: lockedTarget.id,
          startFrame: 0,
        }),
      'locked',
    );

    const blocker = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 24,
      durationFrames: 12,
    });
    const blocked = makeSequence([withClips(videoTrack, [clip, blocker])]);
    expectEngineError(
      () =>
        applyCommand(blocked, {
          type: 'clip.move',
          clipId: clip.id,
          startFrame: 20,
        }),
      'overlap',
    );
  });
});

describe('clip.trim', () => {
  it('trims a text clip from either edge and restores it', () => {
    const track = makeTrack('overlay', 0);
    const clip = makeTextClip(track.id, 10, 48);
    const sequence = makeSequence([withClips(track, [clip])]);

    const trimmedIn = applyCommand(sequence, {
      type: 'clip.trim',
      clipId: clip.id,
      edge: 'in',
      frames: 10,
    });
    expect(trimmedIn.sequence.tracks[0]?.clips[0]?.startFrame).toBe(20);
    expect(trimmedIn.sequence.tracks[0]?.clips[0]?.durationFrames).toBe(38);
    if (!trimmedIn.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(trimmedIn.sequence, trimmedIn.inverse).sequence,
    ).toEqual(sequence);

    const trimmedOut = applyCommand(sequence, {
      type: 'clip.trim',
      clipId: clip.id,
      edge: 'out',
      frames: -10,
    });
    expect(trimmedOut.sequence.tracks[0]?.clips[0]?.durationFrames).toBe(38);
    if (!trimmedOut.inverse) {
      throw new Error('expected an inverse');
    }
    expect(
      applyCommand(trimmedOut.sequence, trimmedOut.inverse).sequence,
    ).toEqual(sequence);
  });

  it('advances the source when trimming the in point of linear media', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 48,
      sourceInFrame: 20,
      speed: 1,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.trim',
      clipId: clip.id,
      edge: 'in',
      frames: 10,
    });
    const updated = result.sequence.tracks[0]?.clips[0];
    expect(updated?.startFrame).toBe(20);
    expect(updated?.durationFrames).toBe(38);
    if (updated?.type === 'video') {
      expect(updated.sourceInFrame).toBe(30);
    }

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('enforces source bounds supplied by the caller', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 48,
      sourceInFrame: 20,
      speed: 1,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const context: ApplyContext = {
      sourceDurationFrames: () => 100,
    };

    const extended = applyCommand(
      sequence,
      {
        type: 'clip.trim',
        clipId: clip.id,
        edge: 'out',
        frames: 20,
      },
      context,
    );
    expect(extended.sequence.tracks[0]?.clips[0]?.durationFrames).toBe(68);

    expectEngineError(
      () =>
        applyCommand(
          sequence,
          {
            type: 'clip.trim',
            clipId: clip.id,
            edge: 'out',
            frames: 40,
          },
          context,
        ),
      'invalid-range',
    );
  });

  it('rejects zero-length results and trims before frame zero', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 20,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: clip.id,
          edge: 'in',
          frames: 20,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: clip.id,
          edge: 'out',
          frames: -20,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: clip.id,
          edge: 'in',
          frames: -12,
        }),
      'invalid-range',
    );
  });

  it('rejects trims that collide with a neighbour', () => {
    const track = makeTrack('video', 0);
    const neighbour = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 12,
      durationFrames: 24,
      sourceInFrame: 12,
    });
    const sequence = makeSequence([withClips(track, [neighbour, clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: clip.id,
          edge: 'in',
          frames: -4,
        }),
      'overlap',
    );
  });

  it('rebases time maps while trimming and restores them on undo', () => {
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
      type: 'clip.trim',
      clipId: clip.id,
      edge: 'in',
      frames: 5,
    });
    const updated = result.sequence.tracks[0]?.clips[0];
    expect(updated?.startFrame).toBe(15);
    expect(updated?.durationFrames).toBe(15);
    if (updated?.type === 'video') {
      expect(updated.timeMap).toEqual([
        { frame: 0, sourceFrame: 75 },
        { frame: 15, sourceFrame: 0 },
      ]);
    }

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('rejects edits on locked tracks', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([
      withClips({ ...track, locked: true }, [clip]),
    ]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: clip.id,
          edge: 'in',
          frames: 1,
        }),
      'locked',
    );
  });

  it('rejects media clips on the wrong track before trimming', () => {
    const track = makeTrack('video', 0);
    const audio = makeAudioClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [audio])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: audio.id,
          edge: 'out',
          frames: -1,
        }),
      'incompatible-track',
    );
  });
});
