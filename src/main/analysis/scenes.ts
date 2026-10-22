import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Asset, FrameRate, Scene } from '@kerf/model';
import { newId, secondsToFrames, sceneSchema } from '@kerf/model';
import { detectSceneCuts, extractFrameAt } from './media';
import type { SceneCut } from './media';

export interface BuildScenesInput {
  readonly assetId: string;
  readonly durationFrames: number;
  readonly rate: FrameRate;
  readonly cuts: readonly SceneCut[];
  readonly now?: () => number;
}

export function buildScenes(input: BuildScenesInput): Scene[] {
  const duration = Math.max(1, Math.round(input.durationFrames));
  const thresholds = input.cuts
    .map((cut) => ({
      frame: Math.max(
        0,
        Math.min(duration, secondsToFrames(cut.timeSeconds, input.rate)),
      ),
      score: Math.max(0, Math.min(1, cut.score)),
    }))
    .filter((cut) => cut.frame > 0 && cut.frame < duration)
    .sort((left, right) => left.frame - right.frame);

  const boundaries: Array<{ frame: number; score: number }> = [
    { frame: 0, score: 0.5 },
  ];
  for (const cut of thresholds) {
    const previous = boundaries[boundaries.length - 1];
    if (previous && cut.frame - previous.frame < 2) {
      continue;
    }
    boundaries.push(cut);
  }
  boundaries.push({ frame: duration, score: 0.5 });

  const scenes: Scene[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    if (!start || !end || end.frame <= start.frame) {
      continue;
    }
    scenes.push(
      sceneSchema.parse({
        id: newId('scene'),
        assetId: input.assetId,
        index: scenes.length,
        startFrame: start.frame,
        endFrame: end.frame,
        thumbnailPath: null,
        score: start.score,
      }),
    );
    if (scenes.length >= 500) {
      break;
    }
  }
  return scenes;
}

export interface DetectScenesInput {
  readonly asset: Asset;
  readonly ffmpeg: string;
  readonly rate: FrameRate;
  readonly durationFrames: number;
  readonly keyframesRoot: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: number) => void;
  readonly now?: () => number;
}

export async function detectScenes(input: DetectScenesInput): Promise<Scene[]> {
  input.onProgress?.(0.05);
  const cuts = await detectSceneCuts(
    input.ffmpeg,
    input.asset.sourcePath,
    input.signal,
  );
  input.onProgress?.(0.35);
  const scenes = buildScenes({
    assetId: input.asset.id,
    durationFrames: input.durationFrames,
    rate: input.rate,
    cuts,
    now: input.now,
  });

  const assetRoot = join(input.keyframesRoot, input.asset.id);
  rmSync(assetRoot, { recursive: true, force: true });
  mkdirSync(assetRoot, { recursive: true });
  const withThumbnails: Scene[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!scene) {
      continue;
    }
    const midpoint =
      (scene.startFrame + scene.endFrame) /
      2 /
      (input.rate.numerator / input.rate.denominator);
    const thumbnailPath = join(assetRoot, `${scene.id}.jpg`);
    await extractFrameAt(
      input.ffmpeg,
      input.asset.sourcePath,
      midpoint,
      thumbnailPath,
      input.signal,
    );
    withThumbnails.push({ ...scene, thumbnailPath });
    input.onProgress?.(0.35 + (0.63 * (index + 1)) / scenes.length);
  }
  input.onProgress?.(1);
  return withThumbnails;
}
