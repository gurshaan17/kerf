import type { EditCommand, FxOverlayClip, Sequence } from '@kerf/model';
import { maskSchema, newId } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import type { ApplyContext } from './apply';
import { ensureEffectsTrackCommands } from './effects-track';
import { EngineError, isEngineError } from './errors';
import {
  clipsAtFrame,
  sequenceDurationFrames,
  timelineDurationFrames,
} from './queries';
import { rippleDeleteCommand, rippleTrimCommand } from './ripple';
import {
  makeFxOverlayClip,
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

function trackClips(sequence: Sequence, trackId: string) {
  return sequence.tracks.find((track) => track.id === trackId)?.clips ?? [];
}

function overlayOn(
  sequence: Sequence,
  trackId: string,
  overlayId: string,
): FxOverlayClip {
  const clip = trackClips(sequence, trackId).find(
    (candidate) => candidate.id === overlayId,
  );
  if (!clip || clip.type !== 'fxOverlay') {
    throw new Error('expected an effect overlay');
  }
  return clip;
}

interface FixtureOptions {
  lockedEffects?: boolean;
  extraOverlay?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const videoTrack = makeTrack('video', 1);
  const effects = makeTrack('effects', 0);
  const effectsTrack = options.lockedEffects
    ? { ...effects, locked: true }
    : effects;
  const source = makeVideoClip({
    trackId: videoTrack.id,
    startFrame: 10,
    durationFrames: 40,
    sourceInFrame: 0,
    speed: 1,
  });
  const overlay = makeFxOverlayClip({
    trackId: effectsTrack.id,
    startFrame: 10,
    durationFrames: 40,
    linkedItemId: source.id,
  });
  const extraOverlay = options.extraOverlay
    ? makeFxOverlayClip({
        trackId: effectsTrack.id,
        startFrame: 0,
        durationFrames: 5,
      })
    : undefined;
  const overlays = extraOverlay ? [extraOverlay, overlay] : [overlay];
  const sequence = makeSequence([
    withClips(effectsTrack, overlays),
    withClips(videoTrack, [source]),
  ]);
  return {
    videoTrack,
    effectsTrack,
    source,
    overlay,
    extraOverlay,
    sequence,
  };
}

function undo(result: { sequence: Sequence; inverse: EditCommand | null }) {
  if (!result.inverse) {
    throw new Error('expected an inverse');
  }
  return applyCommand(result.sequence, result.inverse);
}

describe('effects track rules', () => {
  it('allows overlapping overlays on an effects track', () => {
    const { sequence, effectsTrack, source, overlay } = fixture();
    const second = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 20,
      durationFrames: 20,
      linkedItemId: source.id,
    });

    const result = applyCommand(sequence, {
      type: 'clip.insert',
      clip: second,
    });
    expect(trackClips(result.sequence, effectsTrack.id)).toHaveLength(2);
    expect(
      clipsAtFrame(
        result.sequence.tracks.find((track) => track.id === effectsTrack.id) ??
          effectsTrack,
        25,
      ).map((clip) => clip.id),
    ).toEqual([overlay.id, second.id]);
  });

  it('keeps fxOverlay clips off every other track kind', () => {
    const { sequence, videoTrack, source } = fixture();
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.insert',
          clip: makeFxOverlayClip({
            trackId: videoTrack.id,
            startFrame: 80,
            durationFrames: 10,
            linkedItemId: source.id,
          }),
        }),
      'incompatible-track',
    );
  });

  it('rejects masks and visual effects on an overlay', () => {
    const { sequence, overlay } = fixture();
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.addEffect',
          clipId: overlay.id,
          effect: {
            id: newId('effect'),
            type: 'blur',
            enabled: true,
            amount: 2,
          },
        }),
      'invalid-command',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.addMask',
          clipId: overlay.id,
          mask: maskSchema.parse({ id: newId('mask'), type: 'ellipse' }),
        }),
      'invalid-command',
    );
  });
});

describe('linked overlay follow', () => {
  it('shifts linked overlays when the source moves', () => {
    const { sequence, effectsTrack, source, overlay } = fixture();

    const result = applyCommand(sequence, {
      type: 'clip.move',
      clipId: source.id,
      startFrame: 22,
    });
    expect(
      overlayOn(result.sequence, effectsTrack.id, overlay.id).startFrame,
    ).toBe(22);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('shifts linked overlays for a cross-track move and restores the index', () => {
    const videoTrack = makeTrack('video', 1);
    const target = makeTrack('video', 2);
    const effectsTrack = makeTrack('effects', 0);
    const other = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 10,
    });
    const source = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 10,
      durationFrames: 20,
    });
    const overlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 10,
      durationFrames: 20,
      linkedItemId: source.id,
    });
    const sequence = makeSequence([
      withClips(effectsTrack, [overlay]),
      withClips(videoTrack, [other, source]),
      target,
    ]);

    const result = applyCommand(sequence, {
      type: 'clip.move',
      clipId: source.id,
      trackId: target.id,
      startFrame: 0,
    });
    expect(
      overlayOn(result.sequence, effectsTrack.id, overlay.id).startFrame,
    ).toBe(0);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('does not move overlays for trim, slip, speed, time map or keyframes', () => {
    const { sequence, effectsTrack, source, overlay } = fixture();
    const context: ApplyContext = {
      sourceDurationFrames: () => 1000,
    };
    const commands: EditCommand[] = [
      {
        type: 'clip.trim',
        clipId: source.id,
        edge: 'out',
        frames: -5,
      },
      { type: 'clip.slip', clipId: source.id, deltaFrames: 5 },
      { type: 'clip.setSpeed', clipId: source.id, speed: 2 },
      {
        type: 'clip.setTimeMap',
        clipId: source.id,
        points: [
          { frame: 0, sourceFrame: 0 },
          { frame: 40, sourceFrame: 80 },
        ],
      },
      {
        type: 'clip.setKeyframes',
        clipId: source.id,
        property: 'opacity',
        keyframes: [{ frame: 0, value: 0, easing: 'linear' }],
      },
    ];

    for (const command of commands) {
      const result = applyCommand(sequence, command, context);
      expect(
        overlayOn(result.sequence, effectsTrack.id, overlay.id).startFrame,
      ).toBe(10);
      expect(undo(result).sequence).toEqual(sequence);
    }
  });

  it('removes linked overlays with the source and restores both', () => {
    const { sequence, effectsTrack, source, overlay, extraOverlay } = fixture({
      extraOverlay: true,
    });
    if (!extraOverlay) {
      throw new Error('expected an extra overlay');
    }

    const result = applyCommand(sequence, {
      type: 'clip.remove',
      clipId: source.id,
    });
    expect(
      trackClips(result.sequence, effectsTrack.id).map((clip) => clip.id),
    ).toEqual([extraOverlay.id]);
    expect(
      trackClips(result.sequence, effectsTrack.id).some(
        (clip) => clip.id === overlay.id,
      ),
    ).toBe(false);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('clones linked overlays with a duplicated clip', () => {
    const { sequence, videoTrack, effectsTrack, source, overlay } = fixture();

    const result = applyCommand(sequence, {
      type: 'clip.duplicate',
      clipId: source.id,
      offsetFrames: 50,
    });
    const duplicate = trackClips(result.sequence, videoTrack.id).find(
      (clip) => clip.id !== source.id,
    );
    if (!duplicate) {
      throw new Error('expected a duplicate');
    }
    const clones = trackClips(result.sequence, effectsTrack.id).filter(
      (clip) => clip.type === 'fxOverlay' && clip.linkedItemId === duplicate.id,
    );
    expect(clones).toHaveLength(1);
    expect(clones[0]?.id).not.toBe(overlay.id);
    expect(clones[0]?.startFrame).toBe(60);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('keeps the same link when duplicating an overlay', () => {
    const { sequence, effectsTrack, source, overlay } = fixture();

    const result = applyCommand(sequence, {
      type: 'clip.duplicate',
      clipId: overlay.id,
      offsetFrames: 80,
    });
    const duplicate = trackClips(result.sequence, effectsTrack.id).find(
      (clip) => clip.id !== overlay.id,
    );
    if (!duplicate || duplicate.type !== 'fxOverlay') {
      throw new Error('expected a duplicated overlay');
    }
    expect(duplicate.linkedItemId).toBe(source.id);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('relinks right-half overlays on split and restores them on undo', () => {
    const videoTrack = makeTrack('video', 1);
    const effectsTrack = makeTrack('effects', 0);
    const source = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 40,
    });
    const leftOverlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 20,
      linkedItemId: source.id,
    });
    const spanning = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 15,
      durationFrames: 10,
      linkedItemId: source.id,
    });
    const rightOverlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 24,
      durationFrames: 12,
      linkedItemId: source.id,
    });
    const sequence = makeSequence([
      withClips(effectsTrack, [leftOverlay, spanning, rightOverlay]),
      withClips(videoTrack, [source]),
    ]);

    const result = applyCommand(sequence, {
      type: 'clip.split',
      clipId: source.id,
      frame: 20,
    });
    const right = trackClips(result.sequence, videoTrack.id).find(
      (clip) => clip.id !== source.id,
    );
    if (!right) {
      throw new Error('expected a right half');
    }
    expect(
      overlayOn(result.sequence, effectsTrack.id, leftOverlay.id).linkedItemId,
    ).toBe(source.id);
    expect(
      overlayOn(result.sequence, effectsTrack.id, spanning.id).linkedItemId,
    ).toBe(source.id);
    expect(
      overlayOn(result.sequence, effectsTrack.id, rightOverlay.id).linkedItemId,
    ).toBe(right.id);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('relinks overlays on a locked effects track and undoes around the lock', () => {
    const videoTrack = makeTrack('video', 1);
    const effects = makeTrack('effects', 0);
    const effectsTrack = { ...effects, locked: true };
    const source = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 40,
    });
    const overlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 24,
      durationFrames: 12,
      linkedItemId: source.id,
    });
    const sequence = makeSequence([
      withClips(effectsTrack, [overlay]),
      withClips(videoTrack, [source]),
    ]);

    const result = applyCommand(sequence, {
      type: 'clip.split',
      clipId: source.id,
      frame: 20,
    });
    const right = trackClips(result.sequence, videoTrack.id).find(
      (clip) => clip.id !== source.id,
    );
    if (!right) {
      throw new Error('expected a right half');
    }
    expect(
      overlayOn(result.sequence, effectsTrack.id, overlay.id).linkedItemId,
    ).toBe(right.id);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('removes linked overlays with their track and restores both', () => {
    const { sequence, videoTrack, effectsTrack, overlay } = fixture();

    const result = applyCommand(sequence, {
      type: 'track.remove',
      trackId: videoTrack.id,
    });
    expect(
      trackClips(result.sequence, effectsTrack.id).some(
        (clip) => clip.id === overlay.id,
      ),
    ).toBe(false);
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('removes linked overlays from a locked effects track on track removal', () => {
    const locked = fixture({ lockedEffects: true });

    const result = applyCommand(locked.sequence, {
      type: 'track.remove',
      trackId: locked.videoTrack.id,
    });
    expect(
      trackClips(result.sequence, locked.effectsTrack.id).some(
        (clip) => clip.id === locked.overlay.id,
      ),
    ).toBe(false);
    expect(undo(result).sequence).toEqual(locked.sequence);
  });

  it('follows source edits on a locked effects track', () => {
    const { sequence, effectsTrack, source, overlay } = fixture({
      lockedEffects: true,
    });

    const moved = applyCommand(sequence, {
      type: 'clip.move',
      clipId: source.id,
      startFrame: 20,
    });
    expect(
      overlayOn(moved.sequence, effectsTrack.id, overlay.id).startFrame,
    ).toBe(20);
    expect(
      moved.sequence.tracks.find((track) => track.id === effectsTrack.id)
        ?.locked,
    ).toBe(true);

    const removed = applyCommand(moved.sequence, {
      type: 'clip.remove',
      clipId: source.id,
    });
    expect(trackClips(removed.sequence, effectsTrack.id)).toHaveLength(0);
    expect(undo(removed).sequence).toEqual(moved.sequence);
  });

  it('still blocks direct overlay edits on a locked effects track', () => {
    const { sequence, overlay } = fixture({ lockedEffects: true });

    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.move',
          clipId: overlay.id,
          startFrame: 30,
        }),
      'locked',
    );
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.trim',
          clipId: overlay.id,
          edge: 'out',
          frames: -5,
        }),
      'locked',
    );
  });
});

describe('ripple with linked overlays', () => {
  function rippleFixture() {
    const videoTrack = makeTrack('video', 1);
    const effectsTrack = makeTrack('effects', 0);
    const first = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 20,
    });
    const second = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 20,
      durationFrames: 20,
    });
    const firstOverlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 20,
      linkedItemId: first.id,
    });
    const secondOverlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 20,
      durationFrames: 20,
      linkedItemId: second.id,
    });
    const sequence = makeSequence([
      withClips(effectsTrack, [firstOverlay, secondOverlay]),
      withClips(videoTrack, [first, second]),
    ]);
    return {
      videoTrack,
      effectsTrack,
      first,
      second,
      firstOverlay,
      secondOverlay,
      sequence,
    };
  }

  it('moves later overlays with a ripple trim', () => {
    const fixtureValue = rippleFixture();
    const result = applyCommand(
      fixtureValue.sequence,
      rippleTrimCommand(
        fixtureValue.sequence,
        fixtureValue.first.id,
        'out',
        -5,
      ),
    );

    expect(
      overlayOn(
        result.sequence,
        fixtureValue.effectsTrack.id,
        fixtureValue.firstOverlay.id,
      ).startFrame,
    ).toBe(0);
    expect(
      overlayOn(
        result.sequence,
        fixtureValue.effectsTrack.id,
        fixtureValue.secondOverlay.id,
      ).startFrame,
    ).toBe(15);
    expect(undo(result).sequence).toEqual(fixtureValue.sequence);
  });

  it('removes a deleted clip and its overlay, then closes the gap', () => {
    const fixtureValue = rippleFixture();
    const result = applyCommand(
      fixtureValue.sequence,
      rippleDeleteCommand(fixtureValue.sequence, fixtureValue.first.id),
    );

    expect(
      trackClips(result.sequence, fixtureValue.effectsTrack.id).some(
        (clip) => clip.id === fixtureValue.firstOverlay.id,
      ),
    ).toBe(false);
    expect(
      overlayOn(
        result.sequence,
        fixtureValue.effectsTrack.id,
        fixtureValue.secondOverlay.id,
      ).startFrame,
    ).toBe(0);
    expect(undo(result).sequence).toEqual(fixtureValue.sequence);
  });
});

describe('overlay editing', () => {
  it('creates the effects track and first overlay in one undo step', () => {
    const videoTrack = makeTrack('video', 0);
    const source = makeVideoClip({
      trackId: videoTrack.id,
      startFrame: 0,
      durationFrames: 40,
    });
    const sequence = makeSequence([withClips(videoTrack, [source])]);
    const ensure = ensureEffectsTrackCommands(sequence);
    expect(ensure.created).toBe(true);
    expect(ensure.commands.length).toBe(2);

    const overlay = makeFxOverlayClip({
      trackId: ensure.trackId,
      startFrame: 0,
      durationFrames: 40,
      linkedItemId: source.id,
    });
    const result = applyCommand(sequence, {
      type: 'batch',
      label: 'Add overlay',
      commands: [...ensure.commands, { type: 'clip.insert', clip: overlay }],
    });

    const effectsTrack = result.sequence.tracks[0];
    expect(effectsTrack?.id).toBe(ensure.trackId);
    expect(effectsTrack?.kind).toBe('effects');
    expect(effectsTrack?.order).toBe(0);
    expect(result.sequence.tracks[1]?.order).toBe(1);
    expect(trackClips(result.sequence, ensure.trackId)).toHaveLength(1);
    expect(undo(result).sequence).toEqual(sequence);

    const again = ensureEffectsTrackCommands(result.sequence);
    expect(again.created).toBe(false);
    expect(again.trackId).toBe(ensure.trackId);
    expect(again.commands).toEqual([]);
  });

  it('deep-merges props and preserves the overlay kind', () => {
    const { sequence, effectsTrack, overlay } = fixture();

    const result = applyCommand(sequence, {
      type: 'clip.update',
      clipId: overlay.id,
      patch: {
        props: {
          region: { x: 0.3 },
          amount: 40,
          easing: 'linear',
        },
      },
    });
    const updated = overlayOn(result.sequence, effectsTrack.id, overlay.id);
    if (updated.props.kind !== 'blur') {
      throw new Error('expected a blur overlay');
    }
    expect(updated.props.region).toEqual({
      x: 0.3,
      y: 0.1,
      w: 0.4,
      h: 0.4,
    });
    expect(updated.props.amount).toBe(40);
    expect(updated.props.easing).toBe('linear');
    expect(undo(result).sequence).toEqual(sequence);
  });

  it('rejects a props kind change', () => {
    const { sequence, overlay } = fixture();
    expectEngineError(
      () =>
        applyCommand(sequence, {
          type: 'clip.update',
          clipId: overlay.id,
          patch: { props: { kind: 'zoom', zoom: 3 } },
        }),
      'invalid-command',
    );
  });

  it('clamps transitions on insert, update and trim', () => {
    const effectsTrack = makeTrack('effects', 0);
    const sequence = makeSequence([effectsTrack]);
    const overlay = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 0,
      durationFrames: 10,
      props: { transitionInFrames: 20, transitionOutFrames: 20 },
    });

    const inserted = applyCommand(sequence, {
      type: 'clip.insert',
      clip: overlay,
    });
    const stored = overlayOn(inserted.sequence, effectsTrack.id, overlay.id);
    expect(stored.props.transitionInFrames).toBe(5);
    expect(stored.props.transitionOutFrames).toBe(5);

    const updated = applyCommand(inserted.sequence, {
      type: 'clip.update',
      clipId: overlay.id,
      patch: { durationFrames: 6 },
    });
    const clamped = overlayOn(updated.sequence, effectsTrack.id, overlay.id);
    expect(clamped.props.transitionInFrames).toBe(3);
    expect(clamped.props.transitionOutFrames).toBe(3);
    expect(undo(updated).sequence).toEqual(inserted.sequence);

    const trimmed = applyCommand(inserted.sequence, {
      type: 'clip.trim',
      clipId: overlay.id,
      edge: 'out',
      frames: -4,
    });
    const trimmedOverlay = overlayOn(
      trimmed.sequence,
      effectsTrack.id,
      overlay.id,
    );
    expect(trimmedOverlay.durationFrames).toBe(6);
    expect(trimmedOverlay.props.transitionInFrames).toBe(3);
    expect(trimmedOverlay.props.transitionOutFrames).toBe(3);
    expect(undo(trimmed).sequence).toEqual(inserted.sequence);
  });
});

describe('overlay duration queries', () => {
  it('excludes trailing overlays from export duration but not timeline extent', () => {
    const { sequence, effectsTrack, overlay } = fixture();

    const trailing = makeFxOverlayClip({
      trackId: effectsTrack.id,
      startFrame: 100,
      durationFrames: 50,
    });
    const result = applyCommand(sequence, {
      type: 'clip.insert',
      clip: trailing,
    });

    expect(sequenceDurationFrames(result.sequence)).toBe(50);
    expect(timelineDurationFrames(result.sequence)).toBe(150);
    expect(
      overlayOn(result.sequence, effectsTrack.id, overlay.id).startFrame,
    ).toBe(10);
  });
});
