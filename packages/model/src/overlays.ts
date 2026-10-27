import { z } from 'zod';
import { cssColorSchema, hexColorSchema } from './style';

export const overlayKindSchema = z.enum([
  'blur',
  'callout',
  'spotlight',
  'zoom',
]);

export type OverlayKind = z.infer<typeof overlayKindSchema>;

export const OVERLAY_KINDS = overlayKindSchema.options;

export const overlayShapeSchema = z.enum(['rect', 'ellipse']);

export type OverlayShape = z.infer<typeof overlayShapeSchema>;

export const overlayEasingSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
]);

export type OverlayEasing = z.infer<typeof overlayEasingSchema>;

/**
 * Regions are normalized to the canvas. Values may fall outside the canvas so
 * an overlay can sit partly off-screen; the renderer clips to the frame.
 */
export const normalizedRegionSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  w: z.number().positive().max(2),
  h: z.number().positive().max(2),
});

export type NormalizedRegion = z.infer<typeof normalizedRegionSchema>;

/**
 * A point normalized to the canvas. Used for callout pointers and zoom focus.
 */
export const normalizedPointSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
});

export type NormalizedPoint = z.infer<typeof normalizedPointSchema>;

const overlayCommonShape = {
  region: normalizedRegionSchema,
  shape: overlayShapeSchema.default('rect'),
  cornerRadius: z.number().nonnegative().default(0),
  transitionInFrames: z.number().int().nonnegative().default(0),
  transitionOutFrames: z.number().int().nonnegative().default(0),
  easing: overlayEasingSchema.default('ease-in-out'),
};

export const blurOverlayPropsSchema = z.object({
  ...overlayCommonShape,
  kind: z.literal('blur'),
  mode: z.enum(['gaussian', 'pixelate']).default('gaussian'),
  /** Blur radius or pixel block size in 1080p-height pixels. */
  amount: z.number().positive().max(200).default(24),
});

export type BlurOverlayProps = z.infer<typeof blurOverlayPropsSchema>;

export const calloutOverlayPropsSchema = z.object({
  ...overlayCommonShape,
  kind: z.literal('callout'),
  text: z.string().default('Callout'),
  textColor: hexColorSchema.default('#ece6dc'),
  background: cssColorSchema.default('rgba(11, 12, 13, 0.82)'),
  borderColor: hexColorSchema.default('#c9a46a'),
  borderWidth: z.number().nonnegative().default(3),
  /** Font size in 1080p-height pixels. */
  fontSize: z.number().positive().default(36),
  /** Optional pointer target; null draws no pointer. */
  pointer: normalizedPointSchema.nullable().default(null),
});

export type CalloutOverlayProps = z.infer<typeof calloutOverlayPropsSchema>;

export const spotlightOverlayPropsSchema = z.object({
  ...overlayCommonShape,
  kind: z.literal('spotlight'),
  dim: z.number().min(0).max(1).default(0.55),
  /** Feather radius in 1080p-height pixels. */
  feather: z.number().nonnegative().default(24),
  color: hexColorSchema.default('#000000'),
});

export type SpotlightOverlayProps = z.infer<typeof spotlightOverlayPropsSchema>;

export const zoomOverlayPropsSchema = z.object({
  ...overlayCommonShape,
  kind: z.literal('zoom'),
  zoom: z.number().positive().max(8).default(2),
  /** Content point held at the lens centre. Null uses the region centre. */
  focus: normalizedPointSchema.nullable().default(null),
  borderColor: hexColorSchema.default('#ece6dc'),
  borderWidth: z.number().nonnegative().default(4),
  shadow: z.boolean().default(true),
});

export type ZoomOverlayProps = z.infer<typeof zoomOverlayPropsSchema>;

export const overlayPropsSchema = z.discriminatedUnion('kind', [
  blurOverlayPropsSchema,
  calloutOverlayPropsSchema,
  spotlightOverlayPropsSchema,
  zoomOverlayPropsSchema,
]);

export type OverlayProps = z.infer<typeof overlayPropsSchema>;

const regionPatchSchema = z.object({
  x: z.number().min(-1).max(2).optional(),
  y: z.number().min(-1).max(2).optional(),
  w: z.number().positive().max(2).optional(),
  h: z.number().positive().max(2).optional(),
});

const pointPatchSchema = z.object({
  x: z.number().min(-1).max(2).optional(),
  y: z.number().min(-1).max(2).optional(),
});

/**
 * A partial overlay props patch. `kind` is included so the engine can reject a
 * change explicitly rather than silently dropping the field.
 */
export const overlayPropsPatchSchema = z.object({
  kind: overlayKindSchema.optional(),
  region: regionPatchSchema.optional(),
  shape: overlayShapeSchema.optional(),
  cornerRadius: z.number().nonnegative().optional(),
  transitionInFrames: z.number().int().nonnegative().optional(),
  transitionOutFrames: z.number().int().nonnegative().optional(),
  easing: overlayEasingSchema.optional(),
  mode: z.enum(['gaussian', 'pixelate']).optional(),
  amount: z.number().positive().max(200).optional(),
  text: z.string().optional(),
  textColor: hexColorSchema.optional(),
  background: cssColorSchema.optional(),
  borderColor: hexColorSchema.optional(),
  borderWidth: z.number().nonnegative().optional(),
  fontSize: z.number().positive().optional(),
  pointer: pointPatchSchema.nullable().optional(),
  dim: z.number().min(0).max(1).optional(),
  feather: z.number().nonnegative().optional(),
  color: hexColorSchema.optional(),
  zoom: z.number().positive().max(8).optional(),
  focus: pointPatchSchema.nullable().optional(),
  shadow: z.boolean().optional(),
});

export type OverlayPropsPatch = z.infer<typeof overlayPropsPatchSchema>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeOverlayValues(current: unknown, patch: unknown): unknown {
  if (patch === undefined) {
    return current;
  }
  if (!isPlainObject(current) || !isPlainObject(patch)) {
    return patch;
  }
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    merged[key] = mergeOverlayValues(current[key], value);
  }
  return merged;
}

/**
 * Deep-merges a partial patch into overlay props, revalidates the result, and
 * rejects any attempt to change the overlay kind.
 */
export function applyOverlayPropsPatch(
  current: OverlayProps,
  patch: OverlayPropsPatch,
): OverlayProps {
  if (patch.kind !== undefined && patch.kind !== current.kind) {
    throw new Error(
      `Overlay kind cannot change from "${current.kind}" to "${patch.kind}".`,
    );
  }
  return overlayPropsSchema.parse(mergeOverlayValues(current, patch));
}
