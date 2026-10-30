import { z } from 'zod';
import type {
  AssetId,
  Clip,
  EditCommand,
  Sequence,
  TextStyle,
  Track,
  Transcript,
  TranscriptSegment,
} from '@kerf/model';
import {
  DEFAULT_TEXT_STYLE,
  clipSchema,
  createTrack,
  idSchema,
  newId,
  textStyleSchema,
  framesToSeconds,
  secondsToFrames,
} from '@kerf/model';
import {
  nextTrackOrder,
  sequenceDurationFrames,
  tracksInOrder,
} from '@kerf/engine';
import type { ToolContext } from './types';

const visualTrackId = idSchema('track');
const assetIdSchema = idSchema('asset');
const transcriptIdSchema = idSchema('transcript');

export const CAPTION_PRESETS = ['clean', 'bold', 'boxed'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

export const captionPresetSchema = z.enum(CAPTION_PRESETS);

const PRESET_STYLES: Record<CaptionPreset, TextStyle> = {
  clean: textStyleSchema.parse({
    ...DEFAULT_TEXT_STYLE,
    fontSize: 42,
    fontWeight: 600,
    color: '#ece6dc',
    background: 'rgba(11, 12, 13, 0.72)',
    padding: 12,
  }),
  bold: textStyleSchema.parse({
    ...DEFAULT_TEXT_STYLE,
    fontSize: 58,
    fontWeight: 800,
    color: '#fff6e8',
    background: null,
    lineHeight: 1.05,
    padding: 8,
  }),
  boxed: textStyleSchema.parse({
    ...DEFAULT_TEXT_STYLE,
    fontSize: 44,
    fontWeight: 700,
    color: '#0b0c0d',
    background: '#c9a46a',
    padding: 18,
    lineHeight: 1.15,
  }),
};

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function findTranscript(
  context: ToolContext,
  assetId?: string,
  transcriptId?: string,
): Transcript {
  const snapshot = requireSnapshot(context);
  const transcript = transcriptId
    ? snapshot.transcripts.find((candidate) => candidate.id === transcriptId)
    : assetId
      ? snapshot.transcripts.find((candidate) => candidate.assetId === assetId)
      : snapshot.transcripts[0];
  if (!transcript) {
    throw new Error('No transcript is available. Transcribe an asset first.');
  }
  if (transcript.source === 'visual')
    throw new Error(
      'This tool requires a speech transcript. Visual narration does not identify speech or silence.',
    );
  return transcript;
}

function summary(context: ToolContext, label: string) {
  const snapshot = requireSnapshot(context);
  return {
    label,
    durationFrames: sequenceDurationFrames(snapshot.project.sequence),
  };
}

function normalizedWords(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
}

function similarity(left: string, right: string): number {
  const a = new Set(normalizedWords(left));
  const b = new Set(normalizedWords(right));
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  let overlap = 0;
  for (const word of a) {
    if (b.has(word)) {
      overlap += 1;
    }
  }
  return overlap / new Set([...a, ...b]).size;
}

function isFiller(text: string): boolean {
  const words = normalizedWords(text);
  return (
    words.length === 0 ||
    (words.length <= 2 &&
      words.every((word) => ['um', 'uh', 'erm', 'like', 'so'].includes(word)))
  );
}

function speechRanges(
  transcript: Transcript,
): Array<{ start: number; end: number }> {
  const words = transcript.segments.flatMap((segment) => segment.words);
  const ranges =
    words.length > 0
      ? words.map((word) => ({ start: word.startFrame, end: word.endFrame }))
      : transcript.segments.map((segment) => ({
          start: segment.startFrame,
          end: segment.endFrame,
        }));
  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function silenceRanges(
  transcript: Transcript,
  minSilenceFrames: number,
  paddingFrames: number,
): Array<{ start: number; end: number }> {
  const speech = speechRanges(transcript);
  const gaps: Array<{ start: number; end: number }> = [];
  for (let index = 1; index < speech.length; index += 1) {
    const previous = speech[index - 1];
    const next = speech[index];
    if (!previous || !next) {
      continue;
    }
    const start = previous.end + paddingFrames;
    const end = next.start - paddingFrames;
    if (next.start - previous.end >= minSilenceFrames && end > start) {
      gaps.push({ start, end });
    }
  }
  return gaps;
}

function segmentFromClip(
  clip: Clip,
  startFrame: number,
  endFrame: number,
  sourceStart: number,
): Clip {
  const base = {
    ...clip,
    id: newId('clip'),
    startFrame,
    durationFrames: Math.max(1, endFrame - startFrame),
  };
  if (clip.type === 'video' || clip.type === 'audio') {
    return clipSchema.parse({
      ...base,
      sourceInFrame: Math.max(0, sourceStart),
      speed: 1,
      timeMap: [],
    });
  }
  return clipSchema.parse(base);
}

function cutClip(
  clip: Clip,
  cuts: ReadonlyArray<{ start: number; end: number }>,
  shift: number,
): { clips: Clip[]; removed: number } {
  const clipStart = clip.startFrame;
  const clipEnd = clip.startFrame + clip.durationFrames;
  const relevant = cuts
    .map((cut) => ({
      start: Math.max(clipStart, cut.start),
      end: Math.min(clipEnd, cut.end),
    }))
    .filter((cut) => cut.end > cut.start)
    .sort((left, right) => left.start - right.start);
  if (relevant.length === 0) {
    return {
      clips: [
        {
          ...clip,
          startFrame: Math.max(0, clipStart - shift),
        } as Clip,
      ],
      removed: 0,
    };
  }

  const kept: Array<{ start: number; end: number }> = [];
  let cursor = clipStart;
  for (const cut of relevant) {
    if (cut.start > cursor) {
      kept.push({ start: cursor, end: cut.start });
    }
    cursor = Math.max(cursor, cut.end);
  }
  if (cursor < clipEnd) {
    kept.push({ start: cursor, end: clipEnd });
  }

  let cutIndex = 0;
  let removedBefore = 0;
  const clips = kept.map((range) => {
    while (
      cutIndex < relevant.length &&
      (relevant[cutIndex]?.end ?? Number.POSITIVE_INFINITY) <= range.start
    ) {
      const cut = relevant[cutIndex];
      if (cut) {
        removedBefore += cut.end - cut.start;
      }
      cutIndex += 1;
    }
    const sourceStart =
      clip.type === 'video' || clip.type === 'audio'
        ? clip.sourceInFrame + (range.start - clipStart)
        : 0;
    return segmentFromClip(
      clip,
      Math.max(0, range.start - shift - removedBefore),
      Math.max(1, range.end - shift - removedBefore),
      sourceStart,
    );
  });
  const removed = relevant.reduce(
    (total, cut) => total + cut.end - cut.start,
    0,
  );
  return { clips, removed };
}

function rebuildTrackCommands(
  track: Track,
  cuts: ReadonlyArray<{ start: number; end: number }>,
  commands: EditCommand[],
): number {
  let shift = 0;
  const rebuilt: Clip[] = [];
  let changed = false;
  for (const clip of [...track.clips].sort(
    (left, right) => left.startFrame - right.startFrame,
  )) {
    const mappedCuts =
      (clip.type === 'video' || clip.type === 'audio') &&
      clip.speed === 1 &&
      clip.timeMap.length === 0
        ? cuts
            .map((cut) => ({
              start: clip.startFrame + (cut.start - clip.sourceInFrame),
              end: clip.startFrame + (cut.end - clip.sourceInFrame),
            }))
            .filter(
              (cut) =>
                cut.end > clip.startFrame &&
                cut.start < clip.startFrame + clip.durationFrames,
            )
        : [];
    const result = cutClip(clip, mappedCuts, shift);
    shift += result.removed;
    if (result.removed > 0) {
      changed = true;
    }
    rebuilt.push(...result.clips);
  }
  if (!changed) {
    return 0;
  }
  for (const clip of track.clips) {
    commands.push({ type: 'clip.remove', clipId: clip.id });
  }
  for (const clip of rebuilt.sort(
    (left, right) => left.startFrame - right.startFrame,
  )) {
    commands.push({ type: 'clip.insert', clip });
  }
  return shift;
}

function mergeRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  ranges.sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function timelineSpeechRanges(
  sequence: Sequence,
  transcript: Transcript,
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (
        (clip.type !== 'video' && clip.type !== 'audio') ||
        clip.assetId !== transcript.assetId ||
        clip.speed !== 1 ||
        clip.timeMap.length > 0
      ) {
        continue;
      }
      for (const speech of speechRanges(transcript)) {
        const start = clip.startFrame + (speech.start - clip.sourceInFrame);
        const end = clip.startFrame + (speech.end - clip.sourceInFrame);
        if (
          end > clip.startFrame &&
          start < clip.startFrame + clip.durationFrames
        ) {
          ranges.push({
            start: Math.max(clip.startFrame, start),
            end: Math.min(clip.startFrame + clip.durationFrames, end),
          });
        }
      }
    }
  }
  return mergeRanges(ranges);
}

function assetFrameToTimeline(
  sequence: Sequence,
  assetId: string,
  frame: number,
): number {
  for (const track of sequence.tracks) {
    for (const clip of track.clips) {
      if (
        (clip.type !== 'video' && clip.type !== 'audio') ||
        clip.assetId !== assetId ||
        clip.speed !== 1 ||
        clip.timeMap.length > 0
      ) {
        continue;
      }
      if (
        frame >= clip.sourceInFrame &&
        frame < clip.sourceInFrame + clip.durationFrames
      ) {
        return clip.startFrame + (frame - clip.sourceInFrame);
      }
    }
  }
  return frame;
}

function assetClips(sequence: Sequence, assetId: string): Clip[] {
  return sequence.tracks.flatMap((track) =>
    track.clips.filter(
      (clip) =>
        (clip.type === 'video' || clip.type === 'audio') &&
        clip.assetId === assetId,
    ),
  );
}

export const writeCaptionsTool = {
  name: 'writeCaptions',
  description:
    'Create caption clips from a transcript using the clean, bold or boxed preset. Visual narration must be reviewed and fit normal-speed timeline clips; only its linked generated captions are replaced, preserving manual clips.',
  input: z.object({
    assetId: assetIdSchema.optional(),
    transcriptId: transcriptIdSchema.optional(),
    preset: captionPresetSchema.default('clean'),
    trackId: visualTrackId.optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      assetId?: AssetId;
      transcriptId?: string;
      preset: CaptionPreset;
      trackId?: string;
      expectedRevision?: number;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const transcripts = snapshot.transcripts.filter((transcript) =>
      input.transcriptId
        ? transcript.id === input.transcriptId
        : input.assetId
          ? transcript.assetId === input.assetId
          : true,
    );
    if (transcripts.length === 0) {
      throw new Error('No transcript matches that asset.');
    }
    for (const transcript of transcripts) {
      if (transcript.source === 'visual' && transcript.status !== 'reviewed')
        throw new Error('Review visual narration before creating captions.');
      if (
        input.expectedRevision !== undefined &&
        transcript.revision !== input.expectedRevision
      )
        throw new Error('Narration changed before captions were applied.');
    }
    const sequence = snapshot.project.sequence;
    const requestedTrack = input.trackId
      ? sequence.tracks.find((track) => track.id === input.trackId)
      : null;
    if (requestedTrack && requestedTrack.kind !== 'caption') {
      throw new Error('Captions need a caption track.');
    }
    const existingTrack =
      requestedTrack ??
      tracksInOrder(sequence).find(
        (track) => track.kind === 'caption' && !track.locked,
      );
    const commands: EditCommand[] = [];
    const track =
      existingTrack ??
      createTrack({
        kind: 'caption',
        name: 'Captions',
        order: nextTrackOrder(sequence),
      });
    if (!existingTrack) {
      commands.push({ type: 'track.add', track });
    }
    const transcriptIds = new Set(
      transcripts.map((transcript) => transcript.id),
    );
    const visualIds = new Set(
      transcripts.filter((t) => t.source === 'visual').map((t) => t.id),
    );
    for (const sourceTrack of sequence.tracks)
      for (const clip of sourceTrack.clips) {
        if (
          clip.type === 'caption' &&
          transcriptIds.has(clip.transcriptId) &&
          (visualIds.has(clip.transcriptId)
            ? clip.generatedFromTranscript
            : sourceTrack.id === track.id)
        ) {
          if (sourceTrack.locked)
            throw new Error(
              'Unlock linked caption tracks before updating captions.',
            );
          commands.push({ type: 'clip.remove', clipId: clip.id });
        }
      }
    const style = PRESET_STYLES[input.preset];
    let created = 0;
    let cursor = 0;
    for (const transcript of transcripts) {
      for (const segment of [...transcript.segments].sort(
        (left, right) => left.startFrame - right.startFrame,
      )) {
        if (!segment.text.trim() || segment.endFrame <= segment.startFrame) {
          continue;
        }
        let toTimeline = (frame: number) =>
          assetFrameToTimeline(sequence, transcript.assetId, frame);
        if (transcript.source === 'visual') {
          const asset = snapshot.assets.find(
            (a) => a.id === transcript.assetId,
          );
          const sourceRate = asset?.frameRate ?? sequence.frameRate;
          const normalized = (frame: number) =>
            secondsToFrames(
              framesToSeconds(frame, sourceRate),
              sequence.frameRate,
            );
          const match = sequence.tracks
            .flatMap((t) => t.clips)
            .find(
              (clip) =>
                (clip.type === 'video' || clip.type === 'audio') &&
                clip.assetId === transcript.assetId &&
                clip.speed === 1 &&
                clip.timeMap.length === 0 &&
                normalized(segment.startFrame) >= clip.sourceInFrame &&
                normalized(segment.endFrame) <=
                  clip.sourceInFrame + clip.durationFrames,
            );
          if (!match || (match.type !== 'video' && match.type !== 'audio'))
            throw new Error(
              'Place each narration range on a normal-speed timeline clip before creating captions. Rows crossing a trim or retime need adjustment.',
            );
          toTimeline = (frame) =>
            match.startFrame + normalized(frame) - match.sourceInFrame;
        }
        const startFrame = Math.max(
          toTimeline(segment.startFrame),
          transcript.source === 'visual' ? 0 : cursor,
        );
        const endFrame = Math.max(startFrame + 1, toTimeline(segment.endFrame));
        const clip: Clip = clipSchema.parse({
          id: newId('clip'),
          trackId: track.id,
          startFrame,
          durationFrames: endFrame - startFrame,
          label: segment.text.slice(0, 80),
          type: 'caption',
          transcriptId: transcript.id,
          segmentId: segment.id,
          generatedFromTranscript: true,
          transcriptRevision: transcript.revision,
          text: segment.text,
          words: segment.words.map((word) => ({
            ...word,
            startFrame: Math.max(0, toTimeline(word.startFrame) - startFrame),
            endFrame: Math.max(1, toTimeline(word.endFrame) - startFrame),
          })),
          style,
        });
        commands.push({ type: 'clip.insert', clip });
        cursor = endFrame;
        created += 1;
      }
    }
    if (created === 0) {
      throw new Error('The transcript has no words to caption.');
    }
    const result = context.applyBatch(commands, {
      label: `Write ${input.preset} captions`,
    });
    return {
      ...summary(context, result.command.label || 'Write captions'),
      commandId: result.command.id,
      captionCount: created,
      trackId: track.id,
      preset: input.preset,
    };
  },
};

export const cutSilencesTool = {
  name: 'cutSilences',
  description:
    'Remove spoken pauses from clips of one transcribed asset and close the gaps as one undo step.',
  input: z.object({
    assetId: assetIdSchema.optional(),
    transcriptId: transcriptIdSchema.optional(),
    minSilenceFrames: z.number().int().positive().max(2_400).default(12),
    paddingFrames: z.number().int().nonnegative().max(240).default(2),
  }),
  execute(
    context: ToolContext,
    input: {
      assetId?: AssetId;
      transcriptId?: string;
      minSilenceFrames: number;
      paddingFrames: number;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const transcript = findTranscript(
      context,
      input.assetId,
      input.transcriptId,
    );
    const cuts = silenceRanges(
      transcript,
      input.minSilenceFrames,
      input.paddingFrames,
    );
    if (cuts.length === 0) {
      return {
        ...summary(context, 'Cut silences'),
        cutCount: 0,
        removedFrames: 0,
      };
    }
    const affected = assetClips(snapshot.project.sequence, transcript.assetId);
    if (affected.length === 0) {
      throw new Error('That asset has no clips on the timeline.');
    }
    const commands: EditCommand[] = [];
    let removedFrames = 0;
    const affectedTracks = new Set<string>();
    for (const track of snapshot.project.sequence.tracks) {
      if (
        !track.clips.some(
          (clip) =>
            (clip.type === 'video' || clip.type === 'audio') &&
            clip.assetId === transcript.assetId,
        )
      ) {
        continue;
      }
      const removed = rebuildTrackCommands(track, cuts, commands);
      if (removed > 0) {
        removedFrames += removed;
        affectedTracks.add(track.id);
      }
    }
    if (commands.length === 0) {
      return {
        ...summary(context, 'Cut silences'),
        cutCount: 0,
        removedFrames: 0,
      };
    }
    const result = context.applyBatch(commands, {
      label: 'Cut silences',
    });
    return {
      ...summary(context, result.command.label || 'Cut silences'),
      commandId: result.command.id,
      cutCount: cuts.length,
      removedFrames,
      affectedTrackIds: [...affectedTracks],
    };
  },
};

export const duckUnderSpeechTool = {
  name: 'duckUnderSpeech',
  description:
    'Lower non-speech audio clips that overlap transcribed speech. Use a gain between 0 and 1.',
  input: z.object({
    assetId: assetIdSchema.optional(),
    transcriptId: transcriptIdSchema.optional(),
    gain: z.number().min(0).max(1).default(0.35),
  }),
  execute(
    context: ToolContext,
    input: { assetId?: AssetId; transcriptId?: string; gain: number },
  ) {
    const snapshot = requireSnapshot(context);
    const transcript = findTranscript(
      context,
      input.assetId,
      input.transcriptId,
    );
    const speech = timelineSpeechRanges(snapshot.project.sequence, transcript);
    if (speech.length === 0) {
      throw new Error('The transcript has no speech to duck under.');
    }
    const commands: EditCommand[] = [];
    for (const track of snapshot.project.sequence.tracks) {
      if (track.kind !== 'audio') {
        continue;
      }
      for (const clip of track.clips) {
        if (clip.type !== 'audio' || clip.assetId === transcript.assetId) {
          continue;
        }
        const start = clip.startFrame;
        const end = clip.startFrame + clip.durationFrames;
        const overlaps = speech.some(
          (range) => range.start < end && range.end > start,
        );
        if (!overlaps) {
          continue;
        }
        commands.push({
          type: 'clip.update',
          clipId: clip.id,
          patch: { volume: Math.max(0, input.gain) },
        });
      }
    }
    if (commands.length === 0) {
      return {
        ...summary(context, 'Duck under speech'),
        duckedClipCount: 0,
      };
    }
    const result = context.applyBatch(commands, {
      label: 'Duck under speech',
    });
    return {
      ...summary(context, result.command.label || 'Duck under speech'),
      commandId: result.command.id,
      duckedClipCount: commands.length,
      gain: input.gain,
    };
  },
};

export const assembleRoughCutTool = {
  name: 'assembleRoughCut',
  description:
    'Build a new video track from spoken segments, dropping false starts and repeated takes.',
  input: z.object({
    assetId: assetIdSchema.optional(),
    transcriptId: transcriptIdSchema.optional(),
    trackName: z.string().min(1).default('Rough cut'),
    similarityThreshold: z.number().min(0.1).max(1).default(0.6),
  }),
  execute(
    context: ToolContext,
    input: {
      assetId?: AssetId;
      transcriptId?: string;
      trackName: string;
      similarityThreshold: number;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const transcript = findTranscript(
      context,
      input.assetId,
      input.transcriptId,
    );
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === transcript.assetId,
    );
    if (!asset || asset.kind !== 'video') {
      throw new Error('Rough cut needs a video asset with a transcript.');
    }
    const segments = [...transcript.segments]
      .filter((segment) => !isFiller(segment.text))
      .sort((left, right) => left.startFrame - right.startFrame);
    if (segments.length === 0) {
      throw new Error('The transcript has no usable segments.');
    }
    const kept: TranscriptSegment[] = [];
    for (const segment of segments) {
      const previous = kept.at(-1);
      if (
        previous &&
        similarity(previous.text, segment.text) >= input.similarityThreshold
      ) {
        kept[kept.length - 1] = segment;
      } else {
        kept.push(segment);
      }
    }
    const sequence = snapshot.project.sequence;
    const track = createTrack({
      kind: 'video',
      name: input.trackName,
      order: nextTrackOrder(sequence),
    });
    const commands: EditCommand[] = [{ type: 'track.add', track }];
    let cursor = 0;
    for (const segment of kept) {
      const duration = Math.max(1, segment.endFrame - segment.startFrame);
      const clip: Clip = clipSchema.parse({
        id: newId('clip'),
        trackId: track.id,
        startFrame: cursor,
        durationFrames: duration,
        label: segment.text.slice(0, 80),
        type: 'video',
        assetId: asset.id,
        sourceInFrame: segment.startFrame,
      });
      commands.push({ type: 'clip.insert', clip });
      cursor += duration;
    }
    const result = context.applyBatch(commands, {
      label: 'Assemble rough cut',
    });
    return {
      ...summary(context, result.command.label || 'Assemble rough cut'),
      commandId: result.command.id,
      trackId: track.id,
      clipCount: kept.length,
      removedSegments: segments.length - kept.length,
      durationFrames: cursor,
    };
  },
};

export const MACRO_TOOLS = [
  writeCaptionsTool,
  cutSilencesTool,
  duckUnderSpeechTool,
  assembleRoughCutTool,
];
