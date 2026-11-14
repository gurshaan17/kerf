import { describe, expect, it } from 'vitest';
import { newId, clipSchema, createAsset, createProject } from '@kerf/model';
import { verifyTimeline } from './verification';
import type { ToolSnapshot } from './types';

function fixture(): ToolSnapshot {
  const project = createProject({ name: 'Verify', now: 1 });
  const asset = {
    ...createAsset({
      projectId: project.id,
      name: 'Video',
      sourcePath: '/video.mp4',
      kind: 'video',
      now: 1,
    }),
    durationSeconds: 1,
  };
  const track = project.sequence.tracks[0]!;
  const clip = clipSchema.parse({
    type: 'video',
    id: newId('clip'),
    assetId: asset.id,
    trackId: track.id,
    startFrame: 10,
    durationFrames: 100,
  });
  return {
    project: {
      ...project,
      sequence: { ...project.sequence, tracks: [{ ...track, clips: [clip] }] },
    },
    assets: [asset],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    compositions: [],
    referenceProfiles: [],
  };
}

describe('timeline verification', () => {
  it('reports source bounds and informational leading gaps', () => {
    const result = verifyTimeline(fixture());
    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'source-bounds', severity: 'error' }),
        expect.objectContaining({
          code: 'gap',
          severity: 'info',
          startFrame: 0,
          endFrame: 10,
        }),
      ]),
    );
  });
  it('reports missing references', () => {
    expect(
      verifyTimeline({ ...fixture(), assets: [] }).findings,
    ).toContainEqual(expect.objectContaining({ code: 'missing-asset' }));
  });
  it('allows intentional overlaps without treating them as invalid', () => {
    const snapshot = fixture();
    const track = snapshot.project.sequence.tracks[0]!;
    const clip = track.clips[0]!;
    const result = verifyTimeline({
      ...snapshot,
      assets: snapshot.assets.map((a) => ({ ...a, durationSeconds: 100 })),
      project: {
        ...snapshot.project,
        sequence: {
          ...snapshot.project.sequence,
          tracks: [{ ...track, clips: [clip, { ...clip, id: newId('clip') }] }],
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: 'overlap', severity: 'info' }),
    );
  });
});
