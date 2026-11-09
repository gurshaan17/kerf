import type { Asset, BrandKit, Recipe, Sequence } from '@kerf/model';
import { clipSchema, createTrack, newId } from '@kerf/model';
import {
  applyCommand,
  recipeCommand,
  sequenceDurationFrames,
  timelineDurationFrames,
} from '@kerf/engine';
import type { RecipeSectionInput } from '@kerf/engine';

export interface DraftScene extends RecipeSectionInput {
  id: string;
  role: string;
  kind: 'footage' | 'title';
  durationSeconds: number;
  sourceInSeconds: number;
}

export function initialScenes(recipe: Recipe): DraftScene[] {
  return recipe.sections.map((role, index) => ({
    id: crypto.randomUUID(),
    role,
    text: role,
    kind: 'footage',
    durationSeconds: recipe.secondsPerSection,
    sourceInSeconds: 0,
    showTitle: false,
    ...recipe.sceneDefaults?.[index],
  }));
}

/** Assign consecutive, non-overlapping ranges. Never claim these are semantic scene matches. */
export function distributeFootage(
  scenes: readonly DraftScene[],
  asset: Asset,
  targetSeconds: number,
): DraftScene[] {
  const footage = scenes.filter((scene) => scene.kind === 'footage');
  const available =
    asset.kind === 'video'
      ? Math.min(asset.durationSeconds, targetSeconds)
      : targetSeconds;
  const weight = footage.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  let cursor = 0;
  return scenes.map((scene) => {
    if (scene.kind === 'title') return scene;
    const seconds =
      weight > 0
        ? (available * scene.durationSeconds) / weight
        : available / Math.max(1, footage.length);
    const result = {
      ...scene,
      assetId: asset.id,
      sourceInSeconds: asset.kind === 'video' ? cursor : 0,
      durationSeconds: seconds,
    };
    cursor += seconds;
    return result;
  });
}

export function planDraft(
  sequence: Sequence,
  assets: readonly Asset[],
  recipe: Recipe,
  kit: BrandKit,
  scenes: readonly DraftScene[],
  logo?: string,
) {
  if (!scenes.length) throw new Error('Add at least one scene.');
  for (const [index, scene] of scenes.entries()) {
    if (!scene.role.trim())
      throw new Error(`Scene ${index + 1}: add a scene purpose.`);
    if ((scene.kind === 'title' || scene.showTitle) && !scene.text.trim())
      throw new Error(
        `Scene ${index + 1}: add on-screen text or turn off its title.`,
      );
    if (
      !Number.isFinite(scene.durationSeconds) ||
      scene.durationSeconds <= 0 ||
      scene.durationSeconds > 600
    )
      throw new Error(
        `Scene ${index + 1}: choose a duration between one frame and 600 seconds.`,
      );
    if (scene.kind === 'footage' && !scene.assetId)
      throw new Error(
        `Scene ${index + 1}: choose footage or change it to a title card.`,
      );
  }
  const command = recipeCommand(
    sequence,
    assets,
    { ...recipe, sections: scenes.map((scene) => scene.role) },
    kit,
    scenes.map((scene) => ({
      ...scene,
      text:
        scene.kind === 'footage' && !scene.showTitle ? scene.role : scene.text,
      assetId: scene.kind === 'title' ? undefined : scene.assetId,
    })),
    logo,
  );
  const applied = applyCommand(sequence, command).sequence;
  const existing = new Set(sequence.tracks.map((track) => track.id));
  const offset = timelineDurationFrames(sequence);
  const preview: Sequence = {
    ...applied,
    name: recipe.name,
    durationFrames: 0,
    tracks: applied.tracks
      .filter((track) => !existing.has(track.id))
      .map((track) => ({
        ...track,
        clips: track.clips.map((clip) => ({
          ...clip,
          startFrame: clip.startFrame - offset,
        })),
      })),
    markers: [],
  };
  return { command, preview, offset };
}

/** Real compositor playback with synthetic UI, kept separate from the user's draft. */
export function exampleSequence(
  sequence: Sequence,
  recipe: Recipe,
  kit: BrandKit,
): Sequence {
  const scenes = initialScenes(recipe).map((scene, index) => ({
    ...scene,
    kind: 'title' as const,
    text: [
      'A simpler way to work',
      'Create your workspace',
      'Share with your team',
      'Ready to begin',
    ][index % 4]!,
    durationSeconds: 2,
  }));
  const empty = { ...sequence, tracks: [], markers: [] };
  const preview = planDraft(
    empty,
    [],
    recipe,
    { ...kit, intro: '', outro: '' },
    scenes,
  ).preview;
  const track = createTrack({
    kind: 'video',
    name: 'Illustrative interface',
    order: 0,
  });
  const durationFrames = sequenceDurationFrames(preview);
  const background = clipSchema.parse({
    id: newId('clip'),
    trackId: track.id,
    type: 'shape',
    shape: 'rect',
    startFrame: 0,
    durationFrames,
    width: 0.8,
    height: 0.65,
    fill: kit.style.accent,
  });
  // Treat the synthetic panel as footage so samples use the actual title placement rules.
  preview.tracks = preview.tracks.map((lane) => ({
    ...lane,
    clips: lane.clips.map((clip, index) =>
      clip.type === 'text'
        ? {
            ...clip,
            text:
              recipe.id === 'tutorial'
                ? `${index + 1}. ${clip.text}`
                : clip.text,
            style: {
              ...clip.style,
              fontSize: Math.round(
                sequence.height *
                  (recipe.id === 'quick-tip'
                    ? 0.055
                    : recipe.id === 'tutorial'
                      ? 0.035
                      : 0.045),
              ),
              align: recipe.id === 'tutorial' ? 'left' : 'center',
            },
            transform: {
              ...clip.transform,
              x: 0,
              y: sequence.height * (recipe.id === 'quick-tip' ? -0.35 : 0.35),
            },
          }
        : clip,
    ),
  }));
  return {
    ...preview,
    tracks: [
      { ...track, clips: [background] },
      ...preview.tracks.map((lane) => ({ ...lane, order: lane.order + 1 })),
    ],
  };
}
