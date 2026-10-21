import { createMarker, sequenceSchema } from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { EngineError, isEngineError } from './errors';
import {
  intersectAllFrameRanges,
  intersectFrameRanges,
  frameRangeContains,
  frameRangeLength,
  frameRangesOverlap,
  normalizeFrameRange,
} from './ranges';
import { collectSnapCandidates, snapStart } from './snapping';
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

function snappingFixture() {
  const track = makeTrack('video', 0);
  const first = makeVideoClip({
    trackId: track.id,
    startFrame: 0,
    durationFrames: 10,
  });
  const second = makeVideoClip({
    trackId: track.id,
    startFrame: 30,
    durationFrames: 10,
  });
  const marker = createMarker({ frame: 25, label: 'Beat' });
  const base = makeSequence([withClips(track, [first, second])]);
  return {
    track,
    first,
    second,
    marker,
    sequence: sequenceSchema.parse({
      ...base,
      markers: [marker],
    }),
  };
}

describe('collectSnapCandidates', () => {
  it('collects clip edges, markers, playhead, grid and zero', () => {
    const { sequence, first, second } = snappingFixture();
    const candidates = collectSnapCandidates({
      sequence,
      playhead: 40,
      gridFrames: 5,
      range: { startFrame: 0, endFrame: 50 },
    });

    const sources = new Set(candidates.map((candidate) => candidate.source));
    expect(sources).toEqual(
      new Set(['zero', 'clip-start', 'clip-end', 'marker', 'playhead', 'grid']),
    );
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index]?.frame).toBeGreaterThanOrEqual(
        candidates[index - 1]?.frame ?? 0,
      );
    }
    expect(
      candidates.some(
        (candidate) =>
          candidate.source === 'clip-start' && candidate.id === first.id,
      ),
    ).toBe(true);
    expect(
      candidates.some(
        (candidate) =>
          candidate.source === 'clip-end' &&
          candidate.id === second.id &&
          candidate.frame === 40,
      ),
    ).toBe(true);
    expect(
      candidates.some(
        (candidate) => candidate.source === 'grid' && candidate.frame === 15,
      ),
    ).toBe(true);
  });

  it('filters candidates by range, track and dragged clip', () => {
    const { sequence, track, first } = snappingFixture();
    const ranged = collectSnapCandidates({
      sequence,
      includeGrid: false,
      range: { startFrame: 10, endFrame: 30 },
    });
    expect(
      ranged.map((candidate) => [candidate.source, candidate.frame]),
    ).toEqual([
      ['clip-end', 10],
      ['marker', 25],
    ]);

    const secondTrack = makeTrack('video', 1);
    const secondClip = makeVideoClip({
      trackId: secondTrack.id,
      startFrame: 12,
      durationFrames: 4,
    });
    const twoTracks = makeSequence([
      withClips(track, [first]),
      withClips(secondTrack, [secondClip]),
    ]);
    const filtered = collectSnapCandidates({
      sequence: twoTracks,
      trackId: secondTrack.id,
      includeZero: false,
      includeMarkers: false,
    });
    expect(filtered).toHaveLength(2);
    expect(
      filtered.every((candidate) => candidate.trackId === secondTrack.id),
    ).toBe(true);

    const ignored = collectSnapCandidates({
      sequence,
      ignoreClipId: first.id,
      includeZero: false,
      includeMarkers: false,
      includePlayhead: false,
      range: { startFrame: 0, endFrame: 15 },
    });
    expect(ignored).toEqual([]);
  });

  it('can disable every source and rejects a bad grid or playhead', () => {
    const { sequence } = snappingFixture();
    expect(
      collectSnapCandidates({
        sequence,
        includeClipEdges: false,
        includeMarkers: false,
        includePlayhead: false,
        includeZero: false,
        includeGrid: false,
      }),
    ).toEqual([]);

    expectEngineError(
      () =>
        collectSnapCandidates({
          sequence,
          gridFrames: 0,
          range: { startFrame: 0, endFrame: 10 },
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        collectSnapCandidates({
          sequence,
          playhead: Number.NaN,
          range: { startFrame: 0, endFrame: 10 },
        }),
      'invalid-range',
    );
  });
});

describe('snapStart', () => {
  it('snaps the incoming edge to a clip start inside the threshold', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 10,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const result = snapStart({
      sequence,
      startFrame: 7,
      durationFrames: 10,
      thresholdFrames: 4,
    });

    expect(result.startFrame).toBe(10);
    expect(result.deltaFrames).toBe(3);
    expect(result.edge).toBe('in');
    expect(result.candidate).toMatchObject({
      source: 'clip-start',
      frame: 10,
    });
  });

  it('snaps the outgoing edge without producing a negative start', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 12,
      durationFrames: 5,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const result = snapStart({
      sequence,
      startFrame: 0,
      durationFrames: 10,
      thresholdFrames: 3,
      includeZero: false,
    });

    expect(result.startFrame).toBe(2);
    expect(result.edge).toBe('out');
    expect(result.candidate?.frame).toBe(12);
  });

  it('leaves the start alone outside the threshold', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 12,
      durationFrames: 5,
    });
    const sequence = makeSequence([withClips(track, [clip])]);
    const result = snapStart({
      sequence,
      startFrame: 0,
      durationFrames: 10,
      thresholdFrames: 1,
      includeZero: false,
    });

    expect(result).toEqual({
      startFrame: 0,
      deltaFrames: 0,
      edge: null,
      candidate: null,
    });
  });

  it('prefers a marker when a clip edge sits on the same frame', () => {
    const track = makeTrack('video', 0);
    const clip = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 10,
    });
    const marker = createMarker({ frame: 10, label: 'Hit' });
    const base = makeSequence([withClips(track, [clip])]);
    const sequence = sequenceSchema.parse({ ...base, markers: [marker] });

    const result = snapStart({
      sequence,
      startFrame: 8,
      durationFrames: 4,
      thresholdFrames: 3,
      includeZero: false,
    });
    expect(result.startFrame).toBe(10);
    expect(result.edge).toBe('in');
    expect(result.candidate).toMatchObject({
      source: 'marker',
      frame: 10,
    });
  });

  it('prefers the incoming edge when two candidate distances tie', () => {
    const track = makeTrack('video', 0);
    const first = makeVideoClip({
      trackId: track.id,
      startFrame: 10,
      durationFrames: 10,
    });
    const second = makeVideoClip({
      trackId: track.id,
      startFrame: 14,
      durationFrames: 10,
    });
    const sequence = makeSequence([withClips(track, [first, second])]);

    const result = snapStart({
      sequence,
      startFrame: 8,
      durationFrames: 4,
      thresholdFrames: 2,
      includeZero: false,
    });
    expect(result.startFrame).toBe(10);
    expect(result.edge).toBe('in');
    expect(result.candidate?.frame).toBe(10);
  });

  it('snaps to grid lines, the playhead and zero', () => {
    const empty = makeSequence([]);
    const grid = snapStart({
      sequence: empty,
      startFrame: 13,
      durationFrames: 5,
      thresholdFrames: 3,
      gridFrames: 5,
      includeZero: false,
    });
    expect(grid).toMatchObject({
      startFrame: 15,
      edge: 'in',
      candidate: { source: 'grid', frame: 15 },
    });

    const playhead = snapStart({
      sequence: empty,
      startFrame: 18,
      durationFrames: 5,
      thresholdFrames: 3,
      playhead: 20,
      includeZero: false,
    });
    expect(playhead).toMatchObject({
      startFrame: 20,
      candidate: { source: 'playhead', frame: 20 },
    });

    const zero = snapStart({
      sequence: empty,
      startFrame: 2,
      durationFrames: 5,
      thresholdFrames: 2,
    });
    expect(zero).toMatchObject({
      startFrame: 0,
      edge: 'in',
      candidate: { source: 'zero', frame: 0 },
    });
  });

  it('skips a snap that would push the clip before frame zero', () => {
    const marker = createMarker({ frame: 6, label: 'Out only' });
    const sequence = sequenceSchema.parse({
      ...makeSequence([]),
      markers: [marker],
    });

    const result = snapStart({
      sequence,
      startFrame: 0,
      durationFrames: 10,
      thresholdFrames: 5,
      includeZero: false,
    });
    expect(result).toEqual({
      startFrame: 0,
      deltaFrames: 0,
      edge: null,
      candidate: null,
    });
  });

  it('rejects invalid durations and thresholds', () => {
    const empty = makeSequence([]);
    expectEngineError(
      () =>
        snapStart({
          sequence: empty,
          startFrame: 0,
          durationFrames: 0,
          thresholdFrames: 1,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        snapStart({
          sequence: empty,
          startFrame: 0,
          durationFrames: 10,
          thresholdFrames: -1,
        }),
      'invalid-range',
    );
    expectEngineError(
      () =>
        snapStart({
          sequence: empty,
          startFrame: Number.NaN,
          durationFrames: 10,
          thresholdFrames: 1,
        }),
      'invalid-range',
    );
  });
});

describe('frame range helpers', () => {
  it('normalizes and measures half-open ranges', () => {
    expect(normalizeFrameRange(20, 10)).toEqual({
      startFrame: 10,
      endFrame: 20,
    });
    expect(frameRangeLength({ startFrame: 10, endFrame: 20 })).toBe(10);
    expect(frameRangeContains({ startFrame: 10, endFrame: 20 }, 10)).toBe(true);
    expect(frameRangeContains({ startFrame: 10, endFrame: 20 }, 20)).toBe(
      false,
    );
    expect(frameRangeContains({ startFrame: 10, endFrame: 20 }, 25)).toBe(
      false,
    );
  });

  it('intersects ranges and treats touching edges as disjoint', () => {
    expect(
      intersectFrameRanges(
        { startFrame: 0, endFrame: 10 },
        { startFrame: 5, endFrame: 15 },
      ),
    ).toEqual({ startFrame: 5, endFrame: 10 });
    expect(
      intersectFrameRanges(
        { startFrame: 0, endFrame: 10 },
        { startFrame: 10, endFrame: 20 },
      ),
    ).toBeNull();
    expect(
      intersectFrameRanges(
        { startFrame: 0, endFrame: 5 },
        { startFrame: 10, endFrame: 20 },
      ),
    ).toBeNull();
    expect(
      frameRangesOverlap(
        { startFrame: 0, endFrame: 10 },
        { startFrame: 9, endFrame: 11 },
      ),
    ).toBe(true);
    expect(
      frameRangesOverlap(
        { startFrame: 0, endFrame: 10 },
        { startFrame: 10, endFrame: 20 },
      ),
    ).toBe(false);
  });

  it('intersects a list of ranges', () => {
    expect(
      intersectAllFrameRanges([
        { startFrame: 0, endFrame: 20 },
        { startFrame: 5, endFrame: 15 },
        { startFrame: 10, endFrame: 30 },
      ]),
    ).toEqual({ startFrame: 10, endFrame: 15 });
    expect(
      intersectAllFrameRanges([
        { startFrame: 0, endFrame: 10 },
        { startFrame: 20, endFrame: 30 },
      ]),
    ).toBeNull();
    expect(intersectAllFrameRanges([])).toBeNull();
  });
});
