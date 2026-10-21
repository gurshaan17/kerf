import { z } from 'zod';
import { idSchema, newId } from './ids';
import type { AssetId } from './ids';

export const transcriptWordSchema = z
  .object({
    text: z.string().min(1),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1).default(1),
  })
  .refine((word) => word.endFrame >= word.startFrame, {
    message: 'A word cannot end before it starts',
  });

export const transcriptSegmentSchema = z
  .object({
    id: idSchema('segment'),
    startFrame: z.number().int().nonnegative(),
    endFrame: z.number().int().nonnegative(),
    text: z.string(),
    words: z.array(transcriptWordSchema).default([]),
  })
  .refine((segment) => segment.endFrame >= segment.startFrame, {
    message: 'A segment cannot end before it starts',
  });

export const transcriptSchema = z.object({
  id: idSchema('transcript'),
  assetId: idSchema('asset'),
  language: z.string().min(2).default('en'),
  text: z.string().default(''),
  segments: z.array(transcriptSegmentSchema).default([]),
  model: z.string().nullable().default(null),
  createdAt: z.number().int().nonnegative(),
});

export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;

export interface CreateTranscriptInput {
  assetId: AssetId;
  segments: TranscriptSegment[];
  text?: string;
  language?: string;
  model?: string | null;
  now?: number;
}

export function createTranscript(input: CreateTranscriptInput): Transcript {
  return transcriptSchema.parse({
    id: newId('transcript'),
    assetId: input.assetId,
    language: input.language,
    text:
      input.text ??
      input.segments
        .map((segment) => segment.text)
        .join(' ')
        .trim(),
    segments: input.segments,
    model: input.model ?? null,
    createdAt: input.now ?? Date.now(),
  });
}

export function transcriptDurationFrames(transcript: Transcript): number {
  return transcript.segments.reduce(
    (latest, segment) => Math.max(latest, segment.endFrame),
    0,
  );
}
