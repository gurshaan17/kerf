import { describe, expect, it } from 'vitest';
import type { BeatMap, MediaClip, Sequence } from '@kerf/model';
import {
  clipSchema,
  createSequence,
  createTrack,
  newId,
  trackSchema,
} from '@kerf/model';
import { applyCommand } from '@kerf/engine';
import {
  buildBeatMarkerCommands,
  buildBeatSplitCommands,
  planBeatEdits,
} from './beat-commands';

function audioClip(
  assetId: MediaClip['assetId'],
  input: {
    readonly startFrame?: number;
    readonly durationFrames?: number;
    readonly sourceInFrame?: number;
    readonly speed?: number;
  } = {},
): MediaClip {
  return clipSchema.parse({
    id: newId('clip'),
    trackId: newId('track'),
    startFrame: input.startFrame ?? 0,
    durationFrames: input.durationFrames ?? 240,
    type: 'audio',
    assetId,
    sourceInFrame: input.sourceInFrame ?? 0,
    speed: input.speed ?? 1,
  }) as MediaClip;
}

function sequenceWith(clip: MediaClip): Sequence {
  const track = createTrack({ kind: 'audio', order: 0 });
  const withClip = trackSchema.parse({
    ...track,
    clips: [{ ...clip, trackId: track.id }],
  });
  return createSequence({
    name: 'Beat test',
    frameRate: { numerator: 24, denominator: 1 },
    tracks: [withClip],
  });
}

function beatMap(
  assetId: BeatMap['assetId'],
  frames: readonly number[],
): BeatMap {
  return {
    id: newId('beatmap'),
    assetId,
    bpm: 120,
    offsetFrames: 0,
    beats: frames.map((frame) => ({
      id: newId('beat'),
      frame,
      strength: 0.8,
    })),
    sections: [],
    createdAt: 1,
  };
}

describe('beat edit planning', () => {
  it('maps beats into sequence frames and splits in descending order', () => {
    const assetId = newId('asset');
    const clip = audioClip(assetId);
    const sequence = sequenceWith(clip);
    const map = beatMap(assetId, [0, 12, 24, 36, 48]);

    const plan = planBeatEdits(sequence, map, 'dense');
    expect(plan.markerFrames.map((marker) => marker.frame)).toEqual([
      0, 12, 24, 36, 48,
    ]);
    expect(plan.cutCount).toBe(4);
    expect(plan.segmentCount).toBe(5);

    const split = plan.splits[0];
    expect(split?.frames).toEqual([48, 36, 24, 12]);

    const commands = buildBeatSplitCommands(plan);
    const applied = applyCommand(sequence, {
      type: 'batch',
      commands,
    }).sequence;
    const clips = applied.tracks[0]?.clips ?? [];
    expect(clips.map((entry) => entry.startFrame)).toEqual([0, 12, 24, 36, 48]);
    expect(clips.map((entry) => entry.durationFrames)).toEqual([
      12, 12, 12, 12, 192,
    ]);
  });

  it('honours density while keeping marker labels on the beat grid', () => {
    const assetId = newId('asset');
    const sequence = sequenceWith(audioClip(assetId));
    const map = beatMap(assetId, [0, 12, 24, 36, 48, 60, 72, 84]);

    const plan = planBeatEdits(sequence, map, 'sparse');
    expect(plan.markerFrames.map((marker) => marker.frame)).toEqual([0, 48]);
    expect(plan.markerFrames.map((marker) => marker.beatIndex)).toEqual([0, 4]);
    expect(plan.cutCount).toBe(1);

    const markers = buildBeatMarkerCommands(sequence, plan);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({
      type: 'marker.add',
      marker: { frame: 0, label: 'B1', kind: 'beat' },
    });
    expect(markers[1]).toMatchObject({
      type: 'marker.add',
      marker: { frame: 48, label: 'B5', kind: 'beat' },
    });
  });

  it('maps sped-up clips and skips locked clips for cuts', () => {
    const assetId = newId('asset');
    const clip = audioClip(assetId, {
      startFrame: 10,
      durationFrames: 60,
      sourceInFrame: 100,
      speed: 2,
    });
    const sequence = sequenceWith(clip);
    const map = beatMap(assetId, [100, 112, 124, 136, 148]);

    const plan = planBeatEdits(sequence, map, 'dense');
    expect(plan.markerFrames.map((marker) => marker.frame)).toEqual([
      10, 16, 22, 28, 34,
    ]);
    expect(plan.cutCount).toBe(4);

    const locked = sequenceWith({
      ...clip,
      id: newId('clip'),
      locked: true,
    });
    const lockedPlan = planBeatEdits(locked, map, 'dense');
    expect(lockedPlan.cutCount).toBe(0);
    expect(lockedPlan.lockedClipCount).toBe(1);
    expect(lockedPlan.markerFrames).toHaveLength(5);
  });

  it('does not add markers that already exist', () => {
    const assetId = newId('asset');
    const base = sequenceWith(audioClip(assetId));
    const map = beatMap(assetId, [0, 12, 24, 36]);
    const plan = planBeatEdits(base, map, 'dense');

    const withMarkers = applyCommand(base, {
      type: 'batch',
      commands: buildBeatMarkerCommands(base, plan),
    }).sequence;
    const repeated = planBeatEdits(withMarkers, map, 'dense');
    expect(repeated.newMarkerCount).toBe(0);
    expect(buildBeatMarkerCommands(withMarkers, repeated)).toHaveLength(0);
  });
});
