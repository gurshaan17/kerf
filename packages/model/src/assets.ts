import { z } from 'zod';
import { idSchema, newId } from './ids';
import type { ProjectId } from './ids';
import { frameRateSchema } from './time';

export const assetKindSchema = z.enum(['video', 'audio', 'image', 'other']);
export type AssetKind = z.infer<typeof assetKindSchema>;

export const assetStatusSchema = z.enum([
  'queued',
  'probing',
  'processing',
  'ready',
  'missing',
  'error',
]);
export type AssetStatus = z.infer<typeof assetStatusSchema>;

export const streamKindSchema = z.enum(['video', 'audio', 'subtitle', 'data']);
export type StreamKind = z.infer<typeof streamKindSchema>;

export const mediaStreamSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: streamKindSchema,
  codec: z.string().nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  frameRate: frameRateSchema.nullable().default(null),
  sampleRate: z.number().int().positive().nullable().default(null),
  channels: z.number().int().positive().nullable().default(null),
  durationSeconds: z.number().nonnegative().nullable().default(null),
});

export type MediaStream = z.infer<typeof mediaStreamSchema>;

export interface AssetCache {
  proxyPath: string | null;
  thumbnailPath: string | null;
  waveformPath: string | null;
  filmstripPath: string | null;
}

export const EMPTY_ASSET_CACHE: AssetCache = {
  proxyPath: null,
  thumbnailPath: null,
  waveformPath: null,
  filmstripPath: null,
};

export const assetCacheSchema = z
  .object({
    proxyPath: z.string().nullable().default(null),
    thumbnailPath: z.string().nullable().default(null),
    waveformPath: z.string().nullable().default(null),
    filmstripPath: z.string().nullable().default(null),
  })
  .default(EMPTY_ASSET_CACHE);

export const assetSchema = z.object({
  id: idSchema('asset'),
  projectId: idSchema('project'),
  name: z.string().min(1),
  kind: assetKindSchema,
  generatedBy: z.literal('tts').optional(),
  status: assetStatusSchema.default('queued'),
  sourcePath: z.string().min(1),
  fileSize: z.number().int().nonnegative().default(0),
  mtimeMs: z.number().nonnegative().default(0),
  contentHash: z.string().nullable().default(null),
  durationSeconds: z.number().nonnegative().default(0),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  frameRate: frameRateSchema.nullable().default(null),
  hasVideo: z.boolean().default(false),
  hasAudio: z.boolean().default(false),
  streams: z.array(mediaStreamSchema).default([]),
  cache: assetCacheSchema,
  transcriptId: idSchema('transcript').nullable().default(null),
  error: z.string().nullable().default(null),
  importedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Asset = z.infer<typeof assetSchema>;

export const VIDEO_EXTENSIONS = [
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mkv',
  'avi',
] as const;

export const AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
] as const;

export const IMAGE_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'avif',
] as const;

const extension = (filePath: string): string =>
  filePath.split('.').pop()?.toLowerCase() ?? '';

export function assetKindFromPath(filePath: string): AssetKind {
  const suffix = extension(filePath);
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(suffix)) {
    return 'video';
  }
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(suffix)) {
    return 'audio';
  }
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(suffix)) {
    return 'image';
  }
  return 'other';
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

export interface CreateAssetInput {
  projectId: ProjectId;
  name: string;
  sourcePath: string;
  kind: AssetKind;
  now?: number;
  fileSize?: number;
  mtimeMs?: number;
  status?: AssetStatus;
}

export function createAsset(input: CreateAssetInput): Asset {
  const now = input.now ?? Date.now();
  return assetSchema.parse({
    id: newId('asset'),
    projectId: input.projectId,
    name: input.name,
    kind: input.kind,
    status: input.status,
    sourcePath: input.sourcePath,
    fileSize: input.fileSize,
    mtimeMs: input.mtimeMs,
    importedAt: now,
    updatedAt: now,
  });
}

export function isAssetReady(asset: Asset): boolean {
  return asset.status === 'ready';
}
