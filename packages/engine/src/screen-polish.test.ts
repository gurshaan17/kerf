import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import { screenPolishCommand, suggestScreenPolish } from './screen-polish';
import {
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

function fixture() {
  const track = makeTrack('video', 0);
  const clip = makeVideoClip({
    trackId: track.id,
    startFrame: 15,
    durationFrames: 20,
  });
  return makeSequence([withClips(track, [clip])]);
}

describe('screen polish', () => {
  it('bounds suggestions to short sources and applies all presets reversibly', () => {
    for (const kind of ['zoom', 'spotlight', 'callout'] as const) {
      const sequence = fixture();
      const draft = suggestScreenPolish(sequence);
      expect(draft).toHaveLength(1);
      expect(draft[0]!.durationFrames).toBe(20);
      const result = applyCommand(
        sequence,
        screenPolishCommand(sequence, [{ ...draft[0]!, kind, text: 'Save' }]),
      );
      const overlays = result.sequence.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.type === 'fxOverlay');
      expect(overlays).toHaveLength(1);
      expect(overlays[0]!.props.kind).toBe(kind);
      expect(overlays[0]!.props.transitionInFrames).toBeLessThanOrEqual(10);
      expect(suggestScreenPolish(result.sequence)).toEqual([]);
      expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
        sequence,
      );
    }
  });
  it('rejects stale sources, invalid focus, out-of-bounds timing and locked effects', () => {
    const sequence = fixture();
    const focus = suggestScreenPolish(sequence)[0]!;
    for (const patch of [
      { clipId: 'missing' },
      { x: NaN },
      { y: 2 },
      { startFrame: 0 },
      { durationFrames: 21 },
    ]) {
      expect(() =>
        screenPolishCommand(sequence, [{ ...focus, ...patch }]),
      ).toThrow();
    }
    const effects = { ...makeTrack('effects', 1), locked: true };
    expect(() =>
      screenPolishCommand(
        { ...sequence, tracks: [...sequence.tracks, effects] },
        [focus],
      ),
    ).toThrow('Unlock');
    expect(() => screenPolishCommand(sequence, [])).toThrow('Choose');
  });
  it('does not suggest hidden or locked footage', () => {
    const sequence = fixture();
    for (const patch of [{ hidden: true }, { locked: true }]) {
      expect(
        suggestScreenPolish({
          ...sequence,
          tracks: sequence.tracks.map((t) => ({ ...t, ...patch })),
        }),
      ).toEqual([]);
    }
  });
});
