import { z } from 'zod';
import { idSchema } from '@kerf/model';
import type { EditReceipt, ToolContext } from './types';

const clipIds = z.array(idSchema('clip')).min(1).max(20);
export const measureAudioSchema = z.object({
  clipIds,
  requestId: z.string().min(1).max(80).optional(),
});
export const planAudioGainSchema = z.object({
  measurementId: z.string().min(1),
  targetLufs: z.number().min(-40).max(-8),
  peakCeilingDbtp: z.number().min(-24).max(0),
  fadeMs: z.number().min(0).max(250).default(50),
});
export const planAudioDuckingSchema = z.object({
  speechClipIds: clipIds,
  backgroundClipIds: clipIds,
  gain: z.number().min(0).max(1).default(0.35),
  attackMs: z.number().min(20).max(1000).default(100),
  releaseMs: z.number().min(20).max(2000).default(250),
});
export type MeasureAudioRequest = z.infer<typeof measureAudioSchema>;
export type AudioGainRequest = z.infer<typeof planAudioGainSchema>;
export type AudioDuckRequest = z.infer<typeof planAudioDuckingSchema>;
export interface AudioMeasurement {
  id: string;
  projectId: string;
  clipIds: readonly string[];
  revision: string;
  startFrame: number;
  endFrame: number;
  integratedLufs: number | null;
  truePeakDbtp: number | null;
  status: 'measured' | 'silence' | 'insufficient';
  units: { loudness: 'LUFS'; truePeak: 'dBTP' };
  note: string;
}
export interface AudioFinishPlan {
  id: string;
  projectId: string;
  kind: 'gain' | 'duck';
  clipIds: readonly string[];
  revision: string;
  status: 'ready' | 'unattainable' | 'stale' | 'applied';
  warnings: readonly string[];
  targetLufs?: number;
  gainDb?: number;
  estimatedPeakDbtp?: number;
  peakCeilingDbtp?: number;
  changes: readonly {
    clipId: string;
    beforeVolume: number;
    afterVolume: number;
    fadeInFrames?: number;
    fadeOutFrames?: number;
    keyframeCount?: number;
  }[];
  origin?: { conversationId: string; turnId: string };
  receipt?: EditReceipt;
}
export interface ToolAudioFinishingAccess {
  measure(input: MeasureAudioRequest): Promise<AudioMeasurement>;
  planGain(input: AudioGainRequest): AudioFinishPlan;
  planDucking(input: AudioDuckRequest): AudioFinishPlan;
  read(id: string): AudioFinishPlan;
}
function access(context: ToolContext) {
  if (!context.audioFinishing)
    throw new Error('Local audio finishing is unavailable.');
  return context.audioFinishing();
}
export const AUDIO_FINISHING_TOOLS = [
  {
    name: 'measureAudio',
    description:
      'Measure explicitly selected audio-bearing clips locally with FFmpeg: integrated LUFS and true peak dBTP of their processed mix before export master limiting. Returns silence or insufficient-duration states. Never edits or uploads audio.',
    input: measureAudioSchema,
    readOnly: true,
    execute: (context: ToolContext, input: MeasureAudioRequest) =>
      access(context).measure(input),
  },
  {
    name: 'planAudioGain',
    description:
      'Prepare reviewed gain and short fades from a current measurement, explicit LUFS target and peak ceiling. Reports unattainable targets; never adds a limiter. Desktop Apply is required.',
    input: planAudioGainSchema,
    readOnly: false,
    execute: (context: ToolContext, input: AudioGainRequest) =>
      access(context).planGain(input),
  },
  {
    name: 'planAudioDucking',
    description:
      'Prepare speech-envelope ducking for explicit speech/background clip IDs using reviewed indexed speech and attack/release ramps. Rejects conflicting existing background automation. Desktop Apply is required.',
    input: planAudioDuckingSchema,
    readOnly: false,
    execute: (context: ToolContext, input: AudioDuckRequest) =>
      access(context).planDucking(input),
  },
  {
    name: 'readAudioFinishingPlan',
    description:
      'Read a local audio finishing plan and its current eligibility. No audio edit occurs until desktop Apply.',
    input: z.object({ planId: z.string().min(1) }),
    readOnly: true,
    execute: (context: ToolContext, input: { planId: string }) =>
      access(context).read(input.planId),
  },
];
