import { z } from 'zod';
import { idSchema, noiseReductionSchema } from '@kerf/model';

export const noiseReductionRequestSchema = z
  .object({
    requestId: z.uuid(),
    clipId: idSchema('clip'),
    strength: noiseReductionSchema.exclude(['off']),
  })
  .strict();
export type NoiseReductionRequest = z.infer<typeof noiseReductionRequestSchema>;

export interface NoiseReductionPreview {
  readonly startSeconds: number;
  readonly endSeconds: number;
}
