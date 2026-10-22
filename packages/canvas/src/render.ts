import type { Asset, Clip, Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { sourceFrameAt, visualTracksInOrder } from '@kerf/engine';
import { MediaPool } from './media-pool';

export interface RenderFrameOptions {
  readonly pool: MediaPool;
  readonly selectedClipId?: string | null;
  /** Preview keeps the sequence background; export does the same by default. */
  readonly background?: string | null;
}

export interface RenderStats {
  readonly drawn: number;
  readonly missingAssets: readonly string[];
}

export function clipAtFrame(
  sequence: Sequence,
  trackId: string,
  frame: number,
): Clip | null {
  const track = sequence.tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    return null;
  }
  return (
    track.clips.find(
      (clip) =>
        clip.startFrame <= frame &&
        frame < clip.startFrame + clip.durationFrames,
    ) ?? null
  );
}

export function mediaSourceSeconds(
  clip: Clip,
  frame: number,
  asset: Asset | undefined,
  sequence: Sequence,
): number {
  if (clip.type !== 'video' && clip.type !== 'audio') {
    return 0;
  }
  const rate = asset?.frameRate ?? sequence.frameRate;
  const fps = fpsToNumber(rate);
  return Math.max(0, sourceFrameAt(clip, frame) / fps);
}

function drawContain(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
): void {
  const sourceWidth =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source instanceof HTMLImageElement
        ? source.naturalWidth
        : width;
  const sourceHeight =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source instanceof HTMLImageElement
        ? source.naturalHeight
        : height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return;
  }
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function mediaReady(
  element: HTMLVideoElement | HTMLImageElement | null,
): boolean {
  if (!element) {
    return false;
  }
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= 2 && element.videoWidth > 0;
  }
  return element.complete && element.naturalWidth > 0;
}

export function renderFrame(
  context: CanvasRenderingContext2D,
  sequence: Sequence,
  frame: number,
  options: RenderFrameOptions,
): RenderStats {
  const { width, height } = context.canvas;
  context.save();
  context.clearRect(0, 0, width, height);
  const background =
    options.background === undefined
      ? sequence.style.background
      : options.background;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  }

  const missing = new Set<string>();
  let drawn = 0;

  for (const track of visualTracksInOrder(sequence)) {
    if (track.hidden) {
      continue;
    }
    const clip = clipAtFrame(sequence, track.id, frame);
    if (!clip) {
      continue;
    }
    if (clip.type !== 'video' && clip.type !== 'image') {
      continue;
    }
    const media = options.pool.media(clip.assetId);
    if (!mediaReady(media)) {
      missing.add(clip.assetId);
      continue;
    }
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    drawContain(context, media!, width, height);
    drawn += 1;

    if (options.selectedClipId === clip.id) {
      context.globalAlpha = 1;
      context.strokeStyle = sequence.style.accent;
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      context.strokeRect(2, 2, width - 4, height - 4);
      context.setLineDash([]);
    }
  }

  context.restore();
  return { drawn, missingAssets: [...missing] };
}
