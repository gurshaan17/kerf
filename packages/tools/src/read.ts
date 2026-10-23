import { z } from 'zod';
import type { Asset, Clip, Scene, Transcript } from '@kerf/model';
import {
  assetKindSchema,
  blendModeSchema,
  effectTypeSchema,
  fitSchema,
  fpsToNumber,
  maskTypeSchema,
  secondsToFrames,
} from '@kerf/model';
import { sequenceDurationFrames, tracksInOrder } from '@kerf/engine';
import type { ToolContext } from './types';

const emptyInput = z.object({}).default({});
const frameSchema = z.number().int().nonnegative();

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function assetDurationFrames(asset: Asset): number | null {
  if (!asset.frameRate) {
    return null;
  }
  return Math.max(
    0,
    secondsToFrames(asset.durationSeconds, asset.frameRate, 'floor'),
  );
}

function assetSummary(asset: Asset) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    status: asset.status,
    durationSeconds: asset.durationSeconds,
    durationFrames: assetDurationFrames(asset),
    width: asset.width,
    height: asset.height,
    frameRate: asset.frameRate,
    hasVideo: asset.hasVideo,
    hasAudio: asset.hasAudio,
    transcriptId: asset.transcriptId,
    error: asset.error,
  };
}

function sceneSummary(scene: Scene) {
  return {
    id: scene.id,
    index: scene.index,
    startFrame: scene.startFrame,
    endFrame: scene.endFrame,
    durationFrames: scene.endFrame - scene.startFrame,
    description: scene.description,
    score: scene.score,
    thumbnailPath: scene.thumbnailPath,
  };
}

function transcriptSummary(transcript: Transcript) {
  return {
    id: transcript.id,
    assetId: transcript.assetId,
    language: transcript.language,
    text: transcript.text,
    model: transcript.model,
    segmentCount: transcript.segments.length,
    wordCount: transcript.segments.reduce(
      (count, segment) => count + segment.words.length,
      0,
    ),
  };
}

function clipSummary(clip: Clip) {
  const keyframes = Object.entries(clip.keyframes)
    .filter(([, points]) => points.length > 0)
    .map(([property]) => property);
  return {
    id: clip.id,
    type: clip.type,
    label: clip.label,
    trackId: clip.trackId,
    startFrame: clip.startFrame,
    endFrame: clip.startFrame + clip.durationFrames,
    durationFrames: clip.durationFrames,
    assetId: 'assetId' in clip ? clip.assetId : null,
    compositionId: clip.type === 'composition' ? clip.compositionId : null,
    sourceInFrame:
      clip.type === 'video' || clip.type === 'audio' || clip.type === 'image'
        ? 'sourceInFrame' in clip
          ? clip.sourceInFrame
          : 0
        : null,
    speed: clip.type === 'video' || clip.type === 'audio' ? clip.speed : null,
    volume: clip.type === 'video' || clip.type === 'audio' ? clip.volume : null,
    effectCount: clip.effects.length,
    maskCount: clip.masks.length,
    keyframeProperties: keyframes,
  };
}

export const readContextTool = {
  name: 'readContext',
  description:
    'Read the open project, sequence summary, editor selection, playhead and analysis counts.',
  input: emptyInput,
  readOnly: true,
  execute(context: ToolContext) {
    const snapshot = requireSnapshot(context);
    const sequence = snapshot.project.sequence;
    return {
      project: {
        id: snapshot.project.id,
        name: snapshot.project.name,
        width: sequence.width,
        height: sequence.height,
        frameRate: sequence.frameRate,
        fps: fpsToNumber(sequence.frameRate),
        durationFrames: sequenceDurationFrames(sequence),
        trackCount: sequence.tracks.length,
        markerCount: sequence.markers.length,
      },
      editor: context.editor(),
      counts: {
        assets: snapshot.assets.length,
        transcripts: snapshot.transcripts.length,
        scenes: snapshot.scenes.length,
        beatMaps: snapshot.beatMaps.length,
        referenceProfiles: snapshot.referenceProfiles.length,
        compositions: snapshot.compositions.length,
      },
      reference: sequence.reference
        ? {
            id: sequence.reference.id,
            name: sequence.reference.name,
          }
        : null,
    };
  },
};

export const readAssetsTool = {
  name: 'readAssets',
  description:
    'List footage in the project with duration, dimensions, stream flags and analysis availability.',
  input: z
    .object({
      kind: assetKindSchema.optional(),
      limit: z.number().int().positive().max(200).default(100),
    })
    .default({ limit: 100 }),
  readOnly: true,
  execute(
    context: ToolContext,
    input: { kind?: z.infer<typeof assetKindSchema>; limit: number },
  ) {
    const snapshot = requireSnapshot(context);
    const assets = snapshot.assets
      .filter((asset) => !input.kind || asset.kind === input.kind)
      .slice(0, input.limit)
      .map((asset) => ({
        ...assetSummary(asset),
        sceneCount: snapshot.scenes.filter(
          (scene) => scene.assetId === asset.id,
        ).length,
        hasTranscript: snapshot.transcripts.some(
          (transcript) => transcript.assetId === asset.id,
        ),
        hasBeatMap: snapshot.beatMaps.some(
          (beatMap) => beatMap.assetId === asset.id,
        ),
      }));
    return { assets, total: assets.length };
  },
};

export const readAssetTool = {
  name: 'readAsset',
  description:
    'Read one asset by id or exact name, including its transcript, scenes and beat map.',
  input: z
    .object({
      assetId: z.string().min(1).optional(),
      name: z.string().min(1).optional(),
    })
    .refine((input) => Boolean(input.assetId || input.name), {
      message: 'Pass assetId or name.',
    }),
  readOnly: true,
  execute(context: ToolContext, input: { assetId?: string; name?: string }) {
    const snapshot = requireSnapshot(context);
    const asset = input.assetId
      ? snapshot.assets.find((candidate) => candidate.id === input.assetId)
      : snapshot.assets.find(
          (candidate) =>
            candidate.name.toLocaleLowerCase() ===
            input.name?.toLocaleLowerCase(),
        );
    if (!asset) {
      throw new Error('That asset is not in the open project.');
    }
    const transcript =
      snapshot.transcripts.find(
        (candidate) => candidate.assetId === asset.id,
      ) ?? null;
    const scenes = snapshot.scenes
      .filter((candidate) => candidate.assetId === asset.id)
      .sort((left, right) => left.startFrame - right.startFrame);
    const beatMap =
      snapshot.beatMaps.find((candidate) => candidate.assetId === asset.id) ??
      null;
    return {
      asset: assetSummary(asset),
      transcript: transcript ? transcriptSummary(transcript) : null,
      scenes: scenes.map(sceneSummary),
      beatMap: beatMap
        ? {
            id: beatMap.id,
            bpm: beatMap.bpm,
            offsetFrames: beatMap.offsetFrames,
            beatCount: beatMap.beats.length,
            sectionCount: beatMap.sections.length,
          }
        : null,
    };
  },
};

export const readTimelineTool = {
  name: 'readTimeline',
  description:
    'Read tracks, clips and markers in timeline order, including timing and effect counts.',
  input: z
    .object({
      includeMarkers: z.boolean().default(true),
    })
    .default({ includeMarkers: true }),
  readOnly: true,
  execute(context: ToolContext, input: { includeMarkers: boolean }) {
    const snapshot = requireSnapshot(context);
    const sequence = snapshot.project.sequence;
    const tracks = tracksInOrder(sequence).map((track) => ({
      id: track.id,
      name: track.name,
      kind: track.kind,
      order: track.order,
      locked: track.locked,
      muted: track.muted,
      hidden: track.hidden,
      clips: [...track.clips]
        .sort((left, right) => left.startFrame - right.startFrame)
        .map(clipSummary),
    }));
    return {
      sequence: {
        id: sequence.id,
        name: sequence.name,
        width: sequence.width,
        height: sequence.height,
        frameRate: sequence.frameRate,
        durationFrames: sequenceDurationFrames(sequence),
      },
      tracks,
      markers: input.includeMarkers
        ? [...sequence.markers].sort((left, right) => left.frame - right.frame)
        : [],
    };
  },
};

export const readTranscriptTool = {
  name: 'readTranscript',
  description:
    'Read the transcript for an asset or transcript id, with optional frame window and word timings.',
  input: z
    .object({
      assetId: z.string().min(1).optional(),
      transcriptId: z.string().min(1).optional(),
      startFrame: frameSchema.optional(),
      endFrame: frameSchema.optional(),
      includeWords: z.boolean().default(true),
      maxSegments: z.number().int().positive().max(1_000).default(200),
    })
    .refine((input) => Boolean(input.assetId || input.transcriptId), {
      message: 'Pass assetId or transcriptId.',
    }),
  readOnly: true,
  execute(
    context: ToolContext,
    input: {
      assetId?: string;
      transcriptId?: string;
      startFrame?: number;
      endFrame?: number;
      includeWords: boolean;
      maxSegments: number;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const transcript = input.transcriptId
      ? snapshot.transcripts.find(
          (candidate) => candidate.id === input.transcriptId,
        )
      : snapshot.transcripts.find(
          (candidate) => candidate.assetId === input.assetId,
        );
    if (!transcript) {
      throw new Error('No transcript is available for that asset.');
    }
    const startFrame = input.startFrame ?? 0;
    const endFrame = input.endFrame ?? Number.MAX_SAFE_INTEGER;
    const segments = transcript.segments
      .filter(
        (segment) =>
          segment.endFrame >= startFrame && segment.startFrame <= endFrame,
      )
      .slice(0, input.maxSegments)
      .map((segment) => ({
        id: segment.id,
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
        text: segment.text,
        words: input.includeWords
          ? segment.words.filter(
              (word) =>
                word.endFrame >= startFrame && word.startFrame <= endFrame,
            )
          : [],
      }));
    return {
      transcript: transcriptSummary(transcript),
      segments,
      window: { startFrame, endFrame },
    };
  },
};

export const findInTranscriptTool = {
  name: 'findInTranscript',
  description:
    'Search transcript and scene text. Returns matching moments with asset and frame ranges.',
  input: z.object({
    query: z.string().trim().min(1),
    limit: z.number().int().positive().max(50).default(10),
  }),
  readOnly: true,
  execute(context: ToolContext, input: { query: string; limit: number }) {
    requireSnapshot(context);
    return context.search({ query: input.query, limit: input.limit });
  },
};

export const renderFrameTool = {
  name: 'renderFrame',
  description:
    'Render one composited sequence frame through the open preview and return a local PNG path.',
  input: z.object({
    frame: frameSchema,
    maxWidth: z.number().int().positive().max(4_096).optional(),
  }),
  readOnly: true,
  async execute(
    context: ToolContext,
    input: { frame: number; maxWidth?: number },
  ) {
    const renderer = context.renderer();
    if (!renderer) {
      throw new Error(
        'Frame rendering is unavailable until the editor preview is open.',
      );
    }
    return renderer.renderFrame(input);
  },
};

export const readDurationTool = {
  name: 'readDuration',
  description:
    'Read the sequence duration or one asset duration in frames, seconds and timecode.',
  input: z
    .object({
      assetId: z.string().min(1).optional(),
    })
    .default({}),
  readOnly: true,
  execute(context: ToolContext, input: { assetId?: string }) {
    const snapshot = requireSnapshot(context);
    const sequence = snapshot.project.sequence;
    if (!input.assetId) {
      const frames = sequenceDurationFrames(sequence);
      const fps = fpsToNumber(sequence.frameRate);
      return {
        scope: 'sequence',
        frames,
        seconds: frames / fps,
        frameRate: sequence.frameRate,
      };
    }
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new Error('That asset is not in the open project.');
    }
    return {
      scope: 'asset',
      frames: assetDurationFrames(asset),
      seconds: asset.durationSeconds,
      frameRate: asset.frameRate,
    };
  },
};

export const listEffectsTool = {
  name: 'listEffects',
  description:
    'List supported effect types, mask types, blend modes, image fits and animatable properties.',
  input: emptyInput,
  readOnly: true,
  execute() {
    return {
      effects: effectTypeSchema.options,
      masks: maskTypeSchema.options,
      blendModes: blendModeSchema.options,
      fits: fitSchema.options,
      keyframeProperties: [
        'x',
        'y',
        'scale',
        'rotation',
        'opacity',
        'volume',
      ] as const,
    };
  },
};

export const READ_TOOLS = [
  readContextTool,
  readAssetsTool,
  readAssetTool,
  readTimelineTool,
  readTranscriptTool,
  findInTranscriptTool,
  renderFrameTool,
  readDurationTool,
  listEffectsTool,
];
