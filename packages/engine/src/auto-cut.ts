import type {
  AutoCutRange,
  EditCommand,
  MediaClip,
  Sequence,
} from '@kerf/model';
import { autoCutKeptRanges, clipEndFrame, newId } from '@kerf/model';
import { requireClip } from './queries';

/** Reject ambiguous sync relationships rather than silently damaging them. */
export function autoCutContext(sequence: Sequence, clipId: string) {
  const location = requireClip(sequence, clipId);
  const clip = location.clip;
  if (clip.type !== 'video' || clip.speed !== 1 || clip.timeMap.length)
    throw new Error('Auto cut needs a normal-speed video clip.');
  const end = clipEndFrame(clip);
  const companions = sequence.tracks
    .flatMap((t) => t.clips)
    .filter(
      (other) =>
        other.type === 'audio' &&
        other.assetId === clip.assetId &&
        other.startFrame === clip.startFrame &&
        other.durationFrames === clip.durationFrames &&
        other.sourceInFrame === clip.sourceInFrame &&
        other.speed === 1 &&
        !other.timeMap.length,
    );
  if (companions.length > 1)
    throw new Error('Auto cut found multiple matching audio clips.');
  const ids = new Set([clip.id, ...companions.map((c) => c.id)]);
  const allClips = sequence.tracks.flatMap((track) => track.clips);
  for (const track of sequence.tracks)
    for (const other of track.clips) {
      if (other.type === 'fxOverlay' && other.linkedItemId) {
        const owner = allClips.find(
          (candidate) => candidate.id === other.linkedItemId,
        );
        if (
          ids.has(other.linkedItemId) ||
          (owner && owner.startFrame >= end && other.startFrame < end)
        )
          throw new Error(
            'Auto cut cannot safely retime these linked overlays.',
          );
      }
      if (
        !ids.has(other.id) &&
        other.startFrame < end &&
        clipEndFrame(other) > clip.startFrame
      )
        throw new Error(
          'Auto cut currently needs a clip without overlapping captions, overlays or other media.',
        );
      if (
        (ids.has(other.id) || other.startFrame >= end) &&
        (other.locked || track.locked)
      )
        throw new Error(
          'Unlock affected clips and tracks before using Auto cut.',
        );
      if (
        ids.has(other.id) &&
        Object.values(other.keyframes).some((keys) => keys.length)
      )
        throw new Error('Auto cut currently needs a clip without keyframes.');
    }
  return { clip, companions: companions as MediaClip[] };
}

export function autoCutCommand(
  sequence: Sequence,
  clipId: string,
  removals: readonly AutoCutRange[],
): EditCommand {
  const { clip, companions } = autoCutContext(sequence, clipId);
  if (!removals.length)
    throw new Error('Choose at least one section to remove.');
  const kept = autoCutKeptRanges(
    clip.sourceInFrame,
    clip.sourceInFrame + clip.durationFrames,
    removals,
  );
  const removed = removals.reduce(
    (sum, r) => sum + r.endFrame - r.startFrame,
    0,
  );
  const commands: EditCommand[] = [];
  for (const original of [clip, ...companions]) {
    commands.push({ type: 'clip.remove', clipId: original.id });
    let cursor = original.startFrame;
    for (const [index, range] of kept.entries()) {
      const durationFrames = range.endFrame - range.startFrame;
      commands.push({
        type: 'clip.insert',
        index:
          sequence.tracks
            .find((t) => t.id === original.trackId)!
            .clips.findIndex((c) => c.id === original.id) + index,
        clip: {
          ...original,
          id: index === 0 ? original.id : newId('clip'),
          startFrame: cursor,
          durationFrames,
          sourceInFrame: range.startFrame,
          fade: {
            inFrames:
              range.startFrame === original.sourceInFrame
                ? Math.min(original.fade.inFrames, durationFrames)
                : 0,
            outFrames:
              range.endFrame ===
              original.sourceInFrame + original.durationFrames
                ? Math.min(original.fade.outFrames, durationFrames)
                : 0,
          },
        },
      });
      cursor += durationFrames;
    }
  }
  const end = clipEndFrame(clip);
  const laterIds = new Set(
    sequence.tracks
      .flatMap((track) => track.clips)
      .filter((candidate) => candidate.startFrame >= end)
      .map((candidate) => candidate.id),
  );
  for (const track of sequence.tracks)
    for (const later of [...track.clips].sort(
      (a, b) => a.startFrame - b.startFrame,
    )) {
      // Moving the owner shifts its linked overlays; moving both would depend
      // on track ordering and could shift followers twice.
      if (
        later.type === 'fxOverlay' &&
        later.linkedItemId &&
        laterIds.has(later.linkedItemId)
      )
        continue;
      if (later.startFrame >= end)
        commands.push({
          type: 'clip.move',
          clipId: later.id,
          startFrame: later.startFrame - removed,
        });
    }
  for (const marker of sequence.markers) {
    const sourceFrame = marker.frame - clip.startFrame + clip.sourceInFrame;
    const delta = removals.reduce(
      (sum, r) =>
        sum + Math.max(0, Math.min(sourceFrame, r.endFrame) - r.startFrame),
      0,
    );
    if (delta)
      commands.push({
        type: 'marker.update',
        markerId: marker.id,
        patch: { frame: marker.frame - delta },
      });
  }
  return { type: 'batch', label: 'Auto cut', commands };
}
