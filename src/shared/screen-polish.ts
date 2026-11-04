import { z } from 'zod';
import { idSchema } from '@kerf/model';
import type { EditResult, JobSummary } from './contracts';

export const polishFocusSchema = z.object({
  clipId: idSchema('clip'),
  startFrame: z.number().int().nonnegative(),
  durationFrames: z.number().int().positive(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  kind: z.enum(['zoom', 'spotlight', 'callout']),
  text: z.string().max(300),
  width: z.number().min(0.02).max(1).optional(),
  height: z.number().min(0.02).max(1).optional(),
  zoom: z.number().min(1).max(8).optional(),
  transitionFrames: z.number().int().nonnegative().optional(),
});
export const polishSuggestionSchema = polishFocusSchema.extend({
  id: z.string().min(1),
  reason: z.string().min(1).max(600),
  evidenceFrames: z.array(z.number().int().nonnegative()).min(1).max(8),
});
export const polishGenerateSchema = z
  .object({
    clipId: idSchema('clip'),
    providerId: z.string().min(1),
  })
  .strict();
export const polishProposalSchema = z.object({
  projectId: idSchema('project'),
  clipId: idSchema('clip'),
  assetId: idSchema('asset'),
  fingerprint: z.string(),
  providerId: z.string(),
  sampleCount: z.number().int().nonnegative(),
  suggestions: z.array(polishSuggestionSchema).max(60),
});
export const polishApplySchema = z
  .object({
    jobId: idSchema('job'),
    suggestions: z.array(polishSuggestionSchema).min(1).max(60),
  })
  .strict();
export type PolishSuggestion = z.infer<typeof polishSuggestionSchema>;
export type PolishProposal = z.infer<typeof polishProposalSchema>;
export interface ScreenPolishBridge {
  generate(request: z.input<typeof polishGenerateSchema>): Promise<JobSummary>;
  proposal(jobId: string): Promise<PolishProposal | null>;
  apply(request: z.input<typeof polishApplySchema>): Promise<EditResult>;
}
