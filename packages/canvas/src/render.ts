import type {
  Asset,
  BlendMode,
  CaptionClip,
  Clip,
  FxOverlayClip,
  Sequence,
  ShapeClip,
  TextClip,
} from '@kerf/model';
import { fpsToNumber, sampleTransform } from '@kerf/model';
import { clipsAtFrame, sourceFrameAt, tracksInOrder } from '@kerf/engine';
import { renderSceneTree } from '@kerf/motion';
import type { SceneTree } from '@kerf/motion';
import { MediaPool, mediaElementReady } from './media-pool';
import type { MediaQuality } from './media-pool';
import { drawOverlay } from './overlays';
import { setFont, wrapText } from './text';

export interface RenderFrameOptions {
  readonly pool: MediaPool;
  readonly selectedClipId?: string | null;
  /** Pass null to show the checkerboard through the frame. */
  readonly background?: string | null;
  readonly compositionTrees?: ReadonlyMap<string, SceneTree>;
  /** Video quality for base layers. Defaults to the pool's default quality. */
  readonly mediaQuality?: MediaQuality;
  /** Video quality used under a magnifier lens. Defaults to `source`. */
  readonly lensQuality?: MediaQuality;
}

export interface RenderStats {
  readonly drawn: number;
  readonly missingAssets: readonly string[];
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface TextLine {
  readonly words: readonly TextWord[];
  readonly width: number;
}

interface TextWord {
  readonly text: string;
  readonly width: number;
  readonly active: boolean;
}

const BLEND_MODES: Record<BlendMode, GlobalCompositeOperation> = {
  normal: 'source-over',
  screen: 'screen',
  multiply: 'multiply',
  overlay: 'overlay',
  add: 'lighter',
};

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

/**
 * Clip source frames are measured in sequence frames, not asset frames. That
 * keeps `sourceFrameAt` linear in timeline time even when the source and
 * sequence frame rates differ. Convert with the sequence rate so a 30 fps
 * source on a 24 fps timeline still advances one second per second.
 */
export function mediaSourceSeconds(
  clip: Clip,
  frame: number,
  asset: Asset | undefined,
  sequence: Sequence,
): number {
  if (clip.type !== 'video' && clip.type !== 'audio') {
    return 0;
  }
  const fps = fpsToNumber(sequence.frameRate);
  const seconds = Math.max(0, sourceFrameAt(clip, frame) / fps);
  return asset && asset.durationSeconds > 0
    ? Math.min(seconds, asset.durationSeconds)
    : seconds;
}

function mediaReady(
  element: HTMLVideoElement | HTMLImageElement | null,
): boolean {
  return mediaElementReady(element);
}

function sourceSize(source: HTMLVideoElement | HTMLImageElement): Point {
  const media = source as unknown as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  if (typeof media.videoWidth === 'number') {
    return { x: media.videoWidth, y: media.videoHeight ?? 0 };
  }
  return { x: media.naturalWidth ?? 0, y: media.naturalHeight ?? 0 };
}

function fitBox(
  source: Point,
  box: Point,
  fit: 'contain' | 'cover' | 'fill',
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  if (fit === 'fill') {
    return { x: 0, y: 0, width: box.x, height: box.y };
  }
  const scale =
    fit === 'cover'
      ? Math.max(box.x / source.x, box.y / source.y)
      : Math.min(box.x / source.x, box.y / source.y);
  const width = source.x * scale;
  const height = source.y * scale;
  return {
    x: (box.x - width) / 2,
    y: (box.y - height) / 2,
    width,
    height,
  };
}

export function effectsFilter(clip: Clip): string {
  const filters = clip.effects
    .filter((effect) => effect.enabled)
    .map((effect) => {
      const amount = effect.amount;
      switch (effect.type) {
        case 'blur':
          return `blur(${amount}px)`;
        case 'brightness':
          return `brightness(${amount})`;
        case 'contrast':
          return `contrast(${amount})`;
        case 'saturate':
          return `saturate(${amount})`;
        case 'grayscale':
          return `grayscale(${amount})`;
        case 'sepia':
          return `sepia(${amount})`;
        case 'hue-rotate':
          return `hue-rotate(${amount}deg)`;
        case 'drop-shadow':
          return `drop-shadow(0 0 ${amount}px rgba(0, 0, 0, 0.55))`;
      }
    });
  return filters.length > 0 ? filters.join(' ') : 'none';
}

export function clipFadeOpacity(clip: Clip, localFrame: number): number {
  if (clip.type !== 'video' && clip.type !== 'audio') {
    return 1;
  }
  let opacity = 1;
  if (clip.fade.inFrames > 0 && localFrame < clip.fade.inFrames) {
    opacity *= Math.max(0, localFrame / clip.fade.inFrames);
  }
  const outStart = clip.durationFrames - clip.fade.outFrames;
  if (clip.fade.outFrames > 0 && localFrame > outStart) {
    opacity *= Math.max(
      0,
      (clip.durationFrames - localFrame) / clip.fade.outFrames,
    );
  }
  return Math.min(1, Math.max(0, opacity));
}

function applyMasks(
  context: CanvasRenderingContext2D,
  clip: Clip,
  width: number,
  height: number,
): void {
  if (clip.masks.length === 0) {
    return;
  }
  const path = new Path2D();
  const inverted = clip.masks.some((mask) => mask.inverted);
  if (inverted) {
    path.rect(-width / 2, -height / 2, width, height);
  }
  for (const mask of clip.masks) {
    const x = -width / 2 + mask.x * width;
    const y = -height / 2 + mask.y * height;
    const maskWidth = mask.width * width;
    const maskHeight = mask.height * height;
    if (mask.type === 'ellipse') {
      path.ellipse(
        x + maskWidth / 2,
        y + maskHeight / 2,
        maskWidth / 2,
        maskHeight / 2,
        0,
        0,
        Math.PI * 2,
      );
    } else if (mask.type === 'path' && mask.path) {
      try {
        const subpath = new Path2D(mask.path);
        const matrix = new DOMMatrix()
          .translate(x, y)
          .scale(maskWidth, maskHeight);
        path.addPath(subpath, matrix);
      } catch {
        path.rect(x, y, maskWidth, maskHeight);
      }
    } else {
      path.rect(x, y, maskWidth, maskHeight);
    }
  }
  context.clip(path, inverted ? 'evenodd' : 'nonzero');
}

function withClipTransform(
  context: CanvasRenderingContext2D,
  clip: Clip,
  frame: number,
  width: number,
  height: number,
  origin: Point,
  draw: () => void,
): void {
  const localFrame = frame - clip.startFrame;
  const transform = sampleTransform(clip.transform, clip.keyframes, localFrame);
  context.save();
  context.translate(origin.x + transform.x, origin.y + transform.y);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.scale(transform.scale, transform.scale);
  context.translate(
    (0.5 - transform.anchorX) * width,
    (0.5 - transform.anchorY) * height,
  );
  context.globalAlpha = transform.opacity * clipFadeOpacity(clip, localFrame);
  context.globalCompositeOperation = BLEND_MODES[clip.blendMode];
  context.filter = effectsFilter(clip);
  applyMasks(context, clip, width, height);
  draw();
  context.restore();
}

function drawComposition(
  context: CanvasRenderingContext2D,
  clip: Extract<Clip, { type: 'composition' }>,
  width: number,
  height: number,
  tree: SceneTree | undefined,
): void {
  if (tree) {
    // Scene trees use top-left percentage coordinates; the compositor is
    // centred on the frame before drawing clips.
    context.save();
    context.translate(-width / 2, -height / 2);
    renderSceneTree(context, tree, width, height);
    context.restore();
    return;
  }
  drawCompositionPlaceholder(context, clip, width, height);
}

function drawCompositionPlaceholder(
  context: CanvasRenderingContext2D,
  clip: Extract<Clip, { type: 'composition' }>,
  width: number,
  height: number,
): void {
  context.fillStyle = 'rgba(17, 19, 21, 0.9)';
  context.fillRect(-width / 2, -height / 2, width, height);
  context.strokeStyle = 'rgba(201, 164, 106, 0.7)';
  context.lineWidth = 3;
  context.setLineDash([10, 8]);
  context.strokeRect(-width / 2 + 4, -height / 2 + 4, width - 8, height - 8);
  context.setLineDash([]);
  context.fillStyle = '#ece6dc';
  context.font = '600 34px "Instrument Sans"';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(clip.name, 0, 0);
}

/**
 * Picks the requested media slot, falling back to the other slot when the
 * requested one is not ready. A zoom lens therefore shows proxy footage until
 * the source slot loads instead of showing an empty lens.
 */
function selectMedia(
  pool: MediaPool,
  assetId: string,
  quality: MediaQuality,
): HTMLVideoElement | HTMLImageElement | null {
  const requested = pool.media(assetId, quality);
  if (mediaReady(requested)) {
    return requested;
  }
  const fallback = pool.media(
    assetId,
    quality === 'source' ? 'proxy' : 'source',
  );
  return mediaReady(fallback) ? fallback : requested;
}

function drawMedia(
  context: CanvasRenderingContext2D,
  clip: Clip,
  media: HTMLVideoElement | HTMLImageElement,
  width: number,
  height: number,
): boolean {
  if (clip.type !== 'video' && clip.type !== 'image') {
    return false;
  }
  const source = sourceSize(media);
  if (source.x <= 0 || source.y <= 0) {
    return false;
  }
  const fit = clip.type === 'image' ? clip.fit : 'contain';
  const box = fitBox(source, { x: width, y: height }, fit);
  context.drawImage(
    media,
    -width / 2 + box.x,
    -height / 2 + box.y,
    box.width,
    box.height,
  );
  return true;
}

function drawText(
  context: CanvasRenderingContext2D,
  clip: TextClip,
  width: number,
): void {
  const style = clip.style;
  setFont(context, style);
  const maxWidth = width * 0.82;
  const lines = wrapText(context, clip.text, maxWidth);
  const lineHeight = style.fontSize * style.lineHeight;
  const measured = lines.map((line) => context.measureText(line).width);
  const textWidth = Math.max(0, ...measured);
  const boxWidth = textWidth + style.padding * 2;
  const boxHeight = lines.length * lineHeight + style.padding * 2;
  const left = -boxWidth / 2;
  const top = -boxHeight / 2;

  if (style.background) {
    context.fillStyle = style.background;
    context.fillRect(left, top, boxWidth, boxHeight);
  }
  context.fillStyle = style.color;
  context.textBaseline = 'middle';
  lines.forEach((line, index) => {
    let x = 0;
    if (style.align === 'left') {
      x = left + style.padding;
      context.textAlign = 'left';
    } else if (style.align === 'right') {
      x = -left - style.padding;
      context.textAlign = 'right';
    } else {
      context.textAlign = 'center';
    }
    context.fillText(line, x, top + style.padding + lineHeight * (index + 0.5));
  });
}

function captionWords(
  clip: CaptionClip,
  localFrame: number,
  timelineFrame: number,
): TextWord[] {
  if (clip.words.length > 0) {
    const localActive = clip.words.some(
      (word) => word.startFrame <= localFrame && localFrame < word.endFrame,
    );
    return clip.words.map((word) => {
      const active = localActive
        ? word.startFrame <= localFrame && localFrame < word.endFrame
        : word.startFrame <= timelineFrame && timelineFrame < word.endFrame;
      return { text: word.text, width: 0, active };
    });
  }
  const words = clip.text.split(/\s+/).filter(Boolean);
  const step = Math.max(1, clip.durationFrames / Math.max(1, words.length));
  return words.map((text, index) => ({
    text,
    width: 0,
    active:
      localFrame >= Math.floor(index * step) &&
      localFrame < Math.floor((index + 1) * step),
  }));
}

function drawCaption(
  context: CanvasRenderingContext2D,
  clip: CaptionClip,
  width: number,
  frame: number,
): void {
  const style = clip.style;
  setFont(context, style);
  const maxWidth = width * 0.82;
  const words = captionWords(clip, frame - clip.startFrame, frame);
  const lines: TextLine[] = [];
  let current: TextWord[] = [];
  let currentWidth = 0;
  const spaceWidth = context.measureText(' ').width;
  for (const word of words) {
    const measured = { ...word, width: context.measureText(word.text).width };
    const nextWidth =
      currentWidth + (current.length > 0 ? spaceWidth : 0) + measured.width;
    if (current.length > 0 && nextWidth > maxWidth) {
      lines.push({ words: current, width: currentWidth });
      current = [measured];
      currentWidth = measured.width;
    } else {
      current = [...current, measured];
      currentWidth = nextWidth;
    }
  }
  if (current.length > 0) {
    lines.push({ words: current, width: currentWidth });
  }

  const lineHeight = style.fontSize * style.lineHeight;
  const textWidth = Math.max(0, ...lines.map((line) => line.width));
  const boxWidth = textWidth + style.padding * 2;
  const boxHeight = lines.length * lineHeight + style.padding * 2;
  const left = -boxWidth / 2;
  const top = -boxHeight / 2;

  context.fillStyle = style.background ?? 'rgba(11, 12, 13, 0.74)';
  context.fillRect(left, top, boxWidth, boxHeight);
  context.textBaseline = 'middle';
  context.textAlign = 'left';

  lines.forEach((line, lineIndex) => {
    let x = -line.width / 2;
    const y = top + style.padding + lineHeight * (lineIndex + 0.5);
    for (const word of line.words) {
      if (word.active) {
        context.fillStyle = 'rgba(201, 164, 106, 0.22)';
        context.fillRect(x - 3, y - lineHeight / 2, word.width + 6, lineHeight);
        context.fillStyle = '#c9a46a';
      } else {
        context.fillStyle = style.color;
      }
      context.fillText(word.text, x, y);
      x += word.width + spaceWidth;
    }
  });
}

function drawPath(
  context: CanvasRenderingContext2D,
  clip: ShapeClip,
  width: number,
  height: number,
): void {
  const boxWidth = clip.width * width;
  const boxHeight = clip.height * height;
  context.beginPath();
  if (clip.shape === 'ellipse') {
    context.ellipse(0, 0, boxWidth / 2, boxHeight / 2, 0, 0, Math.PI * 2);
  } else if (clip.shape === 'path' && clip.path) {
    try {
      const path = new Path2D(clip.path);
      context.save();
      context.scale(boxWidth, boxHeight);
      context.fill(path);
      if (clip.stroke && clip.strokeWidth > 0) {
        context.lineWidth = clip.strokeWidth / Math.max(boxWidth, boxHeight);
        context.strokeStyle = clip.stroke;
        context.stroke(path);
      }
      context.restore();
      return;
    } catch {
      context.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
    }
  } else {
    context.rect(-boxWidth / 2, -boxHeight / 2, boxWidth, boxHeight);
  }
  context.fillStyle = clip.fill;
  context.fill();
  if (clip.stroke && clip.strokeWidth > 0) {
    context.strokeStyle = clip.stroke;
    context.lineWidth = clip.strokeWidth;
    context.stroke();
  }
}

function drawCheckerboard(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const size = 24;
  context.fillStyle = '#101214';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#15181a';
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((Math.floor(x / size) + Math.floor(y / size)) % 2 === 0) {
        context.fillRect(x, y, size, size);
      }
    }
  }
}

interface LayerContext {
  readonly pool: MediaPool;
  readonly quality: MediaQuality;
  readonly compositionTrees?: ReadonlyMap<string, SceneTree>;
}

function isDeferredLayer(clip: Clip): boolean {
  return clip.type === 'text' || clip.type === 'caption';
}

/** Draws one base visual layer. Overlay clips never enter this path. */
function drawVisualClip(
  context: CanvasRenderingContext2D,
  clip: Clip,
  frame: number,
  width: number,
  height: number,
  layer: LayerContext,
): boolean {
  if (clip.type === 'video' || clip.type === 'image') {
    const media = selectMedia(layer.pool, clip.assetId, layer.quality);
    if (!media) {
      return false;
    }
    withClipTransform(
      context,
      clip,
      frame,
      width,
      height,
      { x: width / 2, y: height / 2 },
      () => drawMedia(context, clip, media, width, height),
    );
    return true;
  }
  if (clip.type === 'text') {
    withClipTransform(
      context,
      clip,
      frame,
      width,
      height,
      { x: width / 2, y: height / 2 },
      () => drawText(context, clip, width),
    );
    return true;
  }
  if (clip.type === 'caption') {
    withClipTransform(
      context,
      clip,
      frame,
      width,
      height,
      { x: width / 2, y: height * 0.84 },
      () => drawCaption(context, clip, width, frame),
    );
    return true;
  }
  if (clip.type === 'shape') {
    withClipTransform(
      context,
      clip,
      frame,
      width,
      height,
      { x: width / 2, y: height / 2 },
      () => drawPath(context, clip, width, height),
    );
    return true;
  }
  if (clip.type === 'composition') {
    withClipTransform(
      context,
      clip,
      frame,
      width,
      height,
      { x: width / 2, y: height / 2 },
      () =>
        drawComposition(
          context,
          clip,
          width,
          height,
          layer.compositionTrees?.get(clip.compositionId),
        ),
    );
    return true;
  }
  return false;
}

export function renderFrame(
  context: CanvasRenderingContext2D,
  sequence: Sequence,
  frame: number,
  options: RenderFrameOptions,
): RenderStats {
  const { width, height } = context.canvas;
  const quality = options.mediaQuality ?? options.pool.defaultQuality;
  const lensQuality = options.lensQuality ?? 'source';
  context.save();
  context.clearRect(0, 0, width, height);
  const background =
    options.background === undefined
      ? sequence.style.background
      : options.background;
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
  } else {
    drawCheckerboard(context, width, height);
  }

  const missing = new Set<string>();
  let drawn = 0;

  const tracks = tracksInOrder(sequence).filter(
    (track) => !track.hidden && track.kind !== 'audio',
  );

  const baseLayers: Clip[] = [];
  const effectsLayers: FxOverlayClip[] = [];
  for (const track of tracks) {
    if (track.kind === 'effects') {
      for (const clip of clipsAtFrame(track, frame)) {
        if (clip.type === 'fxOverlay') {
          effectsLayers.push(clip);
        }
      }
      continue;
    }
    const clip = clipAtFrame(sequence, track.id, frame);
    if (clip) {
      baseLayers.push(clip);
    }
  }

  const paint = (clip: Clip): void => {
    const painted = drawVisualClip(context, clip, frame, width, height, {
      pool: options.pool,
      quality,
      compositionTrees: options.compositionTrees,
    });
    if (painted) {
      drawn += 1;
    } else if (clip.type === 'video' || clip.type === 'image') {
      missing.add(clip.assetId);
    }
  };

  // Without an active overlay this is the original single pass, preserving
  // the existing z-order for projects that never use effects.
  const hasOverlay = effectsLayers.length > 0;
  for (const clip of baseLayers) {
    if (hasOverlay && isDeferredLayer(clip)) {
      continue;
    }
    paint(clip);
  }

  if (hasOverlay) {
    const zoomLayers = baseLayers.filter((clip) => !isDeferredLayer(clip));
    const drawLayer = (
      layerContext: CanvasRenderingContext2D,
      clip: Clip,
      layerQuality: MediaQuality,
    ): boolean =>
      drawVisualClip(layerContext, clip, frame, width, height, {
        pool: options.pool,
        quality: layerQuality,
        compositionTrees: options.compositionTrees,
      });

    const paintBackdrop = (backdropContext: CanvasRenderingContext2D): void => {
      if (background) {
        backdropContext.fillStyle = background;
        backdropContext.fillRect(0, 0, width, height);
      } else {
        drawCheckerboard(backdropContext, width, height);
      }
    };

    const overlayOptions = {
      width,
      height,
      lensQuality,
      layers: zoomLayers,
      drawLayer,
      paintBackdrop,
    };

    for (const overlay of effectsLayers) {
      if (drawOverlay(context, overlay, frame, sequence, overlayOptions)) {
        drawn += 1;
      }
    }

    // Effects sit above footage but below text and captions, so deferred
    // layers are painted last at their normal scale.
    for (const clip of baseLayers) {
      if (isDeferredLayer(clip)) {
        paint(clip);
      }
    }
  }

  if (options.selectedClipId) {
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = sequence.style.accent;
    context.lineWidth = 2;
    context.setLineDash([7, 5]);
    context.strokeRect(2, 2, width - 4, height - 4);
    context.setLineDash([]);
  }

  context.restore();
  return { drawn, missingAssets: [...missing] };
}
