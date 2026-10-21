import { z } from 'zod';
import { idSchema } from './ids';

export const effectTypeSchema = z.enum([
  'blur',
  'brightness',
  'contrast',
  'saturate',
  'grayscale',
  'sepia',
  'hue-rotate',
  'drop-shadow',
]);

export const effectSchema = z.object({
  id: idSchema('effect'),
  type: effectTypeSchema,
  enabled: z.boolean().default(true),
  amount: z.number().finite().default(1),
});

export type EffectType = z.infer<typeof effectTypeSchema>;
export type Effect = z.infer<typeof effectSchema>;

export const effectPatchSchema = z.object({
  type: effectTypeSchema.optional(),
  enabled: z.boolean().optional(),
  amount: z.number().finite().optional(),
});

export type EffectPatch = z.infer<typeof effectPatchSchema>;

export const maskTypeSchema = z.enum(['rect', 'ellipse', 'path']);

export const maskSchema = z.object({
  id: idSchema('mask'),
  type: maskTypeSchema,
  x: z.number().min(0).max(1).default(0.1),
  y: z.number().min(0).max(1).default(0.1),
  width: z.number().min(0).max(1).default(0.8),
  height: z.number().min(0).max(1).default(0.8),
  rotation: z.number().finite().default(0),
  feather: z.number().min(0).max(1).default(0),
  opacity: z.number().min(0).max(1).default(1),
  inverted: z.boolean().default(false),
  path: z.string().nullable().default(null),
});

export type MaskType = z.infer<typeof maskTypeSchema>;
export type Mask = z.infer<typeof maskSchema>;

export const maskPatchSchema = z.object({
  type: maskTypeSchema.optional(),
  x: z.number().min(0).max(1).optional(),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0).max(1).optional(),
  height: z.number().min(0).max(1).optional(),
  rotation: z.number().finite().optional(),
  feather: z.number().min(0).max(1).optional(),
  opacity: z.number().min(0).max(1).optional(),
  inverted: z.boolean().optional(),
  path: z.string().nullable().optional(),
});

export type MaskPatch = z.infer<typeof maskPatchSchema>;

export const blendModeSchema = z.enum([
  'normal',
  'screen',
  'multiply',
  'overlay',
  'add',
]);

export type BlendMode = z.infer<typeof blendModeSchema>;
