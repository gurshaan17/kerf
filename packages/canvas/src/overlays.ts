import type {
  Clip,
  FxOverlayClip,
  NormalizedPoint,
  NormalizedRegion,
  OverlayEasing,
  OverlayProps,
  OverlayShape,
  Sequence,
} from '@kerf/model';
import { sampleTransform } from '@kerf/model';
import type { MediaQuality } from './media-pool';
import { blurSurfaceRegion, scratchSurface } from './scratch';
import { wrapText } from './text';

/** Draws one base visual layer in content space. `quality` selects video media. */
export type DrawLayer = (
  context: CanvasRenderingContext2D,
  clip: Clip,
  quality: MediaQuality,
) => boolean;

export interface OverlayDrawOptions {
  readonly width: number;
  readonly height: number;
  /** Quality used to redraw footage under a magnifier lens. */
  readonly lensQuality: MediaQuality;
  /** Base visual layers active at the frame, in draw order. */
  readonly layers: readonly Clip[];
  readonly drawLayer: DrawLayer;
  /** Repaints the frame backdrop under a magnifier lens, in canvas pixels. */
  readonly paintBackdrop: (context: CanvasRenderingContext2D) => void;
}

interface PixelRegion {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface PixelPoint {
  readonly x: number;
  readonly y: number;
}

const OVERLAY_FONT = '"Instrument Sans", "Inter", sans-serif';

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function easeProgress(easing: OverlayEasing, value: number): number {
  const progress = clamp01(value);
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-in':
      return progress * progress;
    case 'ease-out':
      return 1 - (1 - progress) * (1 - progress);
    case 'ease-in-out':
      return progress < 0.5
        ? 2 * progress * progress
        : 1 - 2 * (1 - progress) * (1 - progress);
  }
}

/**
 * Transition alpha for an overlay. The model and engine clamp transitions, but
 * the renderer re-checks so a hand-built sequence cannot fade past 1 or 0.
 */
export function overlayTransitionOpacity(
  props: OverlayProps,
  localFrame: number,
  durationFrames: number,
): number {
  const duration = Math.max(1, durationFrames);
  const frame = Math.min(Math.max(0, localFrame), duration);
  const limit = Math.floor(duration / 2);
  const inFrames = Math.max(0, Math.min(props.transitionInFrames, limit));
  let outFrames = Math.max(0, Math.min(props.transitionOutFrames, limit));
  if (inFrames + outFrames > duration) {
    outFrames = Math.max(0, duration - inFrames);
  }

  let opacity = 1;
  if (inFrames > 0 && frame < inFrames) {
    opacity *= easeProgress(props.easing, frame / inFrames);
  }
  const outStart = duration - outFrames;
  if (outFrames > 0 && frame >= outStart) {
    opacity *= easeProgress(props.easing, (duration - frame) / outFrames);
  }
  return clamp01(opacity);
}

function regionPixels(
  region: NormalizedRegion,
  width: number,
  height: number,
): PixelRegion {
  return {
    x: region.x * width,
    y: region.y * height,
    w: Math.max(1, region.w * width),
    h: Math.max(1, region.h * height),
  };
}

function pointPixels(
  point: NormalizedPoint,
  width: number,
  height: number,
): PixelPoint {
  return { x: point.x * width, y: point.y * height };
}

/** Builds the overlay outline in canvas pixels. */
function traceRegion(
  context: CanvasRenderingContext2D,
  region: PixelRegion,
  shape: OverlayShape,
  cornerRadius: number,
): void {
  context.beginPath();
  if (shape === 'ellipse') {
    context.ellipse(
      region.x + region.w / 2,
      region.y + region.h / 2,
      region.w / 2,
      region.h / 2,
      0,
      0,
      Math.PI * 2,
    );
    return;
  }
  const radius = Math.max(
    0,
    Math.min(cornerRadius, region.w / 2, region.h / 2),
  );
  if (radius > 0 && typeof context.roundRect === 'function') {
    context.roundRect(region.x, region.y, region.w, region.h, radius);
    return;
  }
  context.rect(region.x, region.y, region.w, region.h);
}

function layerBounds(
  layer: Clip,
  frame: number,
  width: number,
  height: number,
): PixelRegion {
  if (layer.type !== 'shape') {
    return { x: 0, y: 0, w: width, h: height };
  }
  const transform = sampleTransform(
    layer.transform,
    layer.keyframes,
    frame - layer.startFrame,
  );
  const w = Math.max(1, layer.width * width * transform.scale);
  const h = Math.max(1, layer.height * height * transform.scale);
  return {
    x: width / 2 + transform.x - w / 2,
    y: height / 2 + transform.y - h / 2,
    w,
    h,
  };
}

function intersects(left: PixelRegion, right: PixelRegion): boolean {
  return (
    left.x < right.x + right.w &&
    right.x < left.x + left.w &&
    left.y < right.y + right.h &&
    right.y < left.y + left.h
  );
}

function drawBlur(
  context: CanvasRenderingContext2D,
  props: Extract<OverlayProps, { kind: 'blur' }>,
  region: PixelRegion,
  unit: number,
  opacity: number,
): void {
  const x = Math.round(region.x);
  const y = Math.round(region.y);
  const width = Math.max(1, Math.round(region.w));
  const height = Math.max(1, Math.round(region.h));
  const radius = Math.max(1, Math.round(props.amount * unit));

  context.save();
  traceRegion(context, region, props.shape, props.cornerRadius * unit);
  context.clip();
  context.globalAlpha *= opacity;

  if (props.mode === 'pixelate') {
    const block = Math.max(2, radius);
    const smallWidth = Math.max(1, Math.ceil(width / block));
    const smallHeight = Math.max(1, Math.ceil(height / block));
    const small = scratchSurface('overlay-pixelate', smallWidth, smallHeight);
    small.context.imageSmoothingEnabled = false;
    small.context.drawImage(
      context.canvas,
      x,
      y,
      width,
      height,
      0,
      0,
      smallWidth,
      smallHeight,
    );
    context.imageSmoothingEnabled = false;
    context.drawImage(
      small.canvas,
      0,
      0,
      smallWidth,
      smallHeight,
      x,
      y,
      width,
      height,
    );
    context.imageSmoothingEnabled = true;
  } else {
    const surface = scratchSurface('overlay-blur', width, height);
    surface.context.drawImage(
      context.canvas,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height,
    );
    blurSurfaceRegion(surface.context, 0, 0, width, height, radius);
    context.drawImage(surface.canvas, x, y, width, height);
  }

  context.restore();
}

function drawSpotlight(
  context: CanvasRenderingContext2D,
  props: Extract<OverlayProps, { kind: 'spotlight' }>,
  region: PixelRegion,
  width: number,
  height: number,
  unit: number,
  opacity: number,
): void {
  const feather = Math.max(0, props.feather * unit);
  const mask = scratchSurface('overlay-spotlight', width, height);
  const maskContext = mask.context;
  maskContext.fillStyle = props.color;
  maskContext.fillRect(0, 0, width, height);
  maskContext.globalCompositeOperation = 'destination-out';
  traceRegion(maskContext, region, props.shape, props.cornerRadius * unit);
  maskContext.fill();
  maskContext.globalCompositeOperation = 'source-over';

  if (feather > 0) {
    const pad = Math.ceil(feather * 3) + 2;
    blurSurfaceRegion(
      maskContext,
      region.x - pad,
      region.y - pad,
      region.w + pad * 2,
      region.h + pad * 2,
      Math.max(1, Math.round(feather)),
    );
  }

  context.save();
  context.globalAlpha *= opacity * props.dim;
  context.drawImage(mask.canvas, 0, 0);
  context.restore();
}

function drawCallout(
  context: CanvasRenderingContext2D,
  props: Extract<OverlayProps, { kind: 'callout' }>,
  region: PixelRegion,
  width: number,
  height: number,
  unit: number,
  opacity: number,
): void {
  const radius = props.cornerRadius * unit;
  const borderWidth = Math.max(0, props.borderWidth * unit);

  context.save();
  context.globalAlpha *= opacity;
  traceRegion(context, region, props.shape, radius);
  context.fillStyle = props.background;
  context.fill();
  if (borderWidth > 0) {
    context.strokeStyle = props.borderColor;
    context.lineWidth = borderWidth;
    context.stroke();
  }

  const fontSize = Math.max(6, props.fontSize * unit);
  const padding = fontSize * 0.7;
  context.font = `600 ${fontSize}px ${OVERLAY_FONT}`;
  context.fillStyle = props.textColor;
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  const maxWidth = Math.max(1, region.w - padding * 2);
  const lines = wrapText(context, props.text, maxWidth);
  const lineHeight = fontSize * 1.25;
  const blockHeight = lines.length * lineHeight;
  const top = region.y + region.h / 2 - blockHeight / 2;
  lines.forEach((line, index) => {
    const lineWidth = context.measureText(line).width;
    const x = region.x + region.w / 2 - lineWidth / 2;
    context.fillText(line, x, top + lineHeight * (index + 0.5));
  });
  context.restore();

  if (!props.pointer) {
    return;
  }
  const pointer = pointPixels(props.pointer, width, height);
  const edge = {
    x: Math.min(Math.max(pointer.x, region.x), region.x + region.w),
    y: Math.min(Math.max(pointer.y, region.y), region.y + region.h),
  };
  const inside =
    pointer.x > region.x &&
    pointer.x < region.x + region.w &&
    pointer.y > region.y &&
    pointer.y < region.y + region.h;

  const stroke = Math.max(2, 2 * unit);
  context.save();
  context.globalAlpha *= opacity;
  context.strokeStyle = props.borderColor;
  context.fillStyle = props.borderColor;
  context.lineWidth = stroke;
  if (!inside) {
    context.beginPath();
    context.moveTo(edge.x, edge.y);
    context.lineTo(pointer.x, pointer.y);
    context.stroke();
  }
  context.beginPath();
  context.ellipse(
    pointer.x,
    pointer.y,
    stroke * 2,
    stroke * 2,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.restore();
}

function drawZoom(
  context: CanvasRenderingContext2D,
  props: Extract<OverlayProps, { kind: 'zoom' }>,
  region: PixelRegion,
  options: OverlayDrawOptions,
  opacity: number,
  frame: number,
): void {
  const { width, height } = options;
  const unit = height / 1080;
  const centre = {
    x: region.x + region.w / 2,
    y: region.y + region.h / 2,
  };
  const focusSource = props.focus ?? {
    x: props.region.x + props.region.w / 2,
    y: props.region.y + props.region.h / 2,
  };
  const focus = pointPixels(focusSource, width, height);
  const radius = props.cornerRadius * unit;

  // The lens magnifies content around the focus point. Anything outside the
  // backed-out lens rectangle cannot be visible, so it is skipped.
  const zoom = Math.max(0.01, props.zoom);
  const contentRegion: PixelRegion = {
    x: focus.x - region.w / (2 * zoom) - 2,
    y: focus.y - region.h / (2 * zoom) - 2,
    w: region.w / zoom + 4,
    h: region.h / zoom + 4,
  };

  context.save();
  traceRegion(context, region, props.shape, radius);
  context.clip();
  context.globalAlpha *= opacity;
  // The lens replaces the region, so uncovered areas fall back to the
  // backdrop instead of leaving the unzoomed frame visible.
  options.paintBackdrop(context);
  context.translate(centre.x, centre.y);
  context.scale(zoom, zoom);
  context.translate(-focus.x, -focus.y);
  for (const layer of options.layers) {
    if (!intersects(layerBounds(layer, frame, width, height), contentRegion)) {
      continue;
    }
    options.drawLayer(context, layer, options.lensQuality);
  }
  context.restore();

  const borderWidth = props.borderWidth * unit;
  context.save();
  context.globalAlpha *= opacity;
  if (props.shadow) {
    context.shadowColor = 'rgba(0, 0, 0, 0.45)';
    context.shadowBlur = 24 * unit;
    context.shadowOffsetY = 8 * unit;
  }
  traceRegion(context, region, props.shape, radius);
  if (borderWidth > 0) {
    context.strokeStyle = props.borderColor;
    context.lineWidth = borderWidth;
    context.stroke();
  }
  context.restore();
}

/**
 * Draws one overlay in canvas-pixel space. The caller is responsible for
 * compositing order; this function only paints the effect for one clip.
 */
export function drawOverlay(
  context: CanvasRenderingContext2D,
  overlay: FxOverlayClip,
  frame: number,
  sequence: Sequence,
  options: OverlayDrawOptions,
): boolean {
  const localFrame = frame - overlay.startFrame;
  if (localFrame < 0 || localFrame >= overlay.durationFrames) {
    return false;
  }
  const transform = sampleTransform(
    overlay.transform,
    overlay.keyframes,
    localFrame,
  );
  const opacity =
    overlayTransitionOpacity(
      overlay.props,
      localFrame,
      overlay.durationFrames,
    ) * transform.opacity;
  if (opacity <= 0) {
    return false;
  }

  const unit = sequence.height / 1080;
  const region = regionPixels(
    overlay.props.region,
    options.width,
    options.height,
  );
  const props = overlay.props;

  if (props.kind === 'blur') {
    drawBlur(context, props, region, unit, opacity);
  } else if (props.kind === 'spotlight') {
    drawSpotlight(
      context,
      props,
      region,
      options.width,
      options.height,
      unit,
      opacity,
    );
  } else if (props.kind === 'callout') {
    drawCallout(
      context,
      props,
      region,
      options.width,
      options.height,
      unit,
      opacity,
    );
  } else {
    drawZoom(context, props, region, options, opacity, frame);
  }
  return true;
}
