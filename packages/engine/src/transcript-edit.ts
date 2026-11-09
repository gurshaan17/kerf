import type {
  Clip,
  EditCommand,
  FrameRate,
  Sequence,
  TranscriptSegment,
} from '@kerf/model';
import {
  clipEndFrame,
  clipSchema,
  framesToSeconds,
  newId,
  secondsToFrames,
} from '@kerf/model';

export interface TranscriptOccurrence {
  clipId: string;
  trackName: string;
  startFrame: number;
  endFrame: number;
}

/** Transcript frames use the asset rate; source offsets use the sequence rate. */
export function transcriptOccurrences(
  sequence: Sequence,
  assetId: string,
  segment: Pick<TranscriptSegment, 'startFrame' | 'endFrame'>,
  rate: FrameRate,
): TranscriptOccurrence[] {
  const start = secondsToFrames(
    framesToSeconds(segment.startFrame, rate),
    sequence.frameRate,
  );
  const end = secondsToFrames(
    framesToSeconds(segment.endFrame, rate),
    sequence.frameRate,
  );
  return sequence.tracks.flatMap((track) =>
    track.clips.flatMap((clip) => {
      if (
        (clip.type !== 'video' && clip.type !== 'audio') ||
        clip.assetId !== assetId ||
        clip.timeMap.length
      )
        return [];
      const first = Math.max(
        0,
        Math.round((start - clip.sourceInFrame) / clip.speed),
      );
      const last = Math.min(
        clip.durationFrames,
        Math.round((end - clip.sourceInFrame) / clip.speed),
      );
      return last > first
        ? [
            {
              clipId: clip.id,
              trackName: track.name,
              startFrame: clip.startFrame + first,
              endFrame: clip.startFrame + last,
            },
          ]
        : [];
    }),
  );
}

function slice(
  clip: Clip,
  start: number,
  end: number,
  destination: number,
): Clip {
  const offset = start - clip.startFrame;
  const durationFrames = end - start;
  const piece = {
    ...clip,
    id: newId('clip'),
    startFrame: destination,
    durationFrames,
  };
  if (piece.type === 'video' || piece.type === 'audio') {
    piece.sourceInFrame += Math.round(offset * piece.speed);
    piece.fade = {
      inFrames:
        offset === 0 ? Math.min(piece.fade.inFrames, durationFrames) : 0,
      outFrames:
        end === clipEndFrame(clip)
          ? Math.min(piece.fade.outFrames, durationFrames)
          : 0,
    };
  }
  if (piece.type === 'caption') {
    piece.words = piece.words
      .filter(
        (w) => w.endFrame > offset && w.startFrame < offset + durationFrames,
      )
      .map((w) => ({
        ...w,
        startFrame: Math.max(0, w.startFrame - offset),
        endFrame: Math.min(durationFrames, w.endFrame - offset),
      }));
    if (clip.type === 'caption' && clip.words.length)
      piece.text = piece.words.map((w) => w.text).join(' ');
  }
  return clipSchema.parse(piece);
}

export type TranscriptAction = 'remove' | 'extract' | 'move' | 'mute';

/** One atomic edit across tracks. Extraction and movement collect the passage at the sequence end. */
export function transcriptEditCommand(
  sequence: Sequence,
  start: number,
  end: number,
  action: TranscriptAction,
  assetId?: string,
): EditCommand {
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start
  )
    throw new Error('Choose a nonempty timeline passage.');
  const length = end - start;
  const tail = Math.max(
    0,
    ...sequence.tracks.flatMap((t) => t.clips.map(clipEndFrame)),
  );
  if (end > tail) throw new Error('The passage is outside the timeline.');
  const ripple = action === 'remove' || action === 'move';
  const commands: EditCommand[] = [],
    inserts: EditCommand[] = [];
  const affected = new Set<string>();
  for (const track of sequence.tracks)
    for (const clip of track.clips) {
      const intersects = clip.startFrame < end && clipEndFrame(clip) > start;
      const speech =
        (clip.type === 'audio' || clip.type === 'video') &&
        clip.assetId === assetId;
      if (
        (!intersects || (action === 'mute' && !speech)) &&
        !(ripple && clip.startFrame >= end)
      )
        continue;
      if (track.locked || clip.locked)
        throw new Error(
          'Unlock affected clips and tracks before editing this passage.',
        );
      if (
        (clip.type === 'audio' || clip.type === 'video') &&
        clip.timeMap.length
      )
        throw new Error('Flatten speed ramps before editing this passage.');
      if (Object.values(clip.keyframes).some((keys) => keys.length))
        throw new Error(
          'Remove keyframes from affected clips before editing this passage.',
        );
      if (
        clip.type === 'caption' &&
        !clip.words.length &&
        intersects &&
        (start > clip.startFrame || end < clipEndFrame(clip))
      )
        throw new Error(
          'This cut splits a caption without word timing. Adjust the boundaries or remove that caption first.',
        );
      affected.add(clip.id);
      if (action === 'extract') {
        inserts.push({
          type: 'clip.insert',
          clip: slice(
            clip,
            Math.max(start, clip.startFrame),
            Math.min(end, clipEndFrame(clip)),
            tail + Math.max(0, clip.startFrame - start),
          ),
        });
        continue;
      }
      commands.push({ type: 'clip.remove', clipId: clip.id });
      if (clip.startFrame >= end) {
        inserts.push({
          type: 'clip.insert',
          clip: { ...clip, startFrame: clip.startFrame - length },
        });
        continue;
      }
      const first = Math.max(start, clip.startFrame),
        last = Math.min(end, clipEndFrame(clip));
      if (clip.startFrame < first)
        inserts.push({
          type: 'clip.insert',
          clip: slice(clip, clip.startFrame, first, clip.startFrame),
        });
      if (action === 'move')
        inserts.push({
          type: 'clip.insert',
          clip: slice(clip, first, last, tail - length + first - start),
        });
      if (action === 'mute') {
        const muted = slice(clip, first, last, first);
        if (muted.type === 'audio' || muted.type === 'video') muted.volume = 0;
        inserts.push({ type: 'clip.insert', clip: muted });
      }
      if (clipEndFrame(clip) > last)
        inserts.push({
          type: 'clip.insert',
          clip: slice(
            clip,
            last,
            clipEndFrame(clip),
            ripple ? last - length : last,
          ),
        });
    }
  for (const track of sequence.tracks)
    for (const clip of track.clips) {
      if (
        clip.type === 'fxOverlay' &&
        clip.linkedItemId &&
        (affected.has(clip.id) || affected.has(clip.linkedItemId))
      )
        throw new Error(
          'Unlink affected overlays before editing this passage.',
        );
    }
  if (!affected.size) throw new Error('No media in this passage.');
  if (ripple)
    for (const marker of sequence.markers)
      if (marker.frame > start)
        inserts.push({
          type: 'marker.update',
          markerId: marker.id,
          patch: {
            frame: marker.frame - Math.min(length, marker.frame - start),
          },
        });
  return {
    type: 'batch',
    label: `${action === 'mute' ? 'Mute speech' : action[0]!.toUpperCase() + action.slice(1)} transcript passage`,
    commands: [...commands, ...inserts],
  };
}
