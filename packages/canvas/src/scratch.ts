/**
 * Offscreen surfaces for the compositor. Chromium and Node (golden tests) both
 * provide a 2D canvas, but they create it differently, so the factory is
 * injectable and the surfaces themselves are cached per purpose and size.
 */
export type ScratchCanvas = HTMLCanvasElement;
export type ScratchContext = CanvasRenderingContext2D;

export interface ScratchSurface {
  readonly canvas: ScratchCanvas;
  readonly context: ScratchContext;
}

export type ScratchCanvasFactory = (
  width: number,
  height: number,
) => ScratchCanvas;

let factory: ScratchCanvasFactory | null = null;
const surfaces = new Map<string, ScratchSurface>();

/** Installs a factory for environments without `document`. Pass null to reset. */
export function setScratchCanvasFactory(
  next: ScratchCanvasFactory | null,
): void {
  factory = next;
  surfaces.clear();
}

function createCanvas(width: number, height: number): ScratchCanvas {
  if (factory) {
    return factory(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function resetContext(
  context: ScratchContext,
  width: number,
  height: number,
): void {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
  context.imageSmoothingEnabled = true;
  context.lineWidth = 1;
  context.setLineDash([]);
  context.clearRect(0, 0, width, height);
}

/**
 * Returns a cleared surface. The same surface is reused across frames for a
 * given key, so a busy frame does not allocate several full-size canvases per
 * overlay.
 */
export function scratchSurface(
  key: string,
  width: number,
  height: number,
): ScratchSurface {
  const safeWidth = Math.max(1, Math.ceil(width));
  const safeHeight = Math.max(1, Math.ceil(height));
  const existing = surfaces.get(key);
  if (
    existing &&
    existing.canvas.width === safeWidth &&
    existing.canvas.height === safeHeight
  ) {
    resetContext(existing.context, safeWidth, safeHeight);
    return existing;
  }
  const canvas = createCanvas(safeWidth, safeHeight);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('The compositor could not create a scratch surface.');
  }
  resetContext(context, safeWidth, safeHeight);
  const surface = { canvas, context } as ScratchSurface;
  surfaces.set(key, surface);
  return surface;
}

function blurHorizontal(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const diameter = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const x = Math.min(width - 1, Math.max(0, offset));
      const index = row + x * 4;
      red += source[index] ?? 0;
      green += source[index + 1] ?? 0;
      blue += source[index + 2] ?? 0;
      alpha += source[index + 3] ?? 0;
    }
    for (let x = 0; x < width; x += 1) {
      const out = row + x * 4;
      target[out] = red / diameter;
      target[out + 1] = green / diameter;
      target[out + 2] = blue / diameter;
      target[out + 3] = alpha / diameter;
      const added = Math.min(width - 1, x + radius + 1);
      const removed = Math.max(0, x - radius);
      const addIndex = row + added * 4;
      const removeIndex = row + removed * 4;
      red += (source[addIndex] ?? 0) - (source[removeIndex] ?? 0);
      green += (source[addIndex + 1] ?? 0) - (source[removeIndex + 1] ?? 0);
      blue += (source[addIndex + 2] ?? 0) - (source[removeIndex + 2] ?? 0);
      alpha += (source[addIndex + 3] ?? 0) - (source[removeIndex + 3] ?? 0);
    }
  }
}

function blurVertical(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number,
): void {
  const diameter = radius * 2 + 1;
  const stride = width * 4;
  for (let x = 0; x < width; x += 1) {
    const column = x * 4;
    let red = 0;
    let green = 0;
    let blue = 0;
    let alpha = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const y = Math.min(height - 1, Math.max(0, offset));
      const index = column + y * stride;
      red += source[index] ?? 0;
      green += source[index + 1] ?? 0;
      blue += source[index + 2] ?? 0;
      alpha += source[index + 3] ?? 0;
    }
    for (let y = 0; y < height; y += 1) {
      const out = column + y * stride;
      target[out] = red / diameter;
      target[out + 1] = green / diameter;
      target[out + 2] = blue / diameter;
      target[out + 3] = alpha / diameter;
      const added = Math.min(height - 1, y + radius + 1);
      const removed = Math.max(0, y - radius);
      const addIndex = column + added * stride;
      const removeIndex = column + removed * stride;
      red += (source[addIndex] ?? 0) - (source[removeIndex] ?? 0);
      green += (source[addIndex + 1] ?? 0) - (source[removeIndex + 1] ?? 0);
      blue += (source[addIndex + 2] ?? 0) - (source[removeIndex + 2] ?? 0);
      alpha += (source[addIndex + 3] ?? 0) - (source[removeIndex + 3] ?? 0);
    }
  }
}

/**
 * Separable box blur, repeated to approximate a gaussian. Doing the work on
 * `ImageData` keeps the result identical in Chromium and Node, where
 * `context.filter` support differs.
 */
export function blurImageData(
  image: ImageData,
  radius: number,
  passes = 3,
): void {
  const rounds = Math.max(1, Math.floor(passes));
  const size = Math.max(1, Math.round(radius));
  if (size <= 0 || image.width <= 0 || image.height <= 0) {
    return;
  }
  const temporary = new Uint8ClampedArray(image.data.length);
  for (let pass = 0; pass < rounds; pass += 1) {
    blurHorizontal(image.data, temporary, image.width, image.height, size);
    blurVertical(temporary, image.data, image.width, image.height, size);
  }
}

/** Blurs a rectangular region of a scratch context in place. */
export function blurSurfaceRegion(
  context: ScratchContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): void {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(context.canvas.width, Math.ceil(x + width));
  const bottom = Math.min(context.canvas.height, Math.ceil(y + height));
  const regionWidth = right - left;
  const regionHeight = bottom - top;
  if (regionWidth <= 0 || regionHeight <= 0) {
    return;
  }
  const image = context.getImageData(left, top, regionWidth, regionHeight);
  blurImageData(image, radius, passes);
  context.putImageData(image, left, top);
}
