import { z } from 'zod';
import { idSchema, frameRateSchema } from '@kerf/model';
import type { ToolContext } from './types';

export const clipDiscoverySchema = z
  .object({
    assetId: idSchema('asset'),
    providerId: z.string().min(1),
    count: z.number().int().min(1).max(6).default(3),
    minSeconds: z.number().min(1).max(180).default(20),
    maxSeconds: z.number().min(1).max(180).default(60),
    topic: z.string().trim().max(600).default(''),
  })
  .strict()
  .refine(
    (v) => v.maxSeconds >= v.minSeconds,
    'Maximum duration must be at least the minimum.',
  );
export type ClipDiscoveryRequest = z.infer<typeof clipDiscoverySchema>;
export const highlightEvidenceSchema = z.object({
  id: z.string(),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  text: z.string().min(1),
  segmentIds: z.array(z.string()).min(1),
});
export const highlightCandidateSchema = z.object({
  id: z.string(),
  startEvidenceId: z.string(),
  endEvidenceId: z.string(),
  title: z.string().trim().min(1).max(120),
  rationale: z.string().trim().min(1).max(600),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  openingLine: z.string(),
  excerpt: z.string(),
  evidenceIds: z.array(z.string()).min(1),
  warnings: z.array(z.string()),
});
export type HighlightCandidate = z.infer<typeof highlightCandidateSchema>;
export const highlightProposalSchema = z.object({
  version: z.literal(1),
  projectId: idSchema('project'),
  assetId: idSchema('asset'),
  fingerprint: z.string(),
  sourceFrameRate: frameRateSchema,
  request: clipDiscoverySchema,
  evidence: z.array(highlightEvidenceSchema).max(400),
  candidates: z.array(highlightCandidateSchema).max(6),
  warnings: z.array(z.string()),
});
export type HighlightProposal = z.infer<typeof highlightProposalSchema>;
export const highlightSelectionSchema = z
  .object({
    jobId: z.string().min(1),
    selections: z
      .array(
        z
          .object({
            candidateId: z.string().min(1),
            startEvidenceId: z.string().optional(),
            endEvidenceId: z.string().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type HighlightSelection = z.infer<typeof highlightSelectionSchema>;
export interface HighlightOutput {
  candidateId: string;
  projectId: string;
  assetId: string;
  videoClipId: string;
  audioClipId: string;
  name: string;
  startFrame: number;
  endFrame: number;
  durationFrames: number;
  exists: boolean;
}
export interface ClipDiscoveryReview {
  id: string;
  projectId: string;
  status: string;
  stage: string;
  error: string | null;
  proposal: HighlightProposal | null;
  eligible: boolean;
  reason?: string;
  applied: boolean;
  cancelled: boolean;
  outputs: HighlightOutput[];
  origin?: { conversationId: string; turnId: string };
  requestedSelections?: HighlightSelection['selections'];
}
export interface ToolHighlightAccess {
  start(input: ClipDiscoveryRequest): ClipDiscoveryReview;
  read(jobId: string): ClipDiscoveryReview;
  request(input: HighlightSelection): {
    status: 'awaiting-review';
    jobId: string;
  };
  outputs(jobId: string): {
    projectId: string;
    jobId: string;
    outputs: HighlightOutput[];
  };
  verify(projectId: string): {
    projectId: string;
    valid: boolean;
    findings: string[];
    videoClipId: string;
    audioClipId: string;
  };
  cancel(jobId: string): ClipDiscoveryReview;
}
function access(context: ToolContext) {
  if (!context.highlights)
    throw new Error('Highlight discovery is unavailable.');
  return context.highlights();
}
const jobInput = z.object({ jobId: z.string().min(1) }).strict();
export const HIGHLIGHT_TOOLS = [
  {
    name: 'startClipDiscovery',
    description:
      'Discover up to six self-contained highlights from ONE ready transcribed speech video using an explicitly configured text provider with chat consent. Returns a local async job; never edits. Duration bounds, topic and fewer results are supported. Source aspect is preserved; no automatic crops or exports.',
    input: clipDiscoverySchema,
    readOnly: false,
    execute: (c: ToolContext, input: ClipDiscoveryRequest) =>
      access(c).start(input),
  },
  {
    name: 'readClipDiscovery',
    description:
      'Read stored highlight candidates, transcript evidence, warnings, source revision and review eligibility. Never starts or retries analysis.',
    input: jobInput,
    readOnly: true,
    execute: (c: ToolContext, input: { jobId: string }) =>
      access(c).read(input.jobId),
  },
  {
    name: 'createClipsFromProposal',
    description:
      'Request desktop review of explicit candidate IDs and optional evidence-aligned boundary adjustments. Returns awaiting-review only. Only desktop Create selected projects creates independent editable projects, without changing the source timeline. Repeated Apply cannot duplicate outputs.',
    input: highlightSelectionSchema,
    readOnly: false,
    execute: (c: ToolContext, input: HighlightSelection) =>
      access(c).request(input),
  },
  {
    name: 'readClipOutputs',
    description:
      'Read durable project and clip IDs for approved highlights, including deleted-output status. Open the specific output project explicitly before refining it; never infer that reading changes projects.',
    input: jobInput,
    readOnly: true,
    execute: (c: ToolContext, input: { jobId: string }) =>
      access(c).outputs(input.jobId),
  },
  {
    name: 'verifyClipOutput',
    description:
      'Structurally verify one highlight output from the current source/output project. Checks source identity, clip timing and referenced media; reports edits and missing clips honestly. Does not establish editorial quality or start an export.',
    input: z.object({ projectId: idSchema('project') }).strict(),
    readOnly: true,
    execute: (c: ToolContext, input: { projectId: string }) =>
      access(c).verify(input.projectId),
  },
  {
    name: 'cancelClipDiscovery',
    description:
      'Cancel the scoped highlight job and invalidate pending approval. Completed projects are preserved. No automatic retry.',
    input: jobInput,
    readOnly: false,
    execute: (c: ToolContext, input: { jobId: string }) =>
      access(c).cancel(input.jobId),
  },
];
