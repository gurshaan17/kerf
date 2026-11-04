import type {
  Asset,
  BrandKit,
  EditCommand,
  Recipe,
  Sequence,
} from '@kerf/model';
import {
  brandKitSchema,
  recipeSchema,
  clipSchema,
  createTrack,
  newId,
  secondsToFrames,
} from '@kerf/model';

export interface RecipeSectionInput {
  text: string;
  assetId?: string;
}
/** Compile a draft into existing commands. Never changes or removes existing clips. */
export function recipeCommand(
  sequence: Sequence,
  assets: readonly Asset[],
  recipeInput: Recipe,
  kitInput: BrandKit,
  sections: readonly RecipeSectionInput[],
  logoAssetId?: string,
): EditCommand {
  const recipe = recipeSchema.parse(recipeInput);
  const kit = brandKitSchema.parse(kitInput);
  if (sections.length !== recipe.sections.length)
    throw new Error('Choose content for every section.');
  const resolve = (id: string) => {
    const asset = assets.find((candidate) => candidate.id === id);
    if (
      !asset ||
      asset.status !== 'ready' ||
      !['video', 'image'].includes(asset.kind)
    )
      throw new Error('Choose ready video or image footage.');
    return asset;
  };
  const logo = logoAssetId ? resolve(logoAssetId) : null;
  if (logo && logo.kind !== 'image')
    throw new Error('Choose an image for your logo.');
  let order = Math.max(-1, ...sequence.tracks.map((track) => track.order)) + 1;
  const media = createTrack({
    kind: 'video',
    name: recipe.name,
    order: order++,
  });
  const audio = createTrack({
    kind: 'audio',
    name: `${recipe.name} audio`,
    order: order++,
  });
  const titles = createTrack({
    kind: 'overlay',
    name: `${recipe.name} titles`,
    order: order++,
  });
  const logos = createTrack({
    kind: 'overlay',
    name: `${kit.name} logo`,
    order,
  });
  const commands: EditCommand[] = [
    media,
    audio,
    titles,
    ...(logo ? [logos] : []),
  ].map((track) => ({ type: 'track.add', track }));
  let cursor = Math.max(
    0,
    ...sequence.tracks.flatMap((t) =>
      t.clips.map((c) => c.startFrame + c.durationFrames),
    ),
  );
  if (cursor === 0)
    commands.push({ type: 'sequence.setStyle', style: kit.style });
  const insert = (value: unknown) =>
    commands.push({ type: 'clip.insert', clip: clipSchema.parse(value) });
  const addTitle = (text: string, duration: number, withMedia: boolean) =>
    insert({
      id: newId('clip'),
      trackId: titles.id,
      type: 'text',
      startFrame: cursor,
      durationFrames: duration,
      text,
      label: text,
      transform: { y: withMedia ? sequence.height * 0.35 : 0 },
      style: {
        fontFamily: kit.style.displayFontFamily,
        color: kit.style.foreground,
        background: kit.style.background,
        fontWeight: kit.name === 'Bold' ? 800 : 600,
        fontSize: Math.round(sequence.height * 0.045),
        padding: 20,
      },
    });
  if (kit.intro.trim()) {
    const duration = secondsToFrames(3, sequence.frameRate);
    addTitle(kit.intro, duration, false);
    cursor += duration;
  }
  for (const section of sections) {
    if (!section.text.trim()) throw new Error('Each section needs a title.');
    const asset = section.assetId ? resolve(section.assetId) : null;
    const seconds =
      asset?.kind === 'video'
        ? Math.min(recipe.secondsPerSection, asset.durationSeconds)
        : recipe.secondsPerSection;
    const duration = Math.floor(
      (seconds * sequence.frameRate.numerator) / sequence.frameRate.denominator,
    );
    if (duration < 1) throw new Error('Selected footage is too short.');
    if (asset) {
      const base = {
        id: newId('clip'),
        trackId: media.id,
        startFrame: cursor,
        durationFrames: duration,
        label: asset.name,
        assetId: asset.id,
        type: asset.kind,
        sourceInFrame: 0,
        volume: 0,
      };
      insert(base);
      if (asset.kind === 'video' && asset.hasAudio)
        insert({
          ...base,
          id: newId('clip'),
          trackId: audio.id,
          type: 'audio',
          volume: 1,
        });
    }
    addTitle(section.text, duration, Boolean(asset));
    if (logo)
      insert({
        id: newId('clip'),
        trackId: logos.id,
        type: 'image',
        assetId: logo.id,
        startFrame: cursor,
        durationFrames: duration,
        label: 'Logo',
        transform: {
          scale: 0.15,
          x: sequence.width * 0.37,
          y: -sequence.height * 0.35,
        },
      });
    cursor += duration;
  }
  if (kit.outro.trim()) {
    const duration = secondsToFrames(3, sequence.frameRate);
    addTitle(kit.outro, duration, false);
  }
  return { type: 'batch', label: `Apply ${recipe.name}`, commands };
}
