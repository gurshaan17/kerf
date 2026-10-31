import { z } from 'zod';

export const ttsProviderSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(80),
    kind: z.enum([
      'aws-polly',
      'google-cloud',
      'smallest',
      'lemonfox',
      'openai-compatible',
    ]),
    endpoint: z.string().trim().max(500).default(''),
    model: z.string().trim().max(200).default(''),
    voice: z.string().trim().min(1).max(200),
    region: z.string().trim().max(80).default('us-east-1'),
    language: z.string().trim().max(80).default('en-US'),
    speed: z.number().min(0.5).max(2).default(1),
    credentials: z.string().max(30000).optional(),
  })
  .strict();
export type TtsProviderSave = z.input<typeof ttsProviderSchema>;
export type TtsProvider = Omit<
  z.output<typeof ttsProviderSchema>,
  'credentials' | 'id'
> & { id: string; hasCredentials: boolean };
export const ttsGenerateSchema = z
  .object({
    transcriptId: z.string().min(1),
    segmentId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    providerId: z.string().min(1),
  })
  .strict();
export type TtsGenerateRequest = z.infer<typeof ttsGenerateSchema>;
export interface TtsTake {
  id: string;
  projectId: string;
  transcriptId: string;
  segmentId: string;
  text: string;
  providerId: string;
  voice: string;
  model: string;
  speed: number;
  assetId: string;
  createdAt: number;
}
export interface TtsBridge {
  providers(): Promise<TtsProvider[]>;
  saveProvider(request: TtsProviderSave): Promise<TtsProvider>;
  deleteProvider(id: string): Promise<boolean>;
  generate(request: TtsGenerateRequest): Promise<{ jobId: string }>;
  takes(transcriptId: string): Promise<TtsTake[]>;
  place(request: { takeId: string; expectedRevision: number }): Promise<void>;
}
