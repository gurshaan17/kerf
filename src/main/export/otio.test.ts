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
import type { Clip, Track } from '@kerf/model';
import { buildOtioTimeline } from './otio';

const OVERLAY_REGIONS = {
  blur: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  callout: { x: 0.3, y: 0.62, w: 0.4, h: 0.2 },
  spotlight: { x: 0.3, y: 0.25, w: 0.4, h: 0.5 },
  zoom: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
} as const;

function overlayClip(
  track: Track,
  startFrame: number,
  durationFrames: number,
  kind: 'blur' | 'callout' | 'spotlight' | 'zoom' = 'blur',
  linkedItemId: string | null = null,
): Clip {
  return clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    startFrame,
    durationFrames,
    type: 'fxOverlay',
    linkedItemId,
    props: { kind, region: OVERLAY_REGIONS[kind] },
  });
}

function effectsTimeline(tracks: readonly Track[]) {
  const base = createProject({ name: 'Overlay OTIO', now: 1 });
  const sequence = {
    ...base.sequence,
    frameRate: { numerator: 24, denominator: 1 },
    tracks: tracks.map((track) => trackSchema.parse(track)),
  };
  const project = projectSchema.parse({ ...base, sequence });
  return buildOtioTimeline(project, []);
}

function trackEntries(otio: ReturnType<typeof buildOtioTimeline>) {
  return (otio.tracks as { children: Array<Record<string, unknown>> }).children;
}

function kerfOf(entry: Record<string, unknown>) {
  return (entry.metadata as { kerf: Record<string, unknown> }).kerf;
}

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

  it('writes one effects lane with an explicit gap for a single overlay', () => {
    const effects = createTrack({ kind: 'effects', order: 0 });
    const sourceId = newId('clip');
    const overlay = overlayClip(effects, 24, 48, 'zoom', sourceId);
    const otio = effectsTimeline([
      trackSchema.parse({ ...effects, clips: [overlay] }),
    ]);

    const entries = trackEntries(otio);
    expect(entries).toHaveLength(1);
    const track = entries[0]!;
    expect(track.OTIO_SCHEMA).toBe('Track.1');
    expect(kerfOf(track)).toMatchObject({ id: effects.id, kind: 'effects' });

    const children = track.children as Array<Record<string, unknown>>;
    expect(children[0]?.OTIO_SCHEMA).toBe('Gap.1');
    expect(children[1]?.OTIO_SCHEMA).toBe('Clip.1');

    const clip = children[1]!;
    expect(clip.media_reference).toEqual({ OTIO_SCHEMA: 'MissingReference.1' });
    expect(kerfOf(clip)).toMatchObject({
      type: 'fxOverlay',
      linkedItemId: sourceId,
      effectsTrackId: effects.id,
      overlayKind: 'zoom',
      easing: 'ease-in-out',
      transitions: { inFrames: 0, outFrames: 0 },
    });
    expect(kerfOf(clip).props).toMatchObject({
      kind: 'zoom',
      region: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
    });
  });

  it('lane-packs overlapping overlays into separate tracks', () => {
    const effects = createTrack({ kind: 'effects', order: 0 });
    const first = overlayClip(effects, 0, 48, 'blur');
    const second = overlayClip(effects, 24, 48, 'spotlight');
    const otio = effectsTimeline([
      trackSchema.parse({ ...effects, clips: [first, second] }),
    ]);

    const entries = trackEntries(otio);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => kerfOf(entry).lane)).toEqual([1, 2]);
    expect(entries.map((entry) => kerfOf(entry).effectsTrackId)).toEqual([
      effects.id,
      effects.id,
    ]);
    expect(entries.map((entry) => entry.name)).toEqual([
      `${effects.name} · Lane 1`,
      `${effects.name} · Lane 2`,
    ]);
    expect(entries.map((entry) => kerfOf(entry).id)).toEqual([
      `${effects.id}:lane:1`,
      `${effects.id}:lane:2`,
    ]);
    for (const entry of entries) {
      const clips = (entry.children as Array<Record<string, unknown>>).filter(
        (child) => child.OTIO_SCHEMA === 'Clip.1',
      );
      expect(clips).toHaveLength(1);
    }
  });

  it('keeps non-overlapping overlays on a single effects track', () => {
    const effects = createTrack({ kind: 'effects', order: 0 });
    const first = overlayClip(effects, 0, 24);
    const second = overlayClip(effects, 24, 24);
    const otio = effectsTimeline([
      trackSchema.parse({ ...effects, clips: [first, second] }),
    ]);

    const entries = trackEntries(otio);
    expect(entries).toHaveLength(1);
    const clips = (
      entries[0]!.children as Array<Record<string, unknown>>
    ).filter((child) => child.OTIO_SCHEMA === 'Clip.1');
    expect(clips).toHaveLength(2);
  });

  it('does not let a trailing overlay extend the exported duration', () => {
    const video = createTrack({ kind: 'video', order: 0 });
    const effects = createTrack({ kind: 'effects', order: 1 });
    const source = clipSchema.parse({
      id: newId('clip'),
      trackId: video.id,
      startFrame: 0,
      durationFrames: 48,
      type: 'shape',
    });
    const trailing = overlayClip(effects, 200, 48);
    const otio = effectsTimeline([
      trackSchema.parse({ ...video, clips: [source] }),
      trackSchema.parse({ ...effects, clips: [trailing] }),
    ]);

    const metadata = otio.metadata as {
      kerf: { durationFrames: number };
    };
    expect(metadata.kerf.durationFrames).toBe(48);
    expect(trackEntries(otio)).toHaveLength(2);
  });

  it('round-trips overlay metadata through JSON', () => {
    const effects = createTrack({ kind: 'effects', order: 0 });
    const sourceId = newId('clip');
    const overlay = overlayClip(effects, 12, 36, 'callout', sourceId);
    const otio = effectsTimeline([
      trackSchema.parse({ ...effects, clips: [overlay] }),
    ]);

    const parsed = JSON.parse(JSON.stringify(otio)) as ReturnType<
      typeof buildOtioTimeline
    >;
    const clip = (
      trackEntries(parsed)[0]!.children as Array<Record<string, unknown>>
    )[1]!;
    expect(kerfOf(clip)).toMatchObject({
      type: 'fxOverlay',
      linkedItemId: sourceId,
      effectsTrackId: effects.id,
      overlayKind: 'callout',
    });
    expect(kerfOf(clip).props).toMatchObject({
      kind: 'callout',
      region: { x: 0.3, y: 0.62, w: 0.4, h: 0.2 },
      text: 'Callout',
    });
  });
});
