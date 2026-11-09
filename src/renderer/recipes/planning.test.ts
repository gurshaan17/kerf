import { describe, expect, it } from 'vitest';
import {
  assetSchema,
  newId,
  STARTER_BRAND_KITS,
  STARTER_RECIPES,
} from '@kerf/model';
import { applyCommand } from '@kerf/engine';
import {
  makeSequence,
  makeTrack,
  makeVideoClip,
  withClips,
} from '../../../packages/engine/src/test-fixtures';
import {
  distributeFootage,
  exampleSequence,
  initialScenes,
  planDraft,
} from './planning';
const recipe = STARTER_RECIPES.find((item) => item.id === 'quick-tip')!;
const kit = { ...STARTER_BRAND_KITS[0]!, intro: '', outro: '' };
const asset = assetSchema.parse({
  id: newId('asset'),
  projectId: newId('project'),
  name: 'Recording',
  kind: 'video',
  sourcePath: '/tmp/demo.mp4',
  status: 'ready',
  durationSeconds: 12,
  hasAudio: true,
  importedAt: 0,
  updatedAt: 0,
});
describe('Blueprint planning', () => {
  it('maps consecutive ranges and commits exactly the preview with atomic undo', () => {
    const track = makeTrack('video', 0);
    const sequence = makeSequence([
      withClips(track, [
        makeVideoClip({ trackId: track.id, durationFrames: 24 }),
      ]),
    ]);
    const before = structuredClone(sequence);
    const scenes = distributeFootage(initialScenes(recipe), asset, 9);
    expect(scenes.map((scene) => scene.sourceInSeconds)).toEqual([0, 3, 6]);
    const plan = planDraft(sequence, [asset], recipe, kit, scenes);
    expect(sequence).toEqual(before);
    expect(plan.offset).toBe(24);
    const result = applyCommand(sequence, plan.command);
    const added = result.sequence.tracks.filter((lane) => lane.id !== track.id);
    expect(
      added.map((lane) => ({
        ...lane,
        clips: lane.clips.map((clip) => ({
          ...clip,
          startFrame: clip.startFrame - plan.offset,
        })),
      })),
    ).toEqual(plan.preview.tracks);
    expect(
      added
        .flatMap((lane) => lane.clips)
        .filter((clip) => clip.type === 'video')
        .map((clip) => clip.sourceInFrame),
    ).toEqual([0, 72, 144]);
    expect(
      added
        .flatMap((lane) => lane.clips)
        .filter((clip) => clip.type === 'audio')
        .map((clip) => clip.sourceInFrame),
    ).toEqual([0, 72, 144]);
    expect(applyCommand(result.sequence, result.inverse!).sequence).toEqual(
      sequence,
    );
  });
  it('appends beyond an explicit sequence end without extending the preview', () => {
    const sequence = { ...makeSequence([]), durationFrames: 240 };
    const scenes = distributeFootage(initialScenes(recipe), asset, 6);
    const plan = planDraft(sequence, [asset], recipe, kit, scenes);
    expect(plan.offset).toBe(240);
    expect(plan.preview.durationFrames).toBe(0);
    expect(
      Math.min(
        ...plan.preview.tracks
          .flatMap((track) => track.clips)
          .map((clip) => clip.startFrame),
      ),
    ).toBe(0);
    expect(
      Math.min(
        ...applyCommand(sequence, plan.command)
          .sequence.tracks.flatMap((track) => track.clips)
          .map((clip) => clip.startFrame),
      ),
    ).toBe(240);
  });
  it('requires footage explicitly and rejects ranges beyond the source', () => {
    const sequence = makeSequence([]);
    const scenes = initialScenes(recipe);
    expect(() => planDraft(sequence, [], recipe, kit, scenes)).toThrow(
      'choose footage',
    );
    const mapped = distributeFootage(scenes, asset, 12);
    mapped[1] = { ...mapped[1]!, sourceInSeconds: 11, durationSeconds: 4 };
    expect(() => planDraft(sequence, [asset], recipe, kit, mapped)).toThrow(
      'exceeds',
    );
    mapped[1] = { ...mapped[1]!, sourceInSeconds: NaN };
    expect(() => planDraft(sequence, [asset], recipe, kit, mapped)).toThrow(
      'valid source range',
    );
  });
  it('allows deliberate title cards and keeps their durations independent', () => {
    const scenes = initialScenes(recipe);
    scenes[0] = { ...scenes[0]!, kind: 'title', durationSeconds: 2 };
    const mapped = distributeFootage(scenes, asset, 10);
    expect(mapped.map((scene) => scene.durationSeconds)).toEqual([2, 5, 5]);
    const plan = planDraft(makeSequence([]), [asset], recipe, kit, mapped);
    expect(
      plan.preview.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => clip.type === 'text'),
    ).toHaveLength(1);
  });
  it('restores saved scene structure without project media', () => {
    const saved = {
      ...recipe,
      sceneDefaults: recipe.sections.map(() => ({
        text: 'My wording',
        kind: 'title' as const,
        durationSeconds: 3,
        showTitle: true,
      })),
    };
    const scenes = initialScenes(saved);
    expect(scenes[0]).toMatchObject({
      text: 'My wording',
      kind: 'title',
      durationSeconds: 3,
    });
    expect(scenes[0]!.assetId).toBeUndefined();
  });
  it('builds playable illustrative examples in both orientations', () => {
    for (const id of ['product-demo', 'quick-tip', 'tutorial'])
      for (const width of [1920, 1080]) {
        const sequence = {
          ...makeSequence([]),
          width,
          height: width === 1920 ? 1080 : 1920,
        };
        const example = exampleSequence(
          sequence,
          STARTER_RECIPES.find((item) => item.id === id)!,
          kit,
        );
        expect(
          example.tracks
            .flatMap((track) => track.clips)
            .some((clip) => clip.type === 'shape'),
        ).toBe(true);
        expect(sequence.tracks).toHaveLength(0);
      }
  });
});
