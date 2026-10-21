import { z } from 'zod';
import { idSchema } from './ids';

export const sceneSchema = z
  .object({
    id: idSchema('scene'),
    assetId: idSchema('asset'),
    index: z.number().int().nonnegative(),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    thumbnailPath: z.string().nullable().default(null),
    score: z.number().min(0).max(1).default(0.5),
  })
  .refine((scene) => scene.endFrame > scene.startFrame, {
    message: 'A scene must have a positive duration',
  });

export type Scene = z.infer<typeof sceneSchema>;
