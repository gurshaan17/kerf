import type { Asset, Sequence } from '@kerf/model';
import {
  MediaPool,
  clipAtFrame,
  mediaSourceSeconds,
  renderFrame,
  seekVideo,
} from '@kerf/canvas';
import { visualTracksInOrder } from '@kerf/engine';
import type { ExportStartResult } from '../../shared/contracts';

export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'ExportCancelledError';
  }
}

export interface RenderExportOptions {
  readonly result: ExportStartResult;
  readonly sequence: Sequence;
  readonly assets: readonly Asset[];
  readonly writeFrame: (index: number, data: Uint8Array) => Promise<void>;
  readonly onProgress?: (rendered: number, total: number) => void;
  readonly isCancelled?: () => boolean;
}

function visualAssetIds(
  sequence: Sequence,
  startFrame: number,
  endFrame: number,
): string[] {
  const ids = new Set<string>();
  for (const track of visualTracksInOrder(sequence)) {
    if (track.hidden) {
      continue;
    }
    for (const clip of track.clips) {
      if (
        (clip.type === 'video' || clip.type === 'image') &&
        clip.startFrame < endFrame &&
        clip.startFrame + clip.durationFrames > startFrame
      ) {
        ids.add(clip.assetId);
      }
    }
  }
  return [...ids];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForMedia(
  pool: MediaPool,
  ids: readonly string[],
  isCancelled: () => boolean,
): Promise<void> {
  const started = performance.now();
  while (!ids.every((id) => pool.isReady(id))) {
    if (isCancelled()) {
      throw new ExportCancelledError();
    }
    if (performance.now() - started > 20_000) {
      throw new Error(
        'Some footage did not load. Wait for media processing to finish, then export again.',
      );
    }
    await sleep(60);
  }
}

async function seekFrameMedia(
  sequence: Sequence,
  frame: number,
  pool: MediaPool,
  isCancelled: () => boolean,
): Promise<void> {
  for (const track of visualTracksInOrder(sequence)) {
    if (track.hidden) {
      continue;
    }
    const clip = clipAtFrame(sequence, track.id, frame);
    if (!clip || clip.type !== 'video') {
      continue;
    }
    const video = pool.video(clip.assetId);
    if (!video) {
      continue;
    }
    if (isCancelled()) {
      throw new ExportCancelledError();
    }
    await seekVideo(
      video,
      mediaSourceSeconds(clip, frame, pool.asset(clip.assetId), sequence),
    );
  }
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error('The compositor could not encode a frame.'));
      }
    }, 'image/png');
  });
}

/**
 * Renders the same compositor used by the preview into PNG frames. Frame data
 * crosses to the main process one frame at a time so large exports do not have
 * to live in memory.
 */
export async function renderExportFrames({
  result,
  sequence,
  assets,
  writeFrame,
  onProgress,
  isCancelled = () => false,
}: RenderExportOptions): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('The renderer could not create an export canvas.');
  }

  const pool = new MediaPool(assets);
  try {
    const ids = visualAssetIds(sequence, result.startFrame, result.endFrame);
    await waitForMedia(pool, ids, isCancelled);
    for (let frame = result.startFrame; frame < result.endFrame; frame += 1) {
      if (isCancelled()) {
        throw new ExportCancelledError();
      }
      await seekFrameMedia(sequence, frame, pool, isCancelled);
      renderFrame(context, sequence, frame, { pool });
      const blob = await canvasToPng(canvas);
      const data = new Uint8Array(await blob.arrayBuffer());
      await writeFrame(frame - result.startFrame, data);
      onProgress?.(frame - result.startFrame + 1, result.frameCount);
    }
  } finally {
    pool.dispose();
  }
}
