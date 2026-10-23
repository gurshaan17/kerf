import { z } from 'zod';
import { idSchema } from './ids';

export const hexColorSchema = z
  .string()
  .regex(
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
    'Expected a hex colour such as #c9a46a',
  );

export const cssColorSchema = z.string().min(1);

export const captionPositionSchema = z.enum(['top', 'center', 'bottom']);
export const textAlignSchema = z.enum(['left', 'center', 'right']);

export const styleConfigSchema = z.object({
  accent: hexColorSchema.default('#c9a46a'),
  background: cssColorSchema.default('#0b0c0d'),
  foreground: hexColorSchema.default('#ece6dc'),
  muted: hexColorSchema.default('#a9a299'),
  fontFamily: z.string().min(1).default('Instrument Sans'),
  displayFontFamily: z.string().min(1).default('Fraunces'),
  captionFontFamily: z.string().min(1).default('Instrument Sans'),
  captionSize: z.number().positive().default(42),
  captionWeight: z.number().int().min(100).max(900).default(600),
  captionColor: hexColorSchema.default('#ece6dc'),
  captionBackground: cssColorSchema.default('rgba(11, 12, 13, 0.72)'),
  captionPosition: captionPositionSchema.default('bottom'),
  captionAlign: textAlignSchema.default('center'),
  captionMaxWidth: z.number().min(0.1).max(1).default(0.8),
  radius: z.number().nonnegative().default(10),
  safeMargin: z.number().min(0).max(0.5).default(0.08),
});

export type StyleConfig = z.infer<typeof styleConfigSchema>;
export const DEFAULT_STYLE: StyleConfig = styleConfigSchema.parse({});

export const referenceProfileSchema = z.object({
  id: idSchema('reference'),
  name: z.string().min(1),
  sourceAssetId: idSchema('asset').nullable().default(null),
  palette: z.array(hexColorSchema).default([]),
  mood: z.array(z.string().min(1)).default([]),
  notes: z.string().default(''),
  sceneCount: z.number().int().nonnegative().default(0),
  averageShotLengthFrames: z.number().nonnegative().default(0),
  cutsPerMinute: z.number().nonnegative().default(0),
  meanLuma: z.number().min(0).max(1).nullable().default(null),
  meanSaturation: z.number().min(0).max(1).nullable().default(null),
  meanContrast: z.number().min(0).max(1).nullable().default(null),
  analyzedAt: z.number().int().nonnegative().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
});

export type ReferenceProfile = z.infer<typeof referenceProfileSchema>;
