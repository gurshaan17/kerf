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
  sourceInSeconds?: number;
  durationSeconds?: number;
  showTitle?: boolean;
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
  const treatment = recipe.treatment ?? recipe.id;
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
    sequence.durationFrames,
    0,
    ...sequence.tracks.flatMap((t) =>
      t.clips.map((c) => c.startFrame + c.durationFrames),
    ),
  );
  if (cursor === 0)
    commands.push({ type: 'sequence.setStyle', style: kit.style });
  const insert = (value: unknown) =>
    commands.push({ type: 'clip.insert', clip: clipSchema.parse(value) });
  const addTitle = (
    text: string,
    duration: number,
    withMedia: boolean,
    index = 0,
  ) =>
    insert({
      id: newId('clip'),
      trackId: titles.id,
      type: 'text',
      startFrame: cursor,
      durationFrames: duration,
      text:
        withMedia && treatment === 'tutorial' ? `${index + 1}. ${text}` : text,
      label: text,
      transform: {
        x: 0,
        y: withMedia
          ? sequence.height * (treatment === 'quick-tip' ? -0.35 : 0.35)
          : 0,
      },
      style: {
        fontFamily: kit.style.displayFontFamily,
        color: kit.style.foreground,
        background: kit.style.background,
        fontWeight: kit.name === 'Bold' ? 800 : 600,
        fontSize: Math.round(
          sequence.height *
            (withMedia && treatment === 'quick-tip'
              ? 0.055
              : withMedia && treatment === 'tutorial'
                ? 0.035
                : 0.045),
        ),
        align: withMedia && treatment === 'tutorial' ? 'left' : 'center',
        padding: 20,
      },
    });
  if (kit.intro.trim()) {
    const duration = secondsToFrames(3, sequence.frameRate);
    addTitle(kit.intro, duration, false);
    cursor += duration;
  }
  for (const [index, section] of sections.entries()) {
    if (!section.text.trim()) throw new Error('Each section needs a title.');
    const asset = section.assetId ? resolve(section.assetId) : null;
    const sourceIn = section.sourceInSeconds ?? 0;
    const requested = section.durationSeconds ?? recipe.secondsPerSection;
    if (
      !Number.isFinite(sourceIn) ||
      sourceIn < 0 ||
      !Number.isFinite(requested) ||
      requested <= 0
    )
      throw new Error(
        `Scene ${index + 1}: choose a valid source range and duration.`,
      );
    if (
      asset?.kind === 'video' &&
      (sourceIn >= asset.durationSeconds ||
        (section.durationSeconds !== undefined &&
          sourceIn + requested > asset.durationSeconds + 0.000001))
    )
      throw new Error(
        `Scene ${index + 1}: the selected range exceeds the footage. Shorten it or choose another source.`,
      );
    const seconds =
      asset?.kind === 'video'
        ? Math.min(requested, asset.durationSeconds - sourceIn)
        : requested;
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
        sourceInFrame: secondsToFrames(sourceIn, sequence.frameRate),
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
    if (!asset || section.showTitle !== false)
      addTitle(section.text, duration, Boolean(asset), index);
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
  // Title-only sections and silent media do not need empty media/audio lanes.
  const populatedTracks = new Set(
    commands.flatMap((command) =>
      command.type === 'clip.insert' ? [command.clip.trackId] : [],
    ),
  );
  return {
    type: 'batch',
    label: `Apply ${recipe.name}`,
    commands: commands.filter(
      (command) =>
        command.type !== 'track.add' || populatedTracks.has(command.track.id),
    ),
  };
}
