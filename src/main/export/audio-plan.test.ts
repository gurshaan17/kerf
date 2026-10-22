import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  clipSchema,
  createAsset,
  createSequence,
  createTrack,
  newId,
  trackSchema,
} from '@kerf/model';
import { buildExportAudioPlan } from './audio-plan';

function mediaAsset(overrides: Record<string, unknown> = {}) {
  return assetSchema.parse({
    ...createAsset({
      projectId: newId('project'),
      name: 'clip.mp4',
      kind: 'video',
      sourcePath: '/media/clip.mp4',
      now: 1,
    }),
    status: 'ready',
    durationSeconds: 20,
    frameRate: { numerator: 24, denominator: 1 },
    hasVideo: true,
    hasAudio: true,
    ...overrides,
  });
}

describe('export audio plan', () => {
  it('trims clips to the export window and preserves fades and volume', () => {
    const asset = mediaAsset();
    const track = createTrack({ kind: 'video', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame: 48,
      durationFrames: 48,
      type: 'video',
      assetId: asset.id,
      sourceInFrame: 24,
      volume: 0.5,
      fade: { inFrames: 12, outFrames: 6 },
    });
    const sequence = createSequence({
      name: 'Audio',
      frameRate: { numerator: 24, denominator: 1 },
      tracks: [trackSchema.parse({ ...track, clips: [clip] })],
    });

    const plan = buildExportAudioPlan(sequence, [asset], 60, 96);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({
      path: '/media/clip.mp4',
      sourceStartSeconds: 36 / 24,
      delaySeconds: 0,
      timelineDurationSeconds: 36 / 24,
      speed: 1,
      reversed: false,
      volume: 0.5,
      fadeInSeconds: 0,
      fadeOutSeconds: 6 / 24,
    });
  });

  it('skips muted tracks and clips without audio', () => {
    const silent = mediaAsset({ hasAudio: false });
    const track = createTrack({ kind: 'audio', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame: 0,
      durationFrames: 24,
      type: 'audio',
      assetId: silent.id,
    });
    const sequence = createSequence({
      name: 'Silent',
      tracks: [
        trackSchema.parse({ ...track, clips: [clip] }),
        trackSchema.parse({
          ...createTrack({ kind: 'audio', order: 1 }),
          muted: true,
          clips: [{ ...clip, id: newId('clip') }],
        }),
      ],
    });

    expect(buildExportAudioPlan(sequence, [silent], 0, 24)).toEqual([]);
  });

  it('maps a speed ramp to an average tempo change', () => {
    const asset = mediaAsset();
    const track = createTrack({ kind: 'audio', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame: 24,
      durationFrames: 24,
      type: 'audio',
      assetId: asset.id,
      sourceInFrame: 0,
      speed: 2,
    });
    const sequence = createSequence({
      name: 'Speed',
      frameRate: { numerator: 24, denominator: 1 },
      tracks: [trackSchema.parse({ ...track, clips: [clip] })],
    });

    const plan = buildExportAudioPlan(sequence, [asset], 24, 48);
    expect(plan[0]).toMatchObject({
      sourceStartSeconds: 0,
      sourceDurationSeconds: 2,
      timelineDurationSeconds: 1,
      speed: 2,
    });
  });
});
