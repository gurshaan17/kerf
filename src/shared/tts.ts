import { z } from 'zod';

/** Curated synchronous speech models; availability still depends on the account. */
export const TTS_MODELS = {
  openai: [
    { id: 'gpt-4o-mini-tts', label: 'GPT-4o mini TTS' },
    { id: 'gpt-4o-mini-tts-2025-12-15', label: 'GPT-4o mini TTS · 2025-12-15' },
    { id: 'tts-1', label: 'TTS-1 · speed' },
    { id: 'tts-1-hd', label: 'TTS-1 HD · quality' },
  ],
  gemini: [
    { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS' },
    { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS' },
    {
      id: 'gemini-3.1-flash-tts-preview',
      label: 'Gemini 3.1 Flash TTS · Preview',
    },
    { id: 'gemini-2.5-pro-preview-tts', label: 'Gemini 2.5 Pro TTS · Preview' },
  ],
} as const;

export const ttsProviderSchema = z
  .object({
    id: z.string().min(1).optional(),
    label: z.string().trim().min(1).max(80),
    kind: z.enum([
      'openai',
      'gemini',
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
