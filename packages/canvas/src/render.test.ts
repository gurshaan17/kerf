import { describe, expect, it } from 'vitest';
import {
  FRAME_RATES,
  clipSchema,
  createAsset,
  createProject,
  createSequence,
  createTrack,
  newId,
} from '@kerf/model';
import { clipAtFrame, mediaSourceSeconds } from './render';

function makeSequence() {
  const project = createProject({ name: 'Canvas test', now: 1 });
  const track = createTrack({ kind: 'video', order: 0 });
  const asset = {
    ...createAsset({
      projectId: project.id,
      name: 'Take.mp4',
      sourcePath: '/media/take.mp4',
      kind: 'video',
      now: 1,
    }),
    durationSeconds: 10,
    frameRate: FRAME_RATES.film,
  };
  const clip = clipSchema.parse({
    id: newId('clip'),
    type: 'video',
    trackId: track.id,
    assetId: asset.id,
    startFrame: 100,
    durationFrames: 48,
    sourceInFrame: 24,
    speed: 1,
    volume: 1,
    label: 'Take',
  });
  const sequence = createSequence({
    name: 'Test',
    tracks: [{ ...track, clips: [clip] }],
  });
  return { sequence, track, clip, asset };
}

describe('canvas compositor helpers', () => {
  it('resolve the active clip on a track', () => {
    const { sequence, track, clip } = makeSequence();

    expect(clipAtFrame(sequence, track.id, 100)?.id).toBe(clip.id);
    expect(clipAtFrame(sequence, track.id, 147)?.id).toBe(clip.id);
    expect(clipAtFrame(sequence, track.id, 99)).toBeNull();
    expect(clipAtFrame(sequence, track.id, 148)).toBeNull();
  });

  it('map a timeline frame to source seconds', () => {
    const { sequence, clip, asset } = makeSequence();

    expect(mediaSourceSeconds(clip, 100, asset, sequence)).toBeCloseTo(1);
    expect(mediaSourceSeconds(clip, 124, asset, sequence)).toBeCloseTo(2);
  });
});
