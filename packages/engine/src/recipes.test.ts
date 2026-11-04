import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  newId,
  STARTER_RECIPES,
  STARTER_BRAND_KITS,
} from '@kerf/model';
import { recipeCommand } from './recipes';
import { applyCommand } from './apply';
import {
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';
const kit = STARTER_BRAND_KITS[0]!;
const recipe = STARTER_RECIPES[0]!;
const asset = assetSchema.parse({
  id: newId('asset'),
  projectId: newId('project'),
  name: 'Demo',
  importedAt: 0,
  updatedAt: 0,
  sourcePath: '/tmp/demo.mp4',
  kind: 'video',
  status: 'ready',
  durationSeconds: 2,
  hasAudio: true,
});
describe('recipe draft', () => {
  it('appends linked audio and video without overrunning footage, and undoes atomically', () => {
    const track = makeTrack('video', 0);
    const original = makeSequence([
      withClips(track, [
        makeVideoClip({ trackId: track.id, durationFrames: 24 }),
      ]),
    ]);
    const sections = recipe.sections.map((text) => ({
      text,
      assetId: asset.id,
    }));
    const result = applyCommand(
      original,
      recipeCommand(original, [asset], recipe, kit, sections),
    );
    expect(result.sequence.tracks[0]).toEqual(original.tracks[0]);
    const videos = result.sequence.tracks
      .flatMap((t) => t.clips)
      .filter((c) => c.type === 'video' && c.assetId === asset.id);
    expect(videos).toHaveLength(4);
    expect(videos[0]!.startFrame).toBe(24);
    expect(videos[0]!.durationFrames).toBe(48);
    expect(
      result.sequence.tracks
        .flatMap((t) => t.clips)
        .filter((c) => c.type === 'audio'),
    ).toHaveLength(4);
    expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
      original,
    );
  });
  it('builds every starter recipe in either canvas orientation', () => {
    for (const r of STARTER_RECIPES)
      for (const width of [1920, 1080]) {
        const original = {
          ...makeSequence([]),
          width,
          height: width === 1920 ? 1080 : 1920,
        };
        const result = applyCommand(
          original,
          recipeCommand(
            original,
            [],
            r,
            kit,
            r.sections.map((text) => ({ text })),
          ),
        );
        expect(
          result.sequence.tracks
            .flatMap((t) => t.clips)
            .filter((c) => c.type === 'text'),
        ).toHaveLength(r.sections.length + 1);
        expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
          original,
        );
      }
  });
  it('rejects missing sources and invalid section content before applying', () => {
    const sequence = makeSequence([]);
    expect(() =>
      recipeCommand(
        sequence,
        [],
        recipe,
        kit,
        recipe.sections.map((text) => ({ text, assetId: asset.id })),
      ),
    ).toThrow('ready');
    expect(() => recipeCommand(sequence, [], recipe, kit, [])).toThrow(
      'every section',
    );
    expect(() =>
      recipeCommand(
        sequence,
        [],
        recipe,
        kit,
        recipe.sections.map(() => ({ text: '' })),
      ),
    ).toThrow('title');
  });
});
