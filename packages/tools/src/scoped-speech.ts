import { speechDuckingCommand } from '@kerf/engine';
import {
  clipSchema,
  createTrack,
  fpsToNumber,
  newId,
  secondsToFrames,
} from '@kerf/model';
import type { Clip, EditCommand, TextStyle } from '@kerf/model';
import type { ToolContext } from './types';

function sources(context: ToolContext, clipIds: readonly string[]) {
  const snapshot = context.snapshot();
  if (!snapshot) throw new Error('Open a project first.');
  if (!clipIds.length || new Set(clipIds).size !== clipIds.length)
    throw new Error('Select unique source clip IDs.');
  const clips = clipIds.map((id) => {
    const track = snapshot.project.sequence.tracks.find((t) =>
      t.clips.some((c) => c.id === id),
    );
    const clip = track?.clips.find((c) => c.id === id);
    if (
      !clip ||
      clip.type !== 'video' ||
      clip.speed !== 1 ||
      clip.timeMap.length ||
      track?.locked ||
      clip.locked
    )
      throw new Error(
        'Scoped speech tools require existing unlocked normal-speed video clips.',
      );
    return clip;
  });
  return { snapshot, clips };
}

export function writeScopedCaptions(
  context: ToolContext,
  clipIds: readonly string[],
  style: TextStyle,
) {
  const { snapshot, clips } = sources(context, clipIds);
  const sequence = snapshot.project.sequence;
  const existing = sequence.tracks.find(
    (t) => t.kind === 'caption' && t.name === 'Rough cut captions' && !t.locked,
  );
  const track =
    existing ??
    createTrack({
      kind: 'caption',
      name: 'Rough cut captions',
      order: Math.max(-1, ...sequence.tracks.map((t) => t.order)) + 1,
    });
  const captions: Clip[] = [];
  for (const clip of clips) {
    const asset = snapshot.assets.find((a) => a.id === clip.assetId);
    const transcript = snapshot.transcripts.find(
      (t) =>
        t.assetId === clip.assetId &&
        t.source === 'speech' &&
        t.status === 'reviewed',
    );
    if (!transcript) continue;
    const sourceRate = asset?.frameRate ?? sequence.frameRate;
    const normalized = (frame: number, mode: 'floor' | 'ceil') =>
      secondsToFrames(
        frame / fpsToNumber(sourceRate),
        sequence.frameRate,
        mode,
      );
    for (const segment of transcript.segments) {
      const start = normalized(segment.startFrame, 'floor');
      const end = normalized(segment.endFrame, 'ceil');
      if (
        !segment.text.trim() ||
        end <= start ||
        start < clip.sourceInFrame ||
        end > clip.sourceInFrame + clip.durationFrames
      )
        continue;
      const timelineStart = clip.startFrame + start - clip.sourceInFrame;
      captions.push(
        clipSchema.parse({
          id: newId('clip'),
          type: 'caption',
          trackId: track.id,
          startFrame: timelineStart,
          durationFrames: end - start,
          label: segment.text.slice(0, 80),
          transcriptId: transcript.id,
          segmentId: segment.id,
          generatedFromTranscript: true,
          transcriptRevision: transcript.revision,
          text: segment.text,
          style,
          words: segment.words.map((w) => ({
            ...w,
            startFrame: Math.max(0, normalized(w.startFrame, 'floor') - start),
            endFrame: Math.min(
              end - start,
              Math.max(1, normalized(w.endFrame, 'ceil') - start),
            ),
          })),
        }),
      );
    }
  }
  if (!captions.length)
    throw new Error(
      'No complete spoken segments fit the selected clips. Transcribe speech or adjust the cut.',
    );
  const commands: EditCommand[] = existing
    ? []
    : [{ type: 'track.add', track }];
  for (const sourceTrack of sequence.tracks)
    for (const old of sourceTrack.clips) {
      if (
        old.type !== 'caption' ||
        !old.generatedFromTranscript ||
        !captions.some(
          (c) =>
            c.type === 'caption' &&
            c.transcriptId === old.transcriptId &&
            c.segmentId === old.segmentId &&
            c.startFrame === old.startFrame &&
            c.durationFrames === old.durationFrames,
        )
      )
        continue;
      if (sourceTrack.locked)
        throw new Error(
          'Unlock the existing generated captions before updating them.',
        );
      commands.push({ type: 'clip.remove', clipId: old.id });
    }
  commands.push(
    ...captions.map((clip) => ({ type: 'clip.insert' as const, clip })),
  );
  const result = context.applyBatch(commands, {
    label: 'Caption selected rough cut',
  });
  return {
    commandId: result.command.id,
    captionCount: captions.length,
    trackId: track.id,
  };
}

export function duckScopedSpeech(
  context: ToolContext,
  clipIds: readonly string[],
  gain: number,
) {
  const { snapshot, clips } = sources(context, clipIds);
  const sequence = snapshot.project.sequence;
  const speechAssets = new Set(
    snapshot.transcripts
      .filter((t) => t.source === 'speech')
      .map((t) => t.assetId),
  );
  const backgroundClipIds = sequence.tracks
    .filter((t) => t.kind === 'audio' && !t.muted)
    .flatMap((t) => t.clips)
    .filter(
      (c) =>
        c.type === 'audio' &&
        !speechAssets.has(c.assetId) &&
        !clips.some((s) => s.assetId === c.assetId),
    )
    .map((c) => c.id);
  if (!backgroundClipIds.length)
    return {
      duckedClipCount: 0,
      note: 'No overlapping background audio; source speech was preserved.',
    };
  const duck = speechDuckingCommand(
    sequence,
    snapshot.assets,
    snapshot.transcripts,
    {
      speechClipIds: clipIds,
      backgroundClipIds,
      gain,
      attackMs: 100,
      releaseMs: 250,
    },
  );
  if (!duck.backgroundClipIds.length)
    return {
      duckedClipCount: 0,
      note: 'No overlapping background audio; source speech was preserved.',
    };
  const result = context.apply(duck.command, {
    label: 'Duck background under selected speech',
  });
  return {
    commandId: result.command.id,
    duckedClipCount: duck.backgroundClipIds.length,
    gain,
    intervalCount: duck.intervalCount,
  };
}
