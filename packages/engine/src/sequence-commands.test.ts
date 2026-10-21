import { createMarker, newId, referenceProfileSchema } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import { EngineError, isEngineError } from './errors';
import {
  makeSequence,
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

describe('sequence commands', () => {
  it('renames the sequence and restores the old name', () => {
    const sequence = makeSequence([makeTrack('video', 0)]);
    const result = applyCommand(sequence, {
      type: 'sequence.rename',
      name: 'Act one',
    });
    expect(result.sequence.name).toBe('Act one');
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'sequence.rename',
          name: '   ',
        }),
      'invalid-command',
    );
  });

  it('sets the canvas and restores size and frame rate', () => {
    const sequence = makeSequence([makeTrack('video', 0)]);
    const result = applyCommand(sequence, {
      type: 'sequence.setCanvas',
      width: 1080,
      height: 1920,
      frameRate: { numerator: 30, denominator: 1 },
    });
    expect(result.sequence.width).toBe(1080);
    expect(result.sequence.height).toBe(1920);
    expect(result.sequence.frameRate).toEqual({
      numerator: 30,
      denominator: 1,
    });
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'sequence.setCanvas',
          width: 0,
          height: 1080,
        }),
      'invalid-command',
    );
  });

  it('patches style fields and restores their previous values', () => {
    const sequence = makeSequence([makeTrack('video', 0)]);
    const result = applyCommand(sequence, {
      type: 'sequence.setStyle',
      style: { accent: '#ffffff', captionSize: 64 },
    });
    expect(result.sequence.style.accent).toBe('#ffffff');
    expect(result.sequence.style.captionSize).toBe(64);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('sets and clears a reference profile', () => {
    const sequence = makeSequence([makeTrack('video', 0)]);
    const reference = referenceProfileSchema.parse({
      id: newId('reference'),
      name: 'Noir',
      createdAt: 1,
    });
    const result = applyCommand(sequence, {
      type: 'sequence.setReference',
      reference,
    });
    expect(result.sequence.reference).toEqual(reference);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );

    const cleared = applyCommand(result.sequence, {
      type: 'sequence.setReference',
      reference: null,
    });
    expect(cleared.sequence.reference).toBeNull();
  });
});

describe('track commands', () => {
  it('adds a track at an index and removes it again', () => {
    const first = makeTrack('video', 0);
    const second = makeTrack('audio', 1);
    const third = makeTrack('caption', 2);
    const sequence = makeSequence([first, second]);
    const result = applyCommand(sequence, {
      type: 'track.add',
      track: third,
      index: 1,
    });
    expect(result.sequence.tracks.map((track) => track.id)).toEqual([
      first.id,
      third.id,
      second.id,
    ]);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('removes a track and restores its position and clips', () => {
    const first = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: first.id });
    const populated = withClips(first, [clip]);
    const second = makeTrack('audio', 1);
    const sequence = makeSequence([populated, second]);

    const result = applyCommand(sequence, {
      type: 'track.remove',
      trackId: populated.id,
    });
    expect(result.sequence.tracks.map((track) => track.id)).toEqual([
      second.id,
    ]);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('updates track fields and restores them', () => {
    const track = makeTrack('video', 0);
    const sequence = makeSequence([track]);
    const result = applyCommand(sequence, {
      type: 'track.update',
      trackId: track.id,
      patch: { name: 'B-roll', locked: true, height: 80 },
    });
    expect(result.sequence.tracks[0]?.name).toBe('B-roll');
    expect(result.sequence.tracks[0]?.locked).toBe(true);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );
  });

  it('rejects incompatible kind changes and locked track edits', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({ trackId: track.id });
    const sequence = makeSequence([withClips(track, [clip])]);
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'track.update',
          trackId: track.id,
          patch: { kind: 'audio' },
        }),
      'incompatible-track',
    );

    const locked = makeSequence([{ ...track, locked: true }]);
    expectEngineError(
      () =>
        applyCommand(locked, {
          type: 'track.update',
          trackId: track.id,
          patch: { name: 'Nope' },
        }),
      'locked',
    );

    const unlocked = applyCommand(locked, {
      type: 'track.update',
      trackId: track.id,
      patch: { locked: false },
    });
    expect(unlocked.sequence.tracks[0]?.locked).toBe(false);
    expectEngineError(
      () =>
        applyCommand(makeSequence([{ ...track, locked: true }]), {
          type: 'track.remove',
          trackId: track.id,
        }),
      'locked',
    );
  });

  it('reorders tracks and restores their original order fields', () => {
    const first = makeTrack('video', 0);
    const second = makeTrack('audio', 1);
    const third = makeTrack('caption', 2);
    const sequence = makeSequence([first, second, third]);

    const result = applyCommand(sequence, {
      type: 'track.reorder',
      trackId: first.id,
      toIndex: 2,
    });
    expect(
      [...result.sequence.tracks]
        .sort((left, right) => left.order - right.order)
        .map((track) => track.id),
    ).toEqual([second.id, third.id, first.id]);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      sequence,
    );

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'track.reorder',
          trackId: first.id,
          toIndex: 3,
        }),
      'invalid-range',
    );
  });
});

describe('marker commands', () => {
  it('adds a marker at an index and removes it again', () => {
    const sequence = makeSequence([makeTrack('video', 0)]);
    const first = createMarker({ frame: 10, label: 'One' });
    const second = createMarker({ frame: 20, label: 'Two' });
    const withMarkers = applyCommand(sequence, {
      type: 'marker.add',
      marker: first,
    });
    const result = applyCommand(withMarkers.sequence, {
      type: 'marker.add',
      marker: second,
      index: 0,
    });
    expect(result.sequence.markers.map((marker) => marker.id)).toEqual([
      second.id,
      first.id,
    ]);
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(result.sequence, result.inverse).sequence).toEqual(
      withMarkers.sequence,
    );
  });

  it('updates and removes markers with exact inverses', () => {
    const first = createMarker({ frame: 10, label: 'One' });
    const second = createMarker({ frame: 20, label: 'Two' });
    const sequence = makeSequence([makeTrack('video', 0)]);
    const withMarkers = applyCommand(sequence, {
      type: 'batch',
      label: 'Add markers',
      commands: [
        { type: 'marker.add', marker: first },
        { type: 'marker.add', marker: second },
      ],
    });

    const updated = applyCommand(withMarkers.sequence, {
      type: 'marker.update',
      markerId: first.id,
      patch: { frame: 12, label: 'One revised' },
    });
    expect(updated.sequence.markers[0]?.frame).toBe(12);
    if (!updated.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(updated.sequence, updated.inverse).sequence).toEqual(
      withMarkers.sequence,
    );

    const removed = applyCommand(withMarkers.sequence, {
      type: 'marker.remove',
      markerId: second.id,
    });
    if (!removed.inverse) {
      throw new Error('expected an inverse');
    }
    expect(applyCommand(removed.sequence, removed.inverse).sequence).toEqual(
      withMarkers.sequence,
    );
  });

  it('rejects duplicate and missing markers', () => {
    const marker = createMarker({ frame: 10 });
    const sequence = makeSequence([makeTrack('video', 0)]);
    const added = applyCommand(sequence, {
      type: 'marker.add',
      marker,
    });
    expectEngineError(
      () =>
        applyCommand(added.sequence, {
          type: 'marker.add',
          marker,
        }),
      'invalid-command',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'marker.remove',
          markerId: newId('marker'),
        }),
      'not-found',
    );
  });
});
