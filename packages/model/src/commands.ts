import { z } from 'zod';
import {
  captionWordSchema,
  clipSchema,
  fadeSchema,
  fitSchema,
  shapeKindSchema,
  textStyleSchema,
  timeMapSchema,
} from './clips';
import {
  blendModeSchema,
  effectPatchSchema,
  effectSchema,
  maskPatchSchema,
  maskSchema,
} from './effects';
import { idSchema, newId } from './ids';
import type { CommandId } from './ids';
import { numberKeyframesSchema, transformSchema } from './keyframes';
import {
  markerKindSchema,
  markerSchema,
  trackKindSchema,
  trackSchema,
} from './sequence';
import { frameRateSchema } from './time';
import {
  hexColorSchema,
  referenceProfileSchema,
  styleConfigSchema,
} from './style';

export const clipPatchSchema = z.object({
  trackId: idSchema('track').optional(),
  startFrame: z.number().int().nonnegative().optional(),
  durationFrames: z.number().int().positive().optional(),
  label: z.string().optional(),
  locked: z.boolean().optional(),
  transform: transformSchema.optional(),
  blendMode: blendModeSchema.optional(),
  assetId: idSchema('asset').optional(),
  sourceInFrame: z.number().int().nonnegative().optional(),
  speed: z.number().positive().max(16).optional(),
  volume: z.number().min(0).max(4).optional(),
  fade: fadeSchema.optional(),
  timeMap: timeMapSchema.optional(),
  fit: fitSchema.optional(),
  text: z.string().optional(),
  style: textStyleSchema.optional(),
  words: z.array(captionWordSchema).optional(),
  shape: shapeKindSchema.optional(),
  width: z.number().positive().max(4).optional(),
  height: z.number().positive().max(4).optional(),
  fill: z.string().min(1).optional(),
  stroke: z.string().nullable().optional(),
  strokeWidth: z.number().nonnegative().optional(),
  path: z.string().nullable().optional(),
  compositionId: idSchema('composition').optional(),
  name: z.string().optional(),
});

export type ClipPatch = z.infer<typeof clipPatchSchema>;

export const trackPatchSchema = z.object({
  name: z.string().min(1).optional(),
  kind: trackKindSchema.optional(),
  order: z.number().int().nonnegative().optional(),
  locked: z.boolean().optional(),
  muted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  height: z.number().int().min(32).max(160).optional(),
});

export type TrackPatch = z.infer<typeof trackPatchSchema>;

export const markerPatchSchema = z.object({
  frame: z.number().int().nonnegative().optional(),
  label: z.string().optional(),
  kind: markerKindSchema.optional(),
  color: hexColorSchema.optional(),
});

export type MarkerPatch = z.infer<typeof markerPatchSchema>;

export const clipInsertCommandSchema = z.object({
  type: z.literal('clip.insert'),
  clip: clipSchema,
  index: z.number().int().nonnegative().optional(),
});

export const clipRemoveCommandSchema = z.object({
  type: z.literal('clip.remove'),
  clipId: idSchema('clip'),
});

export const clipUpdateCommandSchema = z.object({
  type: z.literal('clip.update'),
  clipId: idSchema('clip'),
  patch: clipPatchSchema,
});

export const clipMoveCommandSchema = z.object({
  type: z.literal('clip.move'),
  clipId: idSchema('clip'),
  trackId: idSchema('track').optional(),
  startFrame: z.number().int().nonnegative(),
});

export const clipTrimCommandSchema = z.object({
  type: z.literal('clip.trim'),
  clipId: idSchema('clip'),
  edge: z.enum(['in', 'out']),
  frames: z.number().int(),
});

export const clipSplitCommandSchema = z.object({
  type: z.literal('clip.split'),
  clipId: idSchema('clip'),
  frame: z.number().int().nonnegative(),
});

export const clipDuplicateCommandSchema = z.object({
  type: z.literal('clip.duplicate'),
  clipId: idSchema('clip'),
  trackId: idSchema('track').optional(),
  offsetFrames: z.number().int().default(0),
});

export const clipSetSpeedCommandSchema = z.object({
  type: z.literal('clip.setSpeed'),
  clipId: idSchema('clip'),
  speed: z.number().positive().max(16),
});

export const clipSetTimeMapCommandSchema = z.object({
  type: z.literal('clip.setTimeMap'),
  clipId: idSchema('clip'),
  points: timeMapSchema,
});

export const clipSetKeyframesCommandSchema = z.object({
  type: z.literal('clip.setKeyframes'),
  clipId: idSchema('clip'),
  property: z.enum(['x', 'y', 'scale', 'rotation', 'opacity', 'volume']),
  keyframes: numberKeyframesSchema,
});

export const clipAddEffectCommandSchema = z.object({
  type: z.literal('clip.addEffect'),
  clipId: idSchema('clip'),
  effect: effectSchema,
});

export const clipUpdateEffectCommandSchema = z.object({
  type: z.literal('clip.updateEffect'),
  clipId: idSchema('clip'),
  effectId: idSchema('effect'),
  patch: effectPatchSchema,
});

export const clipRemoveEffectCommandSchema = z.object({
  type: z.literal('clip.removeEffect'),
  clipId: idSchema('clip'),
  effectId: idSchema('effect'),
});

export const clipAddMaskCommandSchema = z.object({
  type: z.literal('clip.addMask'),
  clipId: idSchema('clip'),
  mask: maskSchema,
});

export const clipUpdateMaskCommandSchema = z.object({
  type: z.literal('clip.updateMask'),
  clipId: idSchema('clip'),
  maskId: idSchema('mask'),
  patch: maskPatchSchema,
});

export const clipRemoveMaskCommandSchema = z.object({
  type: z.literal('clip.removeMask'),
  clipId: idSchema('clip'),
  maskId: idSchema('mask'),
});

export const sequenceRenameCommandSchema = z.object({
  type: z.literal('sequence.rename'),
  name: z.string().min(1),
});

export const sequenceSetCanvasCommandSchema = z.object({
  type: z.literal('sequence.setCanvas'),
  width: z.number().int().min(16).max(16_384),
  height: z.number().int().min(16).max(16_384),
  frameRate: frameRateSchema.optional(),
});

export const sequenceSetStyleCommandSchema = z.object({
  type: z.literal('sequence.setStyle'),
  style: styleConfigSchema.partial(),
});

export const sequenceSetReferenceCommandSchema = z.object({
  type: z.literal('sequence.setReference'),
  reference: referenceProfileSchema.nullable(),
});

export const trackAddCommandSchema = z.object({
  type: z.literal('track.add'),
  track: trackSchema,
});

export const trackRemoveCommandSchema = z.object({
  type: z.literal('track.remove'),
  trackId: idSchema('track'),
});

export const trackUpdateCommandSchema = z.object({
  type: z.literal('track.update'),
  trackId: idSchema('track'),
  patch: trackPatchSchema,
});

export const trackReorderCommandSchema = z.object({
  type: z.literal('track.reorder'),
  trackId: idSchema('track'),
  toIndex: z.number().int().nonnegative(),
});

export const markerAddCommandSchema = z.object({
  type: z.literal('marker.add'),
  marker: markerSchema,
});

export const markerUpdateCommandSchema = z.object({
  type: z.literal('marker.update'),
  markerId: idSchema('marker'),
  patch: markerPatchSchema,
});

export const markerRemoveCommandSchema = z.object({
  type: z.literal('marker.remove'),
  markerId: idSchema('marker'),
});

export const COMMAND_SCHEMAS = {
  'clip.insert': clipInsertCommandSchema,
  'clip.remove': clipRemoveCommandSchema,
  'clip.update': clipUpdateCommandSchema,
  'clip.move': clipMoveCommandSchema,
  'clip.trim': clipTrimCommandSchema,
  'clip.split': clipSplitCommandSchema,
  'clip.duplicate': clipDuplicateCommandSchema,
  'clip.setSpeed': clipSetSpeedCommandSchema,
  'clip.setTimeMap': clipSetTimeMapCommandSchema,
  'clip.setKeyframes': clipSetKeyframesCommandSchema,
  'clip.addEffect': clipAddEffectCommandSchema,
  'clip.updateEffect': clipUpdateEffectCommandSchema,
  'clip.removeEffect': clipRemoveEffectCommandSchema,
  'clip.addMask': clipAddMaskCommandSchema,
  'clip.updateMask': clipUpdateMaskCommandSchema,
  'clip.removeMask': clipRemoveMaskCommandSchema,
  'sequence.rename': sequenceRenameCommandSchema,
  'sequence.setCanvas': sequenceSetCanvasCommandSchema,
  'sequence.setStyle': sequenceSetStyleCommandSchema,
  'sequence.setReference': sequenceSetReferenceCommandSchema,
  'track.add': trackAddCommandSchema,
  'track.remove': trackRemoveCommandSchema,
  'track.update': trackUpdateCommandSchema,
  'track.reorder': trackReorderCommandSchema,
  'marker.add': markerAddCommandSchema,
  'marker.update': markerUpdateCommandSchema,
  'marker.remove': markerRemoveCommandSchema,
} as const;

export type SchemaCommandType = keyof typeof COMMAND_SCHEMAS;
export type CommandType = SchemaCommandType | 'batch';

export const COMMAND_TYPES: readonly CommandType[] = [
  ...(Object.keys(COMMAND_SCHEMAS) as SchemaCommandType[]),
  'batch',
];

export type ClipInsertCommand = z.infer<typeof clipInsertCommandSchema>;
export type ClipRemoveCommand = z.infer<typeof clipRemoveCommandSchema>;
export type ClipUpdateCommand = z.infer<typeof clipUpdateCommandSchema>;
export type ClipMoveCommand = z.infer<typeof clipMoveCommandSchema>;
export type ClipTrimCommand = z.infer<typeof clipTrimCommandSchema>;
export type ClipSplitCommand = z.infer<typeof clipSplitCommandSchema>;
export type ClipDuplicateCommand = z.infer<typeof clipDuplicateCommandSchema>;
export type ClipSetSpeedCommand = z.infer<typeof clipSetSpeedCommandSchema>;
export type ClipSetTimeMapCommand = z.infer<typeof clipSetTimeMapCommandSchema>;
export type ClipSetKeyframesCommand = z.infer<
  typeof clipSetKeyframesCommandSchema
>;
export type ClipAddEffectCommand = z.infer<typeof clipAddEffectCommandSchema>;
export type ClipUpdateEffectCommand = z.infer<
  typeof clipUpdateEffectCommandSchema
>;
export type ClipRemoveEffectCommand = z.infer<
  typeof clipRemoveEffectCommandSchema
>;
export type ClipAddMaskCommand = z.infer<typeof clipAddMaskCommandSchema>;
export type ClipUpdateMaskCommand = z.infer<typeof clipUpdateMaskCommandSchema>;
export type ClipRemoveMaskCommand = z.infer<typeof clipRemoveMaskCommandSchema>;
export type SequenceRenameCommand = z.infer<typeof sequenceRenameCommandSchema>;
export type SequenceSetCanvasCommand = z.infer<
  typeof sequenceSetCanvasCommandSchema
>;
export type SequenceSetStyleCommand = z.infer<
  typeof sequenceSetStyleCommandSchema
>;
export type SequenceSetReferenceCommand = z.infer<
  typeof sequenceSetReferenceCommandSchema
>;
export type TrackAddCommand = z.infer<typeof trackAddCommandSchema>;
export type TrackRemoveCommand = z.infer<typeof trackRemoveCommandSchema>;
export type TrackUpdateCommand = z.infer<typeof trackUpdateCommandSchema>;
export type TrackReorderCommand = z.infer<typeof trackReorderCommandSchema>;
export type MarkerAddCommand = z.infer<typeof markerAddCommandSchema>;
export type MarkerUpdateCommand = z.infer<typeof markerUpdateCommandSchema>;
export type MarkerRemoveCommand = z.infer<typeof markerRemoveCommandSchema>;

export interface BatchCommand {
  type: 'batch';
  label?: string;
  commands: EditCommand[];
}

export type EditCommand =
  | ClipInsertCommand
  | ClipRemoveCommand
  | ClipUpdateCommand
  | ClipMoveCommand
  | ClipTrimCommand
  | ClipSplitCommand
  | ClipDuplicateCommand
  | ClipSetSpeedCommand
  | ClipSetTimeMapCommand
  | ClipSetKeyframesCommand
  | ClipAddEffectCommand
  | ClipUpdateEffectCommand
  | ClipRemoveEffectCommand
  | ClipAddMaskCommand
  | ClipUpdateMaskCommand
  | ClipRemoveMaskCommand
  | SequenceRenameCommand
  | SequenceSetCanvasCommand
  | SequenceSetStyleCommand
  | SequenceSetReferenceCommand
  | TrackAddCommand
  | TrackRemoveCommand
  | TrackUpdateCommand
  | TrackReorderCommand
  | MarkerAddCommand
  | MarkerUpdateCommand
  | MarkerRemoveCommand
  | BatchCommand;

export const editCommandSchema = z.lazy(() =>
  z.discriminatedUnion('type', [
    clipInsertCommandSchema,
    clipRemoveCommandSchema,
    clipUpdateCommandSchema,
    clipMoveCommandSchema,
    clipTrimCommandSchema,
    clipSplitCommandSchema,
    clipDuplicateCommandSchema,
    clipSetSpeedCommandSchema,
    clipSetTimeMapCommandSchema,
    clipSetKeyframesCommandSchema,
    clipAddEffectCommandSchema,
    clipUpdateEffectCommandSchema,
    clipRemoveEffectCommandSchema,
    clipAddMaskCommandSchema,
    clipUpdateMaskCommandSchema,
    clipRemoveMaskCommandSchema,
    sequenceRenameCommandSchema,
    sequenceSetCanvasCommandSchema,
    sequenceSetStyleCommandSchema,
    sequenceSetReferenceCommandSchema,
    trackAddCommandSchema,
    trackRemoveCommandSchema,
    trackUpdateCommandSchema,
    trackReorderCommandSchema,
    markerAddCommandSchema,
    markerUpdateCommandSchema,
    markerRemoveCommandSchema,
    z.object({
      type: z.literal('batch'),
      label: z.string().optional(),
      commands: z.array(editCommandSchema),
    }),
  ]),
) as unknown as z.ZodType<EditCommand>;

export const actorSchema = z.enum(['user', 'agent', 'mcp', 'system']);
export type Actor = z.infer<typeof actorSchema>;

export const editCommandEnvelopeSchema = z.object({
  id: idSchema('command'),
  actor: actorSchema.default('user'),
  label: z.string().default(''),
  command: editCommandSchema,
  createdAt: z.number().int().nonnegative(),
});

export type EditCommandEnvelope = z.infer<typeof editCommandEnvelopeSchema>;

export interface CreateCommandEnvelopeInput {
  command: EditCommand;
  actor?: Actor;
  label?: string;
  now?: number;
}

export function createCommandEnvelope(
  input: CreateCommandEnvelopeInput,
): EditCommandEnvelope {
  return editCommandEnvelopeSchema.parse({
    id: newId('command') as CommandId,
    actor: input.actor,
    label: input.label ?? '',
    command: input.command,
    createdAt: input.now ?? Date.now(),
  });
}

/** Human-readable labels for menus, logs and undo history. */
export function commandLabel(command: EditCommand): string {
  switch (command.type) {
    case 'clip.insert':
      return 'Insert clip';
    case 'clip.remove':
      return 'Remove clip';
    case 'clip.update':
      return 'Update clip';
    case 'clip.move':
      return 'Move clip';
    case 'clip.trim':
      return 'Trim clip';
    case 'clip.split':
      return 'Split clip';
    case 'clip.duplicate':
      return 'Duplicate clip';
    case 'clip.setSpeed':
      return 'Set clip speed';
    case 'clip.setTimeMap':
      return 'Set time map';
    case 'clip.setKeyframes':
      return 'Set keyframes';
    case 'clip.addEffect':
      return 'Add effect';
    case 'clip.updateEffect':
      return 'Update effect';
    case 'clip.removeEffect':
      return 'Remove effect';
    case 'clip.addMask':
      return 'Add mask';
    case 'clip.updateMask':
      return 'Update mask';
    case 'clip.removeMask':
      return 'Remove mask';
    case 'sequence.rename':
      return 'Rename sequence';
    case 'sequence.setCanvas':
      return 'Set canvas';
    case 'sequence.setStyle':
      return 'Set style';
    case 'sequence.setReference':
      return 'Set reference';
    case 'track.add':
      return 'Add track';
    case 'track.remove':
      return 'Remove track';
    case 'track.update':
      return 'Update track';
    case 'track.reorder':
      return 'Reorder tracks';
    case 'marker.add':
      return 'Add marker';
    case 'marker.update':
      return 'Update marker';
    case 'marker.remove':
      return 'Remove marker';
    case 'batch':
      return command.label ?? `Batch · ${command.commands.length} edits`;
    default: {
      const exhaustive: never = command;
      return exhaustive;
    }
  }
}
