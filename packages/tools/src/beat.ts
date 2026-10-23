import { z } from 'zod';
import type { BeatMap, Clip, EditCommand } from '@kerf/model';
import { beatMapSchema, clipSchema, idSchema, newId } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import type { ToolContext } from './types';

const assetIdSchema = idSchema('asset');
const beatMapIdSchema = idSchema('beatmap');
const clipIdSchema = idSchema('clip');

const densitySchema = z.enum(['sparse', 'medium', 'dense']);

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function strideFor(density: z.infer<typeof densitySchema>): number {
  switch (density) {
    case 'sparse':
      return 4;
    case 'medium':
      return 2;
    case 'dense':
      return 1;
  }
}

function beatSummary(beatMap: BeatMap) {
  return {
    id: beatMap.id,
    assetId: beatMap.assetId,
    bpm: beatMap.bpm,
    offsetFrames: beatMap.offsetFrames,
    beatCount: beatMap.beats.length,
    sectionCount: beatMap.sections.length,
    beats: beatMap.beats,
    sections: beatMap.sections,
  };
}

function cutClipAtFrames(clip: Clip, frames: readonly number[]): Clip[] {
  const boundaries = [
    clip.startFrame,
    ...frames
      .filter(
        (frame) =>
          frame > clip.startFrame &&
          frame < clip.startFrame + clip.durationFrames,
      )
      .sort((left, right) => left - right),
    clip.startFrame + clip.durationFrames,
  ];
  const segments: Clip[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1];
    const end = boundaries[index];
    if (start === undefined || end === undefined || end <= start) {
      continue;
    }
    const segment = {
      ...clip,
      id: newId('clip'),
      startFrame: start,
      durationFrames: end - start,
    };
    if (clip.type === 'video' || clip.type === 'audio') {
      segments.push(
        clipSchema.parse({
          ...segment,
          sourceInFrame: clip.sourceInFrame + (start - clip.startFrame),
          speed: 1,
          timeMap: [],
        }),
      );
    } else {
      segments.push(clipSchema.parse(segment));
    }
  }
  return segments;
}

export const detectBeatsTool = {
  name: 'detectBeats',
  description:
    'Detect tempo, beats and sections for one audio or video asset. Uses the configured local DSP analyzer.',
  input: z.object({
    assetId: assetIdSchema,
  }),
  readOnly: false,
  async execute(context: ToolContext, input: { assetId: string }) {
    const snapshot = requireSnapshot(context);
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new Error('That asset is not in the open project.');
    }
    if (!asset.hasAudio) {
      throw new Error('That asset has no audio to analyze.');
    }
    if (!context.detectBeats) {
      throw new Error('Beat detection is not available in this session.');
    }
    const beatMap = await context.detectBeats(input.assetId);
    return {
      beatMap: beatSummary(beatMapSchema.parse(beatMap)),
      durationFrames: sequenceDurationFrames(snapshot.project.sequence),
    };
  },
};

export const cutToBeatTool = {
  name: 'cutToBeat',
  description:
    'Split media clips on detected beats. Sparse, medium and dense choose every fourth, second or every beat.',
  input: z.object({
    assetId: assetIdSchema,
    beatMapId: beatMapIdSchema.optional(),
    density: densitySchema.default('medium'),
    clipIds: z.array(clipIdSchema).min(1).optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      assetId: string;
      beatMapId?: string;
      density: z.infer<typeof densitySchema>;
      clipIds?: string[];
    },
  ) {
    const snapshot = requireSnapshot(context);
    const beatMap =
      (input.beatMapId
        ? snapshot.beatMaps.find(
            (candidate) => candidate.id === input.beatMapId,
          )
        : snapshot.beatMaps.find(
            (candidate) => candidate.assetId === input.assetId,
          )) ?? null;
    if (!beatMap) {
      throw new Error('Detect beats for that asset first.');
    }
    const stride = strideFor(input.density);
    const targetIds = input.clipIds ? new Set(input.clipIds) : null;
    const commands: EditCommand[] = [];
    let cutCount = 0;
    let segmentCount = 0;
    for (const track of snapshot.project.sequence.tracks) {
      for (const clip of track.clips) {
        if (targetIds && !targetIds.has(clip.id)) {
          continue;
        }
        if (
          (clip.type !== 'video' && clip.type !== 'audio') ||
          clip.assetId !== input.assetId ||
          clip.speed !== 1 ||
          clip.timeMap.length > 0
        ) {
          continue;
        }
        const sourceStart = clip.sourceInFrame;
        const sourceEnd = sourceStart + clip.durationFrames;
        const beats = beatMap.beats
          .filter(
            (beat, index) =>
              index % stride === 0 &&
              beat.frame >= sourceStart &&
              beat.frame < sourceEnd,
          )
          .map((beat) => clip.startFrame + (beat.frame - sourceStart))
          .filter(
            (frame) =>
              frame > clip.startFrame &&
              frame < clip.startFrame + clip.durationFrames,
          );
        if (beats.length === 0) {
          continue;
        }
        const segments = cutClipAtFrames(clip, beats);
        if (segments.length <= 1) {
          continue;
        }
        commands.push({ type: 'clip.remove', clipId: clip.id });
        commands.push(
          ...segments.map((segment) => ({
            type: 'clip.insert' as const,
            clip: segment,
          })),
        );
        cutCount += beats.length;
        segmentCount += segments.length;
      }
    }
    if (commands.length === 0) {
      return {
        cutCount: 0,
        segmentCount: 0,
        durationFrames: sequenceDurationFrames(snapshot.project.sequence),
      };
    }
    const result = context.applyBatch(commands, {
      label: `Cut to beat (${input.density})`,
    });
    return {
      commandId: result.command.id,
      label: result.command.label,
      cutCount,
      segmentCount,
      durationFrames: sequenceDurationFrames(result.snapshot.project.sequence),
      bpm: beatMap.bpm,
    };
  },
};

export const BEAT_TOOLS = [detectBeatsTool, cutToBeatTool];
