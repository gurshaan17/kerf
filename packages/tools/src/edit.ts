import { z } from 'zod';
import type {
  Asset,
  AssetId,
  Clip,
  ClipId,
  EditCommand,
  FrameRate,
  Sequence,
  Track,
  TrackId,
} from '@kerf/model';
import {
  DEFAULT_TEXT_STYLE,
  clipPatchSchema,
  clipSchema,
  createMarker,
  editCommandSchema,
  fitSchema,
  idSchema,
  markerKindSchema,
  newId,
  numberKeyframesSchema,
  secondsToFrames,
  textStyleSchema,
  timeMapSchema,
} from '@kerf/model';
import { findClip, sequenceDurationFrames, tracksInOrder } from '@kerf/engine';
import type { ToolContext, ToolEditResult } from './types';

const FALLBACK_CLIP_SECONDS = 5;
const FALLBACK_TEXT_SECONDS = 3;

const clipIdSchema = idSchema('clip');
const assetIdSchema = idSchema('asset');
const trackIdSchema = idSchema('track');

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

function sourceDurationFrames(asset: Asset, rate: FrameRate): number {
  return Math.max(
    1,
    secondsToFrames(asset.durationSeconds, asset.frameRate ?? rate, 'floor'),
  );
}

function clipDurationFrames(asset: Asset, rate: FrameRate): number {
  if (asset.kind === 'image') {
    return Math.max(
      1,
      Math.round(secondsToFrames(FALLBACK_CLIP_SECONDS, rate)),
    );
  }
  const timelineFrames = Math.max(
    1,
    secondsToFrames(asset.durationSeconds, rate, 'floor'),
  );
  return Math.min(timelineFrames, sourceDurationFrames(asset, rate));
}

function lockedTrackError(track: Track): Error {
  return new Error(`Track "${track.name}" is locked.`);
}

function preferredTrack(
  sequence: Sequence,
  kind: 'visual' | 'audio',
  requestedTrackId?: string,
): Track {
  const tracks = tracksInOrder(sequence);
  if (requestedTrackId) {
    const requested = tracks.find((track) => track.id === requestedTrackId);
    if (!requested) {
      throw new Error('That track is not in the sequence.');
    }
    if (requested.locked) {
      throw lockedTrackError(requested);
    }
    const compatible =
      kind === 'audio'
        ? requested.kind === 'audio'
        : requested.kind === 'video' ||
          requested.kind === 'overlay' ||
          requested.kind === 'caption';
    if (!compatible) {
      throw new Error(
        kind === 'audio'
          ? 'Audio can only be inserted on an audio track.'
          : 'Visual clips need a video, overlay or caption track.',
      );
    }
    return requested;
  }
  const match =
    kind === 'audio'
      ? tracks.find((track) => track.kind === 'audio' && !track.locked)
      : tracks.find(
          (track) =>
            (track.kind === 'video' ||
              track.kind === 'overlay' ||
              track.kind === 'caption') &&
            !track.locked,
        );
  if (!match) {
    throw new Error(
      kind === 'audio'
        ? 'Add an unlocked audio track first.'
        : 'Add an unlocked video or overlay track first.',
    );
  }
  return match;
}

function mediaClip(
  asset: Asset,
  track: Track,
  startFrame: number,
  sequence: Sequence,
): Clip {
  const base = {
    id: newId('clip'),
    trackId: track.id,
    startFrame: Math.max(0, Math.round(startFrame)),
    durationFrames: clipDurationFrames(asset, sequence.frameRate),
    label: asset.name,
  };
  if (asset.kind === 'video') {
    if (track.kind === 'audio') {
      throw new Error('Insert audio with insertAudio.');
    }
    return clipSchema.parse({
      ...base,
      type: 'video',
      assetId: asset.id,
    });
  }
  if (asset.kind === 'image') {
    if (track.kind === 'audio') {
      throw new Error('Images need a visual track.');
    }
    return clipSchema.parse({
      ...base,
      type: 'image',
      assetId: asset.id,
    });
  }
  if (asset.kind === 'audio') {
    if (track.kind !== 'audio') {
      throw new Error('Audio can only be inserted on an audio track.');
    }
    return clipSchema.parse({
      ...base,
      type: 'audio',
      assetId: asset.id,
    });
  }
  throw new Error('That asset cannot be placed on the timeline.');
}

function summary(result: ToolEditResult) {
  return {
    commandId: result.command.id,
    label: result.command.label,
    actor: result.command.actor,
    durationFrames: sequenceDurationFrames(result.snapshot.project.sequence),
    snapshotVersion: result.snapshot.project.updatedAt,
  };
}

function requireClip(sequence: Sequence, clipId: string) {
  const location = findClip(sequence, clipId);
  if (!location) {
    throw new Error('That clip is not in the sequence.');
  }
  return location;
}

export const insertClipTool = {
  name: 'insertClip',
  description:
    'Insert a video or image asset onto a visual track. Defaults to the playhead and the first compatible unlocked track.',
  input: z.object({
    assetId: assetIdSchema,
    trackId: trackIdSchema.optional(),
    startFrame: z.number().int().nonnegative().optional(),
    fit: fitSchema.optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      assetId: AssetId;
      trackId?: TrackId;
      startFrame?: number;
      fit?: z.infer<typeof fitSchema>;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new Error('That asset is not in the open project.');
    }
    if (asset.kind !== 'video' && asset.kind !== 'image') {
      throw new Error('Use insertAudio for audio assets.');
    }
    const track = preferredTrack(
      snapshot.project.sequence,
      'visual',
      input.trackId,
    );
    const startFrame = input.startFrame ?? context.editor().playheadFrame;
    const clip = mediaClip(asset, track, startFrame, snapshot.project.sequence);
    if (clip.type === 'image' && input.fit) {
      clip.fit = input.fit;
    }
    const result = context.apply(
      { type: 'clip.insert', clip },
      { label: `Insert ${asset.name}` },
    );
    return {
      ...summary(result),
      clipId: clip.id,
      trackId: track.id,
      startFrame: clip.startFrame,
      clipDurationFrames: clip.durationFrames,
    };
  },
};

export const insertAudioTool = {
  name: 'insertAudio',
  description:
    'Insert an audio asset onto an audio track at the playhead or a requested frame.',
  input: z.object({
    assetId: assetIdSchema,
    trackId: trackIdSchema.optional(),
    startFrame: z.number().int().nonnegative().optional(),
  }),
  execute(
    context: ToolContext,
    input: { assetId: AssetId; trackId?: TrackId; startFrame?: number },
  ) {
    const snapshot = requireSnapshot(context);
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === input.assetId,
    );
    if (!asset) {
      throw new Error('That asset is not in the open project.');
    }
    if (asset.kind !== 'audio') {
      throw new Error('Use insertClip for video and images.');
    }
    const track = preferredTrack(
      snapshot.project.sequence,
      'audio',
      input.trackId,
    );
    const clip = mediaClip(
      asset,
      track,
      input.startFrame ?? context.editor().playheadFrame,
      snapshot.project.sequence,
    );
    const result = context.apply(
      { type: 'clip.insert', clip },
      { label: `Insert ${asset.name}` },
    );
    return {
      ...summary(result),
      clipId: clip.id,
      trackId: track.id,
      startFrame: clip.startFrame,
      clipDurationFrames: clip.durationFrames,
    };
  },
};

export const insertTextTool = {
  name: 'insertText',
  description:
    'Insert a styled text clip at the playhead or a requested frame.',
  input: z.object({
    text: z.string().min(1),
    trackId: trackIdSchema.optional(),
    startFrame: z.number().int().nonnegative().optional(),
    durationFrames: z.number().int().positive().optional(),
    style: textStyleSchema.partial().optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      text: string;
      trackId?: TrackId;
      startFrame?: number;
      durationFrames?: number;
      style?: Partial<z.infer<typeof textStyleSchema>>;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const track = preferredTrack(
      snapshot.project.sequence,
      'visual',
      input.trackId,
    );
    const startFrame = input.startFrame ?? context.editor().playheadFrame;
    const durationFrames =
      input.durationFrames ??
      Math.max(
        1,
        Math.round(
          secondsToFrames(
            FALLBACK_TEXT_SECONDS,
            snapshot.project.sequence.frameRate,
          ),
        ),
      );
    const clip = clipSchema.parse({
      id: newId('clip'),
      trackId: track.id,
      startFrame,
      durationFrames,
      label: input.text.slice(0, 80),
      type: 'text',
      text: input.text,
      style: { ...DEFAULT_TEXT_STYLE, ...input.style },
    });
    const result = context.apply(
      { type: 'clip.insert', clip },
      { label: 'Insert text' },
    );
    return {
      ...summary(result),
      clipId: clip.id,
      trackId: track.id,
      startFrame,
      clipDurationFrames: durationFrames,
    };
  },
};

export const editClipTool = {
  name: 'editClip',
  description:
    'Update one clip with a patch: label, transform, effects, masks, keyframes, blend mode, fit, text or style.',
  input: z
    .object({
      clipId: clipIdSchema,
      patch: clipPatchSchema,
    })
    .refine((input) => Object.keys(input.patch).length > 0, {
      message: 'Pass at least one patch field.',
    }),
  execute(
    context: ToolContext,
    input: { clipId: ClipId; patch: z.infer<typeof clipPatchSchema> },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      { type: 'clip.update', clipId: input.clipId, patch: input.patch },
      { label: 'Edit clip' },
    );
    return { ...summary(result), clipId: input.clipId };
  },
};

export const moveClipTool = {
  name: 'moveClip',
  description:
    'Move a clip to a new start frame, optionally onto another track.',
  input: z.object({
    clipId: clipIdSchema,
    startFrame: z.number().int().nonnegative(),
    trackId: trackIdSchema.optional(),
  }),
  execute(
    context: ToolContext,
    input: { clipId: ClipId; startFrame: number; trackId?: TrackId },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      {
        type: 'clip.move',
        clipId: input.clipId,
        startFrame: input.startFrame,
        trackId: input.trackId,
      },
      { label: 'Move clip' },
    );
    return {
      ...summary(result),
      clipId: input.clipId,
      startFrame: input.startFrame,
    };
  },
};

export const trimClipTool = {
  name: 'trimClip',
  description:
    'Trim a clip edge by a frame delta. Positive values extend, negative values shorten.',
  input: z.object({
    clipId: clipIdSchema,
    edge: z.enum(['in', 'out']),
    frames: z.number().int(),
  }),
  execute(
    context: ToolContext,
    input: { clipId: ClipId; edge: 'in' | 'out'; frames: number },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      {
        type: 'clip.trim',
        clipId: input.clipId,
        edge: input.edge,
        frames: input.frames,
      },
      { label: 'Trim clip' },
    );
    return { ...summary(result), clipId: input.clipId };
  },
};

export const splitClipTool = {
  name: 'splitClip',
  description: 'Split one clip at an absolute sequence frame.',
  input: z.object({
    clipId: clipIdSchema,
    frame: z.number().int().nonnegative(),
  }),
  execute(context: ToolContext, input: { clipId: ClipId; frame: number }) {
    requireSnapshot(context);
    const result = context.apply(
      { type: 'clip.split', clipId: input.clipId, frame: input.frame },
      { label: 'Split clip' },
    );
    return { ...summary(result), clipId: input.clipId };
  },
};

export const duplicateClipTool = {
  name: 'duplicateClip',
  description:
    'Duplicate a clip, optionally on another track and offset in frames.',
  input: z.object({
    clipId: clipIdSchema,
    trackId: trackIdSchema.optional(),
    offsetFrames: z.number().int().default(0),
  }),
  execute(
    context: ToolContext,
    input: { clipId: ClipId; trackId?: TrackId; offsetFrames: number },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      {
        type: 'clip.duplicate',
        clipId: input.clipId,
        trackId: input.trackId,
        offsetFrames: input.offsetFrames,
      },
      { label: 'Duplicate clip' },
    );
    return { ...summary(result), sourceClipId: input.clipId };
  },
};

export const removeClipsTool = {
  name: 'removeClips',
  description:
    'Remove one or more clips as a single undo step. Gaps remain unless another tool closes them.',
  input: z.object({
    clipIds: z.array(clipIdSchema).min(1).max(200),
  }),
  execute(context: ToolContext, input: { clipIds: ClipId[] }) {
    const snapshot = requireSnapshot(context);
    const commands: EditCommand[] = input.clipIds.map((clipId) => {
      requireClip(snapshot.project.sequence, clipId);
      return { type: 'clip.remove', clipId };
    });
    const result =
      commands.length === 1
        ? context.apply(commands[0]!, {
            label: 'Remove clip',
          })
        : context.applyBatch(commands, {
            label: `Remove ${commands.length} clips`,
          });
    return { ...summary(result), removedClipIds: input.clipIds };
  },
};

export const slipClipTool = {
  name: 'slipClip',
  description:
    'Slip a media clip inside its source by a frame delta without moving it on the timeline.',
  input: z.object({
    clipId: clipIdSchema,
    deltaFrames: z.number().int(),
  }),
  execute(
    context: ToolContext,
    input: { clipId: ClipId; deltaFrames: number },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      {
        type: 'clip.slip',
        clipId: input.clipId,
        deltaFrames: input.deltaFrames,
      },
      { label: 'Slip clip' },
    );
    return { ...summary(result), clipId: input.clipId };
  },
};

export const setSpeedMapTool = {
  name: 'setSpeedMap',
  description:
    'Set constant speed and/or a time map for a media clip. Both changes form one undo step.',
  input: z
    .object({
      clipId: clipIdSchema,
      speed: z.number().positive().max(16).optional(),
      points: timeMapSchema.optional(),
    })
    .refine(
      (input) => input.speed !== undefined || input.points !== undefined,
      {
        message: 'Pass speed, points or both.',
      },
    ),
  execute(
    context: ToolContext,
    input: {
      clipId: ClipId;
      speed?: number;
      points?: z.infer<typeof timeMapSchema>;
    },
  ) {
    requireSnapshot(context);
    const commands: EditCommand[] = [];
    if (input.speed !== undefined) {
      commands.push({
        type: 'clip.setSpeed',
        clipId: input.clipId,
        speed: input.speed,
      });
    }
    if (input.points !== undefined) {
      commands.push({
        type: 'clip.setTimeMap',
        clipId: input.clipId,
        points: input.points,
      });
    }
    const result =
      commands.length === 1
        ? context.apply(commands[0]!, {
            label: 'Set speed',
          })
        : context.applyBatch(commands, {
            label: 'Set speed map',
          });
    return { ...summary(result), clipId: input.clipId };
  },
};

export const animatePropertyTool = {
  name: 'animateProperty',
  description:
    'Set keyframes for a clip transform, opacity or volume property.',
  input: z.object({
    clipId: clipIdSchema,
    property: z.enum(['x', 'y', 'scale', 'rotation', 'opacity', 'volume']),
    keyframes: numberKeyframesSchema,
  }),
  execute(
    context: ToolContext,
    input: {
      clipId: ClipId;
      property: 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';
      keyframes: z.infer<typeof numberKeyframesSchema>;
    },
  ) {
    requireSnapshot(context);
    const result = context.apply(
      {
        type: 'clip.setKeyframes',
        clipId: input.clipId,
        property: input.property,
        keyframes: input.keyframes,
      },
      { label: `Animate ${input.property}` },
    );
    return {
      ...summary(result),
      clipId: input.clipId,
      property: input.property,
      keyframeCount: input.keyframes.length,
    };
  },
};

export const markMomentTool = {
  name: 'markMoment',
  description: 'Add a marker or chapter point at a sequence frame.',
  input: z.object({
    frame: z.number().int().nonnegative().optional(),
    label: z.string().default(''),
    kind: markerKindSchema.default('marker'),
    color: z.string().optional(),
  }),
  execute(
    context: ToolContext,
    input: {
      frame?: number;
      label: string;
      kind: z.infer<typeof markerKindSchema>;
      color?: string;
    },
  ) {
    requireSnapshot(context);
    const marker = createMarker({
      frame: input.frame ?? context.editor().playheadFrame,
      label: input.label,
      kind: input.kind,
      color: input.color,
    });
    const result = context.apply(
      { type: 'marker.add', marker },
      { label: `Mark ${input.label || input.kind}` },
    );
    return { ...summary(result), markerId: marker.id, frame: marker.frame };
  },
};

export const applyBatchTool = {
  name: 'applyBatch',
  description:
    'Apply an ordered list of edit commands as one atomic undo step. Use this for compound edits.',
  input: z.object({
    label: z.string().default('Batch edit'),
    commands: z.array(editCommandSchema).min(1).max(200),
  }),
  execute(
    context: ToolContext,
    input: { label: string; commands: EditCommand[] },
  ) {
    requireSnapshot(context);
    const batch: EditCommand = {
      type: 'batch',
      label: input.label,
      commands: input.commands,
    };
    const result = context.apply(batch, { label: input.label });
    return {
      ...summary(result),
      commandCount: input.commands.length,
    };
  },
};

export const EDIT_TOOLS = [
  insertClipTool,
  insertAudioTool,
  insertTextTool,
  editClipTool,
  moveClipTool,
  trimClipTool,
  splitClipTool,
  duplicateClipTool,
  removeClipsTool,
  slipClipTool,
  setSpeedMapTool,
  animatePropertyTool,
  markMomentTool,
  applyBatchTool,
];
