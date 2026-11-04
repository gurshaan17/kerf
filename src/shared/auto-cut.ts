import { z } from 'zod';
import { autoCutRangeSchema, idSchema } from '@kerf/model';
import type { AutoCutRemoval, FrameRate } from '@kerf/model';
import type { EditResult, JobSummary } from './contracts';

export const autoCutGenerateSchema = z
  .object({
    clipId: idSchema('clip'),
    providerId: z.string().min(1),
    purpose: z.string().trim().max(1000).default(''),
  })
  .strict();
export type AutoCutGenerateRequest = z.input<typeof autoCutGenerateSchema>;
export const autoCutApplySchema = z
  .object({
    jobId: idSchema('job'),
    removalIds: z.array(z.string().min(1)).min(1).max(400),
  })
  .strict();
export const autoCutProposalSchema = z.object({
  projectId: idSchema('project'),
  clipId: idSchema('clip'),
  assetId: idSchema('asset'),
  fingerprint: z.string(),
  providerId: z.string(),
  providerRevision: z.string(),
  purpose: z.string(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  frameRate: z.object({
    numerator: z.number().positive(),
    denominator: z.number().positive(),
  }),
  removals: z.array(
    z
      .object({
        id: z.string(),
        startFrame: z.number().int().nonnegative(),
        endFrame: z.number().int().positive(),
        reason: z.string(),
      })
      .refine(
        (r) =>
          autoCutRangeSchema.safeParse({
            startFrame: r.startFrame,
            endFrame: r.endFrame,
          }).success,
      ),
  ),
  sampleCount: z.number().int().nonnegative(),
});
export interface AutoCutProposal {
  projectId: string;
  clipId: string;
  assetId: string;
  fingerprint: string;
  providerId: string;
  providerRevision: string;
  purpose: string;
  startFrame: number;
  endFrame: number;
  frameRate: FrameRate;
  removals: AutoCutRemoval[];
  sampleCount: number;
}
export interface AutoCutBridge {
  generate(request: AutoCutGenerateRequest): Promise<JobSummary>;
  proposal(jobId: string): Promise<AutoCutProposal | null>;
  apply(request: z.input<typeof autoCutApplySchema>): Promise<EditResult>;
}
