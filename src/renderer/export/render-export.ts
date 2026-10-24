import type { Asset, Sequence } from '@kerf/model';
import {
  MediaPool,
  clipAtFrame,
  mediaSourceSeconds,
  renderFrame,
  seekVideo,
} from '@kerf/canvas';
import { visualTracksInOrder } from '@kerf/engine';
import type { SceneTree } from '@kerf/motion';
import type { ExportFrame, ExportStartResult } from '../../shared/contracts';

const EXPORT_FRAME_BATCH_SIZE = 8;

export class ExportCancelledError extends Error {
  constructor() {
    super('The export was cancelled.');
    this.name = 'ExportCancelledError';
  }
}

export interface RenderSingleFrameOptions {
  readonly frame: number;
  readonly sequence: Sequence;
  readonly assets: readonly Asset[];
  readonly compositionTrees?: ReadonlyMap<string, SceneTree>;
  readonly maxWidth?: number;
}

export interface RenderedSingleFrame {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface RenderExportOptions {
  readonly result: ExportStartResult;
  readonly sequence: Sequence;
  readonly assets: readonly Asset[];
  readonly compositionTrees?: ReadonlyMap<string, SceneTree>;
  readonly writeFrames: (frames: readonly ExportFrame[]) => Promise<void>;
  readonly onProgress?: (rendered: number, total: number) => void;
  readonly isCancelled?: () => boolean;
  readonly batchSize?: number;
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
 * Renders the same compositor used by the preview into PNG frames. Frames cross
 * to the main process in small batches: enough to amortise IPC, but bounded so
 * large exports do not have to live in memory.
 */
export async function renderExportFrames({
  result,
  sequence,
  assets,
  compositionTrees,
  writeFrames,
  onProgress,
  isCancelled = () => false,
  batchSize = EXPORT_FRAME_BATCH_SIZE,
}: RenderExportOptions): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = result.width;
  canvas.height = result.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('The renderer could not create an export canvas.');
  }

  const pool = new MediaPool(assets);
  const limit = Math.max(1, Math.min(16, Math.floor(batchSize)));
  try {
    const ids = visualAssetIds(sequence, result.startFrame, result.endFrame);
    await waitForMedia(pool, ids, isCancelled);
    let batch: ExportFrame[] = [];
    let rendered = 0;
    const flush = async () => {
      if (batch.length === 0) {
        return;
      }
      // Await the main process before rendering more frames. This keeps the
      // in-flight PNG bytes bounded while still amortising the IPC cost.
      await writeFrames(batch);
      rendered += batch.length;
      batch = [];
      onProgress?.(rendered, result.frameCount);
    };
    for (let frame = result.startFrame; frame < result.endFrame; frame += 1) {
      if (isCancelled()) {
        throw new ExportCancelledError();
      }
      await seekFrameMedia(sequence, frame, pool, isCancelled);
      renderFrame(context, sequence, frame, { pool, compositionTrees });
      const blob = await canvasToPng(canvas);
      batch.push({
        index: frame - result.startFrame,
        data: new Uint8Array(await blob.arrayBuffer()),
      });
      if (batch.length >= limit) {
        await flush();
      }
    }
    await flush();
  } finally {
    pool.dispose();
  }
}

/**
 * Renders one frame at sequence resolution, then downsamples only for the
 * returned PNG. Rendering at full size first keeps captions and overlays in the
 * same proportion as the preview and export.
 */
export async function renderSingleFrame({
  frame,
  sequence,
  assets,
  compositionTrees,
  maxWidth,
}: RenderSingleFrameOptions): Promise<RenderedSingleFrame> {
  const canvas = document.createElement('canvas');
  canvas.width = sequence.width;
  canvas.height = sequence.height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    throw new Error('The renderer could not create a still-frame canvas.');
  }

  const pool = new MediaPool(assets);
  try {
    const ids = visualAssetIds(sequence, frame, frame + 1);
    await waitForMedia(pool, ids, () => false);
    await seekFrameMedia(sequence, frame, pool, () => false);
    renderFrame(context, sequence, frame, { pool, compositionTrees });

    const output = canvas;
    const width = Math.max(
      1,
      Math.round(Math.min(sequence.width, maxWidth ?? sequence.width)),
    );
    const height = Math.max(
      1,
      Math.round((width / sequence.width) * sequence.height),
    );
    if (width !== canvas.width) {
      const scaled = document.createElement('canvas');
      scaled.width = width;
      scaled.height = height;
      const scaledContext = scaled.getContext('2d', { alpha: false });
      if (!scaledContext) {
        throw new Error('The renderer could not create a scaled still frame.');
      }
      scaledContext.drawImage(canvas, 0, 0, width, height);
      const blob = await canvasToPng(scaled);
      return {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        width,
        height,
      };
    }

    const blob = await canvasToPng(output);
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      width: output.width,
      height: output.height,
    };
  } finally {
    pool.dispose();
  }
}
