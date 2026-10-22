import type {
  Asset,
  BlendMode,
  CaptionClip,
  Clip,
  Sequence,
  ShapeClip,
  TextClip,
  TextStyle,
} from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { sourceFrameAt, tracksInOrder } from '@kerf/engine';
import { MediaPool } from './media-pool';

export interface RenderFrameOptions {
  readonly pool: MediaPool;
  readonly selectedClipId?: string | null;
  /** Pass null to show the checkerboard through the frame. */
  readonly background?: string | null;
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

function sourceSize(source: HTMLVideoElement | HTMLImageElement): Point {
  return source instanceof HTMLVideoElement
    ? { x: source.videoWidth, y: source.videoHeight }
    : { x: source.naturalWidth, y: source.naturalHeight };
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

function withClipTransform(
  context: CanvasRenderingContext2D,
  clip: Clip,
  origin: Point,
  draw: () => void,
): void {
  const transform = clip.transform;
  context.save();
  context.translate(origin.x + transform.x, origin.y + transform.y);
  context.rotate((transform.rotation * Math.PI) / 180);
  context.scale(transform.scale, transform.scale);
  context.globalAlpha = transform.opacity;
  context.globalCompositeOperation = BLEND_MODES[clip.blendMode];
  draw();
  context.restore();
}

function drawMedia(
  context: CanvasRenderingContext2D,
  clip: Clip,
  pool: MediaPool,
  width: number,
  height: number,
): boolean {
  if (clip.type !== 'video' && clip.type !== 'image') {
    return false;
  }
  const media = pool.media(clip.assetId);
  if (!mediaReady(media) || !media) {
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

function setFont(context: CanvasRenderingContext2D, style: TextStyle): void {
  context.font = `${style.fontWeight} ${style.fontSize}px "${style.fontFamily}"`;
  const withSpacing = context as CanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  withSpacing.letterSpacing = `${style.letterSpacing}px`;
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (
        current.length > 0 &&
        context.measureText(candidate).width > maxWidth
      ) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) {
      lines.push(current);
    }
  }
  return lines;
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
  } else {
    drawCheckerboard(context, width, height);
  }

  const missing = new Set<string>();
  let drawn = 0;

  for (const track of tracksInOrder(sequence)) {
    if (track.hidden || track.kind === 'audio') {
      continue;
    }
    const clip = clipAtFrame(sequence, track.id, frame);
    if (!clip) {
      continue;
    }
    if (clip.type === 'composition') {
      continue;
    }
    const drawnLayer = (() => {
      if (clip.type === 'video' || clip.type === 'image') {
        if (!mediaReady(options.pool.media(clip.assetId))) {
          missing.add(clip.assetId);
          return false;
        }
        withClipTransform(context, clip, { x: width / 2, y: height / 2 }, () =>
          drawMedia(context, clip, options.pool, width, height),
        );
        return true;
      }
      if (clip.type === 'text') {
        withClipTransform(context, clip, { x: width / 2, y: height / 2 }, () =>
          drawText(context, clip, width),
        );
        return true;
      }
      if (clip.type === 'caption') {
        withClipTransform(
          context,
          clip,
          { x: width / 2, y: height * 0.84 },
          () => drawCaption(context, clip, width, frame),
        );
        return true;
      }
      if (clip.type === 'shape') {
        withClipTransform(context, clip, { x: width / 2, y: height / 2 }, () =>
          drawPath(context, clip, width, height),
        );
        return true;
      }
      return false;
    })();
    if (drawnLayer) {
      drawn += 1;
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
