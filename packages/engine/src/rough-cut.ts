import type { Asset, EditCommand, Sequence } from '@kerf/model';
import { clipSchema, createTrack, newId, secondsToFrames } from '@kerf/model';
import { sequenceDurationFrames } from './queries';

export interface RoughCutRange {
  readonly assetId: string;
  /** Source coordinates expressed in sequence-frame units, at normal speed. */
  readonly sourceInFrame: number;
  readonly durationFrames: number;
  readonly label: string;
}

/** Append an editable cut with dedicated synchronized source-audio tracks. */
export function roughCutCommand(
  sequence: Sequence,
  assets: readonly Asset[],
  ranges: readonly RoughCutRange[],
): EditCommand {
  if (!ranges.length || ranges.length > 40)
    throw new Error('Choose between one and forty source ranges.');
  const order = Math.max(-1, ...sequence.tracks.map((t) => t.order)) + 1;
  const video = createTrack({
    kind: 'video',
    name: 'Planned rough cut',
    order,
  });
  const audio = createTrack({
    kind: 'audio',
    name: 'Rough cut source audio',
    order: order + 1,
  });
  const commands: EditCommand[] = [{ type: 'track.add', track: video }];
  const resolved = ranges.map((range) => {
    const asset = assets.find((a) => a.id === range.assetId);
    if (
      !asset ||
      asset.kind !== 'video' ||
      !asset.hasVideo ||
      asset.status !== 'ready'
    )
      throw new Error('Rough cut requires ready source video.');
    if (asset.id === sequence.reference?.sourceAssetId)
      throw new Error('Reference footage cannot be used in a rough cut.');
    if (
      !Number.isInteger(range.sourceInFrame) ||
      !Number.isInteger(range.durationFrames) ||
      range.sourceInFrame < 0 ||
      range.durationFrames <= 0 ||
      range.sourceInFrame + range.durationFrames >
        secondsToFrames(asset.durationSeconds, sequence.frameRate, 'floor')
    )
      throw new Error('A rough-cut range exceeds its source media.');
    return asset;
  });
  if (resolved.some((a) => a.hasAudio))
    commands.push({ type: 'track.add', track: audio });
  let cursor = sequenceDurationFrames(sequence);
  ranges.forEach((range, index) => {
    const asset = resolved[index]!;
    const clip = clipSchema.parse({
      id: newId('clip'),
      type: 'video',
      assetId: asset.id,
      trackId: video.id,
      startFrame: cursor,
      durationFrames: range.durationFrames,
      sourceInFrame: range.sourceInFrame,
      label: range.label.slice(0, 80),
      speed: 1,
      timeMap: [],
      volume: asset.hasAudio ? 0 : 1,
    });
    commands.push({ type: 'clip.insert', clip });
    if (asset.hasAudio)
      commands.push({
        type: 'clip.insert',
        clip: clipSchema.parse({
          ...clip,
          id: newId('clip'),
          type: 'audio',
          trackId: audio.id,
          volume: 1,
        }),
      });
    cursor += range.durationFrames;
  });
  return { type: 'batch', label: 'Apply planned rough cut', commands };
}
