import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  clipSchema,
  createAsset,
  createMarker,
  createProject,
  createTrack,
  newId,
  projectSchema,
  referenceProfileSchema,
  trackSchema,
} from '@kerf/model';
import { buildOtioTimeline } from './otio';

describe('OTIO export', () => {
  it('writes tracks, gaps, clips, media references and markers', () => {
    const base = createProject({ name: 'OTIO', now: 1 });
    const asset = assetSchema.parse({
      ...createAsset({
        projectId: base.id,
        name: 'shot.mp4',
        kind: 'video',
        sourcePath: '/media/shot.mp4',
        now: 2,
      }),
      status: 'ready',
      durationSeconds: 10,
      frameRate: { numerator: 24, denominator: 1 },
      hasVideo: true,
      hasAudio: true,
    });
    const track = createTrack({ kind: 'video', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame: 24,
      durationFrames: 48,
      type: 'video',
      assetId: asset.id,
      sourceInFrame: 12,
      label: 'Opening',
    });
    const sequence = {
      ...base.sequence,
      frameRate: { numerator: 24, denominator: 1 },
      markers: [createMarker({ frame: 12, label: 'Beat' })],
      tracks: [trackSchema.parse({ ...track, clips: [clip] })],
    };
    const project = projectSchema.parse({ ...base, sequence });

    const otio = buildOtioTimeline(project, [asset]);
    const tracks = otio.tracks as { children: Array<Record<string, unknown>> };
    const children = tracks.children[0]?.children as Array<
      Record<string, unknown>
    >;

    expect(otio.OTIO_SCHEMA).toBe('Timeline.1');
    expect(children[0]?.OTIO_SCHEMA).toBe('Gap.1');
    const clipEntry = children[1];
    if (!clipEntry) {
      throw new Error('expected a clip entry');
    }
    expect(clipEntry.OTIO_SCHEMA).toBe('Clip.1');
    expect(clipEntry.name).toBe('Opening');
    expect(
      (clipEntry.media_reference as Record<string, unknown>).target_url,
    ).toBe('file:///media/shot.mp4');
    expect(otio.markers).toHaveLength(1);

    const roundTrip = JSON.parse(JSON.stringify(otio));
    expect(roundTrip.tracks.children[0].children[1].metadata.kerf.type).toBe(
      'video',
    );
  });

  it('keeps reference media out of the exported timeline', () => {
    const base = createProject({ name: 'Reference export', now: 1 });
    const asset = assetSchema.parse({
      ...createAsset({
        projectId: base.id,
        name: 'shot.mp4',
        kind: 'video',
        sourcePath: '/media/shot.mp4',
        now: 2,
      }),
      status: 'ready',
      durationSeconds: 10,
      frameRate: { numerator: 24, denominator: 1 },
      hasVideo: true,
    });
    const referenceAsset = assetSchema.parse({
      ...createAsset({
        projectId: base.id,
        name: 'reference.mp4',
        kind: 'video',
        sourcePath: '/media/reference.mp4',
        now: 3,
      }),
      status: 'ready',
      durationSeconds: 6,
      frameRate: { numerator: 24, denominator: 1 },
      hasVideo: true,
    });
    const reference = referenceProfileSchema.parse({
      id: newId('reference'),
      name: 'Reference',
      sourceAssetId: referenceAsset.id,
      palette: ['#202020'],
      sceneCount: 6,
      averageShotLengthFrames: 24,
      cutsPerMinute: 50,
      analyzedAt: 4,
      createdAt: 4,
    });
    const track = createTrack({ kind: 'video', order: 0 });
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame: 0,
      durationFrames: 48,
      type: 'video',
      assetId: asset.id,
    });
    const sequence = {
      ...base.sequence,
      reference,
      tracks: [trackSchema.parse({ ...track, clips: [clip] })],
    };
    const project = projectSchema.parse({ ...base, sequence });

    const serialized = JSON.stringify(
      buildOtioTimeline(project, [asset, referenceAsset]),
    );
    expect(serialized).toContain('file:///media/shot.mp4');
    expect(serialized).not.toContain('file:///media/reference.mp4');
    expect(serialized).not.toContain(referenceAsset.id);
  });
});
