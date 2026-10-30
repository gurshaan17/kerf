import { z } from 'zod';
import { blendModeSchema, effectSchema, maskSchema } from './effects';
import { idSchema } from './ids';
import {
  numberKeyframesSchema,
  transformSchema,
  DEFAULT_TRANSFORM,
} from './keyframes';
import { overlayPropsSchema } from './overlays';
import { textAlignSchema } from './style';

export const fadeSchema = z
  .object({
    inFrames: z.number().int().nonnegative().default(0),
    outFrames: z.number().int().nonnegative().default(0),
  })
  .default({ inFrames: 0, outFrames: 0 });

export type Fade = z.infer<typeof fadeSchema>;

export const timeMapPointSchema = z.object({
  frame: z.number().int().nonnegative(),
  sourceFrame: z.number().int().nonnegative(),
});

export type TimeMapPoint = z.infer<typeof timeMapPointSchema>;

/**
 * A time map replaces the linear source mapping for a clip. Points are ordered
 * by timeline frame; source frames may run backwards for reversed footage.
 */
export const timeMapSchema = z
  .array(timeMapPointSchema)
  .refine(
    (points) =>
      points.every(
        (point, index) =>
          index === 0 ||
          point.frame > (points[index - 1]?.frame ?? Number.POSITIVE_INFINITY),
      ),
    { message: 'Time map points must be ordered by timeline frame' },
  )
  .default([]);

export type TimeMap = z.infer<typeof timeMapSchema>;

export const clipKeyframesSchema = z
  .object({
    x: numberKeyframesSchema.default([]),
    y: numberKeyframesSchema.default([]),
    scale: numberKeyframesSchema.default([]),
    rotation: numberKeyframesSchema.default([]),
    opacity: numberKeyframesSchema.default([]),
    volume: numberKeyframesSchema.default([]),
  })
  .default({
    x: [],
    y: [],
    scale: [],
    rotation: [],
    opacity: [],
    volume: [],
  });

export type ClipKeyframes = z.infer<typeof clipKeyframesSchema>;

export const textStyleSchema = z.object({
  fontFamily: z.string().min(1).default('Instrument Sans'),
  fontSize: z.number().positive().default(48),
  fontWeight: z.number().int().min(100).max(900).default(600),
  color: z.string().min(1).default('#ece6dc'),
  background: z.string().nullable().default(null),
  align: textAlignSchema.default('center'),
  lineHeight: z.number().positive().default(1.2),
  letterSpacing: z.number().finite().default(0),
  padding: z.number().nonnegative().default(12),
});

export type TextStyle = z.infer<typeof textStyleSchema>;
export const DEFAULT_TEXT_STYLE: TextStyle = textStyleSchema.parse({});

const clipBaseShape = {
  id: idSchema('clip'),
  trackId: idSchema('track'),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  label: z.string().default(''),
  locked: z.boolean().default(false),
  transform: transformSchema.default(DEFAULT_TRANSFORM),
  blendMode: blendModeSchema.default('normal'),
  effects: z.array(effectSchema).default([]),
  masks: z.array(maskSchema).default([]),
  keyframes: clipKeyframesSchema,
};

export const videoClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('video'),
  assetId: idSchema('asset'),
  sourceInFrame: z.number().int().nonnegative().default(0),
  speed: z.number().positive().max(16).default(1),
  volume: z.number().min(0).max(4).default(1),
  fade: fadeSchema,
  timeMap: timeMapSchema,
});

export type VideoClip = z.infer<typeof videoClipSchema>;

export const audioClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('audio'),
  assetId: idSchema('asset'),
  sourceInFrame: z.number().int().nonnegative().default(0),
  speed: z.number().positive().max(16).default(1),
  volume: z.number().min(0).max(4).default(1),
  fade: fadeSchema,
  timeMap: timeMapSchema,
});

export type AudioClip = z.infer<typeof audioClipSchema>;

export const fitSchema = z.enum(['contain', 'cover', 'fill']);
export type Fit = z.infer<typeof fitSchema>;

export const imageClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('image'),
  assetId: idSchema('asset'),
  fit: fitSchema.default('contain'),
});

export type ImageClip = z.infer<typeof imageClipSchema>;

export const textClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('text'),
  text: z.string().default(''),
  style: textStyleSchema.default(DEFAULT_TEXT_STYLE),
});

export type TextClip = z.infer<typeof textClipSchema>;

export const captionWordSchema = z
  .object({
    text: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).default(1),
  })
  .refine((word) => word.endFrame >= word.startFrame, {
    message: 'A caption word cannot end before it starts',
  });

export type CaptionWord = z.infer<typeof captionWordSchema>;

export const captionClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('caption'),
  transcriptId: idSchema('transcript'),
  segmentId: idSchema('segment'),
  generatedFromTranscript: z.boolean().optional(),
  transcriptRevision: z.number().int().nonnegative().optional(),
  text: z.string().default(''),
  words: z.array(captionWordSchema).default([]),
  style: textStyleSchema.default(DEFAULT_TEXT_STYLE),
});

export type CaptionClip = z.infer<typeof captionClipSchema>;

export const shapeKindSchema = z.enum(['rect', 'ellipse', 'path']);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

/**
 * Shape dimensions are fractions of the canvas, so a composition survives a
 * change from landscape to vertical without manual rescaling.
 */
export const shapeClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('shape'),
  shape: shapeKindSchema.default('rect'),
  width: z.number().positive().max(4).default(0.4),
  height: z.number().positive().max(4).default(0.2),
  fill: z.string().min(1).default('#c9a46a'),
  stroke: z.string().nullable().default(null),
  strokeWidth: z.number().nonnegative().default(0),
  path: z.string().nullable().default(null),
});

export type ShapeClip = z.infer<typeof shapeClipSchema>;

export const compositionClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('composition'),
  compositionId: idSchema('composition'),
  name: z.string().min(1).default('Composition'),
});

export type CompositionClip = z.infer<typeof compositionClipSchema>;

/**
 * A timed effect overlay lives on an Effects track. Its visual parameters sit
 * under `props` so they cannot collide with the flat shape clip fields.
 */
export const fxOverlayClipSchema = z.object({
  ...clipBaseShape,
  type: z.literal('fxOverlay'),
  linkedItemId: idSchema('clip').nullable().default(null),
  props: overlayPropsSchema,
});

export type FxOverlayClip = z.infer<typeof fxOverlayClipSchema>;

export const clipSchema = z.discriminatedUnion('type', [
  videoClipSchema,
  audioClipSchema,
  imageClipSchema,
  textClipSchema,
  captionClipSchema,
  shapeClipSchema,
  compositionClipSchema,
  fxOverlayClipSchema,
]);

export type Clip = z.infer<typeof clipSchema>;
export type ClipType = Clip['type'];
export type MediaClip = VideoClip | AudioClip;
export type VisualClip = Exclude<Clip, AudioClip>;

export function clipEndFrame(clip: Clip): number {
  return clip.startFrame + clip.durationFrames;
}

export function isMediaClip(clip: Clip): clip is MediaClip {
  return clip.type === 'video' || clip.type === 'audio';
}

export function isVisualClip(clip: Clip): clip is VisualClip {
  return clip.type !== 'audio';
}

export function isFxOverlayClip(clip: Clip): clip is FxOverlayClip {
  return clip.type === 'fxOverlay';
}
