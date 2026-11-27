import { z } from 'zod';
import { idSchema } from '@kerf/model';
import type { ReframeSize, TrackedReframePoint } from '@kerf/engine';

const reviewId = z.uuid();
const point = z
  .object({
    frame: z.number().int().nonnegative(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    hold: z.boolean().optional(),
  })
  .strict();
export const reframePrepareSchema = z
  .object({ reviewId, clipId: idSchema('clip') })
  .strict();
export const reframeTrackSchema = z
  .object({ reviewId, anchors: z.array(point).min(1).max(64) })
  .strict();
export const reframeCreateSchema = z
  .object({
    reviewId,
    format: z.enum(['vertical', 'square']),
    points: z.array(point).min(1).max(640),
  })
  .strict();
export type ReframePrepare = z.infer<typeof reframePrepareSchema>;
export type ReframeTrack = z.infer<typeof reframeTrackSchema>;
export type ReframeCreate = z.infer<typeof reframeCreateSchema>;

export interface ReframeReview {
  readonly source: ReframeSize;
  readonly sourceStartSeconds: number;
  readonly durationFrames: number;
}
export interface ReframeBridge {
  prepare(input: ReframePrepare): Promise<ReframeReview>;
  track(input: ReframeTrack): Promise<readonly TrackedReframePoint[]>;
  create(input: ReframeCreate): Promise<{ projectId: string; name: string }>;
  cancel(reviewId: string): Promise<void>;
}
