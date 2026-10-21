import type { EditCommand, Sequence } from '@kerf/model';
import { newId } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import { EngineError, isEngineError } from './errors';
import {
  makeAudioClip,
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function emptyVideoSequence(): { trackId: string; sequence: Sequence } {
  const track = makeTrack('video', 0);
  return { trackId: track.id, sequence: makeSequence([track]) };
}

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

describe('clip.insert', () => {
  it('inserts a clip and returns an exact remove inverse', () => {
    const { trackId, sequence } = emptyVideoSequence();
    const clip = makeVideoClip({
      trackId,
      startFrame: 0,
      durationFrames: 48,
    });

    const result = applyCommand(sequence, { type: 'clip.insert', clip });
    expect(result.sequence.tracks[0]?.clips).toHaveLength(1);
    expect(result.inverse).toEqual({
      type: 'clip.remove',
      clipId: clip.id,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
    expect(undone.inverse?.type).toBe('clip.insert');
  });

  it('honours an explicit index and restores array order on undo', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const third = makeVideoClip({
      trackId: track.id,
      startFrame: 24,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(track, [first, third])]);
    const middle = makeVideoClip({
      trackId: track.id,
      startFrame: 12,
      durationFrames: 12,
    });

    const result = applyCommand(sequence, {
      type: 'clip.insert',
      clip: middle,
      index: 1,
    });
    expect(result.sequence.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      first.id,
      middle.id,
      third.id,
    ]);

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('fills defaults from a partial insert payload', () => {
    const { trackId, sequence } = emptyVideoSequence();
    const raw = {
      type: 'clip.insert',
      clip: {
        id: newId('clip'),
        trackId,
        startFrame: 0,
        durationFrames: 48,
        type: 'video',
        assetId: newId('asset'),
      },
    } as unknown as EditCommand;

    const result = applyCommand(sequence, raw);
    const inserted = result.sequence.tracks[0]?.clips[0];
    expect(inserted?.type).toBe('video');
    if (inserted?.type === 'video') {
      expect(inserted.speed).toBe(1);
      expect(inserted.transform).toEqual({
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        anchorX: 0.5,
        anchorY: 0.5,
      });
    }
  });
});

describe('clip.remove', () => {
  it('removes a clip and returns an indexed insert inverse', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 12,
    });
    const second = makeVideoClip({
      trackId: track.id,
      startFrame: 24,
      durationFrames: 12,
    });
    const sequence = makeSequence([withClips(track, [first, second])]);

    const result = applyCommand(sequence, {
      type: 'clip.remove',
      clipId: first.id,
    });
    expect(result.sequence.tracks[0]?.clips.map((clip) => clip.id)).toEqual([
      second.id,
    ]);
    expect(result.inverse).toEqual({
      type: 'clip.insert',
      clip: first,
      index: 0,
    });

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });
});

describe('clip.update', () => {
  it('updates fields and restores the previous values', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 48,
    });
    const sequence = makeSequence([withClips(track, [clip])]);

    const result = applyCommand(sequence, {
      type: 'clip.update',
      clipId: clip.id,
      patch: { label: 'New label', startFrame: 12 },
    });
    const updated = result.sequence.tracks[0]?.clips[0];
    expect(updated?.label).toBe('New label');
    expect(updated?.startFrame).toBe(12);

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(result.inverse.type).toBe('clip.update');
    if (result.inverse.type === 'clip.update') {
      expect(result.inverse.patch).toEqual({
        label: '',
        startFrame: 0,
      });
    }

    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });

  it('moves a clip between compatible tracks with a batch inverse', () => {
    const firstTrack = makeTrack('video', 0);
    const secondTrack = makeTrack('video', 1);
    const clip = makeVideoClip({
      trackId: firstTrack.id,
      startFrame: 0,
      durationFrames: 16,
    });
    const sequence = makeSequence([withClips(firstTrack, [clip]), secondTrack]);

    const result = applyCommand(sequence, {
      type: 'clip.update',
      clipId: clip.id,
      patch: { trackId: secondTrack.id },
    });
    expect(result.sequence.tracks[0]?.clips).toEqual([]);
    expect(result.sequence.tracks[1]?.clips[0]?.id).toBe(clip.id);
    expect(result.inverse?.type).toBe('batch');

    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });
});

describe('edit validation', () => {
  it('rejects edits on locked tracks', () => {
    const track = makeTrack('video', 0);
    const locked = { ...track, locked: true };
    const sequence = makeSequence([locked]);
    const clip = makeVideoClip({ trackId: track.id });

    expectEngineError(
      () => applyCommand(sequence, { type: 'clip.insert', clip }),
      'locked',
    );

    const populated = makeSequence([withClips(locked, [clip])]);
    expectEngineError(
      () =>
        applyCommand(populated, {
          type: 'clip.remove',
          clipId: clip.id,
        }),
      'locked',
    );
  });

  it('rejects incompatible clips and overlapping ranges', () => {
    const { trackId, sequence } = emptyVideoSequence();
    const audio = makeAudioClip({ trackId });
    expectEngineError(
      () => applyCommand(sequence, { type: 'clip.insert', clip: audio }),
      'incompatible-track',
    );

    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 0,
      durationFrames: 48,
    });
    const second = makeVideoClip({
      trackId: track.id,
      startFrame: 24,
      durationFrames: 48,
    });
    const populated = makeSequence([withClips(track, [first])]);
    expectEngineError(
      () => applyCommand(populated, { type: 'clip.insert', clip: second }),
      'overlap',
    );
  });

  it('rejects duplicate ids, missing tracks and bad indices', () => {
    const { trackId, sequence } = emptyVideoSequence();
    const clip = makeVideoClip({ trackId });
    const inserted = applyCommand(sequence, { type: 'clip.insert', clip });

    expectEngineError(
      () => applyCommand(inserted.sequence, { type: 'clip.insert', clip }),
      'invalid-command',
    );

    const orphan = makeVideoClip({ trackId: newId('track') });
    expectEngineError(
      () => applyCommand(sequence, { type: 'clip.insert', clip: orphan }),
      'not-found',
    );

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.insert',
          clip: makeVideoClip({ trackId }),
          index: 2,
        }),
      'invalid-range',
    );
  });

  it('rejects patches with fields that do not belong to the clip type', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.update',
          clipId: clip.id,
          patch: { fit: 'cover' },
        }),
      'invalid-command',
    );
  });

  it('rejects commands the engine does not recognise', () => {
    const { sequence } = emptyVideoSequence();
    const unknown = {
      type: 'unknown.command',
    } as unknown as EditCommand;
    expectEngineError(() => applyCommand(sequence, unknown), 'invalid-command');
  });
});

describe('batches', () => {
  it('applies child commands and unwinds them in reverse order', () => {
    const { trackId, sequence } = emptyVideoSequence();
    const first = makeVideoClip({
      trackId,
      startFrame: 0,
      durationFrames: 12,
    });
    const second = makeVideoClip({
      trackId,
      startFrame: 24,
      durationFrames: 12,
    });

    const result = applyCommand(sequence, {
      type: 'batch',
      label: 'Insert two',
      commands: [
        { type: 'clip.insert', clip: first },
        { type: 'clip.insert', clip: second },
      ],
    });
    expect(result.sequence.tracks[0]?.clips).toHaveLength(2);
    expect(result.inverse?.type).toBe('batch');
    if (!result.inverse || result.inverse.type !== 'batch') {
      throw new Error('expected a batch inverse');
    }
    expect(result.inverse.commands.map((command) => command.type)).toEqual([
      'clip.remove',
      'clip.remove',
    ]);

    const undone = applyCommand(result.sequence, result.inverse);
    expect(undone.sequence).toEqual(sequence);
  });
});
