import { spawn } from 'node:child_process';
import type { Asset, FrameRate } from '@kerf/model';
import { detectSceneCuts } from './media';
import type { SceneCut } from './media';

export interface RgbFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface ReferenceColourMetrics {
  readonly meanLuma: number | null;
  readonly meanSaturation: number | null;
  readonly meanContrast: number | null;
  readonly palette: string[];
}

export interface ReferenceMetrics extends ReferenceColourMetrics {
  readonly sceneCount: number;
  readonly averageShotLengthFrames: number;
  readonly cutsPerMinute: number;
}

export interface BuildReferenceMetricsInput {
  readonly durationFrames: number;
  readonly rate: FrameRate;
  readonly cuts: readonly SceneCut[];
  readonly frames: readonly RgbFrame[];
}

export interface SampleReferenceFramesInput {
  readonly ffmpeg: string;
  readonly sourcePath: string;
  readonly durationSeconds: number;
  readonly sampleCount?: number;
  readonly signal?: AbortSignal;
}

export interface ProfileReferenceAssetInput {
  readonly asset: Asset;
  readonly ffmpeg: string;
  readonly rate: FrameRate;
  readonly durationFrames: number;
  readonly signal?: AbortSignal;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function hexChannel(value: number): string {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function paletteFor(counts: Map<number, number>): string[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, 5)
    .map(([key]) => {
      const red = ((key >> 8) & 0xf) * 16 + 8;
      const green = ((key >> 4) & 0xf) * 16 + 8;
      const blue = (key & 0xf) * 16 + 8;
      return `#${hexChannel(red)}${hexChannel(green)}${hexChannel(blue)}`;
    });
}

/**
 * Reduces a handful of tiny RGB frames to the numbers a reference profile
 * needs. Sampling is intentionally cheap: the goal is a stable grade target,
 * not a second copy of the footage.
 */
export function measureReferenceFrames(
  frames: readonly RgbFrame[],
): ReferenceColourMetrics {
  let lumaTotal = 0;
  let lumaSquareTotal = 0;
  let saturationTotal = 0;
  let pixelCount = 0;
  const paletteCounts = new Map<number, number>();

  for (const frame of frames) {
    const pixels = Math.floor(frame.data.length / 3);
    if (pixels === 0) {
      continue;
    }
    for (let index = 0; index < pixels; index += 1) {
      const offset = index * 3;
      const red = frame.data[offset] ?? 0;
      const green = frame.data[offset + 1] ?? 0;
      const blue = frame.data[offset + 2] ?? 0;
      const luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
      lumaTotal += luma;
      lumaSquareTotal += luma * luma;
      const maximum = Math.max(red, green, blue);
      const minimum = Math.min(red, green, blue);
      saturationTotal += maximum === 0 ? 0 : (maximum - minimum) / maximum;
      const key = ((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4);
      paletteCounts.set(key, (paletteCounts.get(key) ?? 0) + 1);
    }
    pixelCount += pixels;
  }

  if (pixelCount === 0) {
    return {
      meanLuma: null,
      meanSaturation: null,
      meanContrast: null,
      palette: [],
    };
  }

  const meanLuma = lumaTotal / pixelCount;
  const variance = Math.max(0, lumaSquareTotal / pixelCount - meanLuma ** 2);
  return {
    meanLuma: round(clamp(meanLuma, 0, 1), 3),
    meanSaturation: round(clamp(saturationTotal / pixelCount, 0, 1), 3),
    meanContrast: round(clamp(Math.sqrt(variance) * 2, 0, 1), 3),
    palette: paletteFor(paletteCounts),
  };
}

export function buildReferenceMetrics(
  input: BuildReferenceMetricsInput,
): ReferenceMetrics {
  const fps = input.rate.numerator / input.rate.denominator;
  const durationFrames = Math.max(0, input.durationFrames);
  const durationSeconds = fps > 0 ? durationFrames / fps : 0;
  const cuts = input.cuts.filter(
    (cut) =>
      Number.isFinite(cut.timeSeconds) &&
      cut.timeSeconds >= 0 &&
      (durationSeconds === 0 || cut.timeSeconds <= durationSeconds + 0.05),
  );
  const sceneCount = Math.max(1, cuts.length + 1);
  const averageShotLengthFrames =
    sceneCount > 0 ? durationFrames / sceneCount : 0;
  const cutsPerMinute =
    durationSeconds > 0 ? cuts.length / (durationSeconds / 60) : 0;
  return {
    sceneCount,
    averageShotLengthFrames: round(averageShotLengthFrames, 1),
    cutsPerMinute: round(cutsPerMinute, 1),
    ...measureReferenceFrames(input.frames),
  };
}

function readStderr(child: ReturnType<typeof spawn>): () => string {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-4_000);
  });
  return () => stderr;
}

/**
 * Pulls evenly spaced 16x16 RGB frames in a single FFmpeg pass. The output is
 * tiny enough to keep in memory and never touches the project cache.
 */
export async function sampleReferenceFrames(
  input: SampleReferenceFramesInput,
): Promise<RgbFrame[]> {
  const sampleCount = Math.max(1, Math.min(16, input.sampleCount ?? 8));
  const width = 16;
  const height = 16;
  const duration = Math.max(0.05, input.durationSeconds);
  const fps = Math.max(0.01, sampleCount / duration);
  const frameSize = width * height * 3;
  const child = spawn(
    input.ffmpeg,
    [
      '-hide_banner',
      '-nostdin',
      '-v',
      'error',
      '-i',
      input.sourcePath,
      '-vf',
      `fps=${fps.toFixed(4)},scale=${width}:${height},format=rgb24`,
      '-frames:v',
      String(sampleCount),
      '-an',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    {
      signal: input.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  const stderr = readStderr(child);
  const chunks: Buffer[] = [];
  let bytes = 0;
  child.stdout?.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
    bytes += chunk.length;
  });

  await new Promise<void>((resolvePromise, reject) => {
    child.once('error', (cause) => {
      reject(new Error(`Could not sample the reference: ${cause.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `ffmpeg could not sample the reference (code ${code ?? -1}): ${stderr().trim()}`,
        ),
      );
    });
  });

  const buffer = Buffer.concat(chunks, bytes);
  const frames: RgbFrame[] = [];
  for (
    let offset = 0;
    offset + frameSize <= buffer.length;
    offset += frameSize
  ) {
    frames.push({
      width,
      height,
      data: new Uint8Array(buffer.subarray(offset, offset + frameSize)),
    });
  }
  return frames;
}

export async function profileReferenceAsset(
  input: ProfileReferenceAssetInput,
): Promise<ReferenceMetrics> {
  const fps = input.rate.numerator / input.rate.denominator;
  const durationSeconds =
    fps > 0 ? Math.max(1 / fps, input.durationFrames / fps) : 1;
  const isVideo = input.asset.kind === 'video' || input.asset.hasVideo;
  const cuts = isVideo
    ? await detectSceneCuts(input.ffmpeg, input.asset.sourcePath, input.signal)
    : [];
  const frames = await sampleReferenceFrames({
    ffmpeg: input.ffmpeg,
    sourcePath: input.asset.sourcePath,
    durationSeconds,
    sampleCount: input.asset.kind === 'image' ? 1 : 8,
    signal: input.signal,
  });
  return buildReferenceMetrics({
    durationFrames: input.durationFrames,
    rate: input.rate,
    cuts,
    frames,
  });
}
