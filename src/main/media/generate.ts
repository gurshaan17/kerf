import { mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AssetCache } from '@kerf/model';
import { findExecutable, MediaProcessError, runFfmpeg } from './ffmpeg';

export interface GenerateMediaOptions {
  readonly signal?: AbortSignal;
  readonly ffmpegPath?: string;
  readonly onProgress?: (progress: number) => void;
}

export interface ProxyOptions extends GenerateMediaOptions {
  readonly durationSeconds: number;
  readonly hasAudio: boolean;
}

export interface ThumbnailOptions extends GenerateMediaOptions {
  readonly atSeconds?: number;
  readonly isImage?: boolean;
}

export function assetCachePaths(
  projectFolder: string,
  assetId: string,
): AssetCache {
  return {
    proxyPath: join(projectFolder, 'cache', 'proxies', `${assetId}.mp4`),
    thumbnailPath: join(projectFolder, 'cache', 'thumbnails', `${assetId}.jpg`),
    waveformPath: join(projectFolder, 'cache', 'waveforms', `${assetId}.png`),
    filmstripPath: null,
  };
}

export function buildProxyArgs(
  inputPath: string,
  outputPath: string,
  options: { readonly hasAudio: boolean },
): string[] {
  const args = [
    '-y',
    '-i',
    inputPath,
    '-map',
    '0:v:0',
    '-vf',
    "scale=-2:'min(720,ih)'",
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
  ];
  if (options.hasAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '160k');
  } else {
    args.push('-an');
  }
  args.push(outputPath);
  return args;
}

export function buildThumbnailArgs(
  inputPath: string,
  outputPath: string,
  options: ThumbnailOptions = {},
): string[] {
  const args = ['-y'];
  if (options.isImage !== true) {
    args.push('-ss', String(options.atSeconds ?? 1));
  }
  args.push(
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=480:-2',
    '-q:v',
    '4',
    outputPath,
  );
  return args;
}

export function buildWaveformArgs(
  inputPath: string,
  outputPath: string,
): string[] {
  return [
    '-y',
    '-i',
    inputPath,
    '-filter_complex',
    'aformat=channel_layouts=mono,showwavespic=s=1200x160:colors=#c9a46a',
    '-frames:v',
    '1',
    outputPath,
  ];
}

function assertOutput(filePath: string, label: string): void {
  try {
    if (statSync(filePath).size > 0) {
      return;
    }
  } catch {
    // Fall through to the shared error below.
  }
  throw new MediaProcessError(
    `${label} did not produce an output file.`,
    'process-failed',
  );
}

export async function generateProxy(
  inputPath: string,
  outputPath: string,
  options: ProxyOptions,
): Promise<void> {
  const ffmpegPath = options.ffmpegPath ?? findExecutable('ffmpeg');
  mkdirSync(dirname(outputPath), { recursive: true });
  await runFfmpeg(ffmpegPath, buildProxyArgs(inputPath, outputPath, options), {
    signal: options.signal,
    durationSeconds: options.durationSeconds,
    onProgress: options.onProgress,
  });
  assertOutput(outputPath, 'Proxy');
}

export async function generateThumbnail(
  inputPath: string,
  outputPath: string,
  options: ThumbnailOptions = {},
): Promise<void> {
  const ffmpegPath = options.ffmpegPath ?? findExecutable('ffmpeg');
  mkdirSync(dirname(outputPath), { recursive: true });
  await runFfmpeg(
    ffmpegPath,
    buildThumbnailArgs(inputPath, outputPath, options),
    { signal: options.signal },
  );
  assertOutput(outputPath, 'Thumbnail');
}

export async function generateWaveform(
  inputPath: string,
  outputPath: string,
  options: GenerateMediaOptions = {},
): Promise<void> {
  const ffmpegPath = options.ffmpegPath ?? findExecutable('ffmpeg');
  mkdirSync(dirname(outputPath), { recursive: true });
  await runFfmpeg(ffmpegPath, buildWaveformArgs(inputPath, outputPath), {
    signal: options.signal,
  });
  assertOutput(outputPath, 'Waveform');
}
