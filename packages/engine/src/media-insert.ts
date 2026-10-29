import type { Asset, Clip, EditCommand, Sequence } from '@kerf/model';
import { clipEndFrame, clipSchema, createTrack, newId } from '@kerf/model';
import { tracksInOrder } from './queries';

/** Insert source audio separately, keeping both clips in one undo step. */
export function mediaInsertCommand(
  sequence: Sequence,
  asset: Asset,
  clip: Clip,
): EditCommand {
  if (clip.type !== 'video' || !asset.hasAudio) {
    return { type: 'clip.insert', clip };
  }

  const available = tracksInOrder(sequence).find(
    (track) =>
      track.kind === 'audio' &&
      !track.locked &&
      !track.clips.some(
        (other) =>
          other.startFrame < clipEndFrame(clip) &&
          clipEndFrame(other) > clip.startFrame,
      ),
  );
  const track =
    available ??
    createTrack({
      kind: 'audio',
      name: `Audio ${sequence.tracks.filter((track) => track.kind === 'audio').length + 1}`,
      order: Math.max(-1, ...sequence.tracks.map((track) => track.order)) + 1,
    });
  const audio = clipSchema.parse({
    ...clip,
    id: newId('clip'),
    type: 'audio',
    trackId: track.id,
  });
  return {
    type: 'batch',
    label: `Insert ${asset.name}`,
    commands: [
      ...(available ? [] : [{ type: 'track.add' as const, track }]),
      { type: 'clip.insert', clip: { ...clip, volume: 0 } },
      { type: 'clip.insert', clip: audio },
    ],
  };
}
