import { describe, expect, it } from 'vitest';
import { newId, sceneSchema } from '@kerf/model';
import type { Scene } from '@kerf/model';
import { descriptionCandidates } from './vision';

function scene(
  index: number,
  description: string | null,
  thumbnailPath: string | null = '/tmp/keyframe.jpg',
): Scene {
  return sceneSchema.parse({
    id: newId('scene'),
    assetId: newId('asset'),
    index,
    startFrame: index * 24,
    endFrame: (index + 1) * 24,
    thumbnailPath,
    description,
  });
}

describe('descriptionCandidates', () => {
  it('selects every scene with a keyframe for a full pass', () => {
    const scenes = [
      scene(0, 'A red field'),
      scene(1, null),
      scene(2, 'A blue field'),
    ];
    expect(descriptionCandidates(scenes).map((entry) => entry.index)).toEqual([
      0, 1, 2,
    ]);
  });

  it('selects only undescribed scenes for a missing pass', () => {
    const scenes = [scene(0, 'A red field'), scene(1, null), scene(2, '   ')];
    expect(
      descriptionCandidates(scenes, true).map((entry) => entry.index),
    ).toEqual([1, 2]);
  });

  it('ignores scenes without a keyframe', () => {
    const scenes = [scene(0, null, null), scene(1, null)];
    expect(
      descriptionCandidates(scenes, true).map((entry) => entry.index),
    ).toEqual([1]);
  });
});
