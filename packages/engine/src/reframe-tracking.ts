import type { ReframePoint } from './reframe';

export interface TrackedReframePoint extends ReframePoint {
  readonly status: 'manual' | 'tracked' | 'uncertain' | 'scene-change';
  readonly confidence?: number;
  readonly shotStart?: boolean;
}

export interface ReframeSample {
  readonly frame: number;
  readonly pixels: Uint8Array;
  readonly cut?: boolean;
}

const RADIUS = 10;

function patch(pixels: Uint8Array, width: number, x: number, y: number) {
  const values = [];
  let sum = 0;
  let sumSquares = 0;
  for (let row = -RADIUS; row <= RADIUS; row += 2) {
    for (let column = -RADIUS; column <= RADIUS; column += 2) {
      const value = pixels[(y + row) * width + x + column]!;
      values.push(value);
      sum += value;
      sumSquares += value * value;
    }
  }
  const mean = sum / values.length;
  const norm = Math.sqrt(Math.max(0, sumSquares - sum * mean));
  return { values, mean, norm };
}

function match(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  target: ReturnType<typeof patch>,
) {
  const score = (x: number, y: number) => {
    const candidate = patch(pixels, width, x, y);
    if (candidate.norm < 45) return -1;
    let dot = 0;
    for (let i = 0; i < target.values.length; i++)
      dot +=
        (target.values[i]! - target.mean) *
        (candidate.values[i]! - candidate.mean);
    return dot / (target.norm * candidate.norm);
  };
  const minX = Math.max(RADIUS, x - 30);
  const maxX = Math.min(width - RADIUS - 1, x + 30);
  const minY = Math.max(RADIUS, y - 18);
  const maxY = Math.min(height - RADIUS - 1, y + 18);
  const candidates = [];
  let best = { x, y, score: -1 };
  for (let row = minY; row <= maxY; row += 2) {
    for (let column = minX; column <= maxX; column += 2) {
      const point = { x: column, y: row, score: score(column, row) };
      candidates.push(point);
      if (point.score > best.score) best = point;
    }
  }
  const coarse = best;
  for (
    let row = Math.max(minY, coarse.y - 1);
    row <= Math.min(maxY, coarse.y + 1);
    row++
  ) {
    for (
      let column = Math.max(minX, coarse.x - 1);
      column <= Math.min(maxX, coarse.x + 1);
      column++
    ) {
      const value = score(column, row);
      if (value > best.score) best = { x: column, y: row, score: value };
    }
  }
  const ambiguous = candidates.some(
    (point) =>
      Math.hypot(point.x - best.x, point.y - best.y) > 9 &&
      point.score > best.score - 0.055,
  );
  return { ...best, reliable: best.score >= 0.72 && !ambiguous };
}

function looksLikeCut(previous: Uint8Array, current: Uint8Array) {
  let changed = 0;
  let samples = 0;
  for (let index = 0; index < current.length; index += 7) {
    if (Math.abs(current[index]! - previous[index]!) > 40) changed++;
    samples++;
  }
  return changed / samples > 0.68;
}

/** Follow a user-picked image patch within a shot. Keep and flag the last
 * reliable position across occlusion, uncertainty, and shot changes. */
export function* trackReframe(
  samples: readonly ReframeSample[],
  anchors: readonly ReframePoint[],
  width: number,
  height: number,
): Generator<TrackedReframePoint> {
  const startingPoint = anchors[0];
  if (
    !startingPoint ||
    startingPoint.frame !== 0 ||
    width <= 2 * RADIUS ||
    height <= 2 * RADIUS
  )
    throw new Error('Choose a starting subject before tracking.');
  const clamp = (value: number, limit: number) =>
    Math.max(
      RADIUS,
      Math.min(limit - RADIUS - 1, Math.round(value * (limit - 1))),
    );
  let target: ReturnType<typeof patch> | undefined;
  let current = startingPoint;
  let x = clamp(current.x, width);
  let y = clamp(current.y, height);
  let anchorIndex = 0;
  let previous: ReframeSample | undefined;
  let waitingForShot = false;
  let anchorOffsetX = 0;
  let anchorOffsetY = 0;
  for (const sample of samples) {
    if (sample.pixels.length !== width * height)
      throw new Error('Incomplete tracking frame.');
    const cut = Boolean(
      sample.cut || (previous && looksLikeCut(previous.pixels, sample.pixels)),
    );
    if (cut) {
      target = undefined;
      waitingForShot = true;
    }
    let anchor: ReframePoint | undefined;
    while (anchors[anchorIndex] && anchors[anchorIndex]!.frame <= sample.frame)
      anchor = anchors[anchorIndex++];
    previous = sample;
    if (anchor) {
      current = anchor;
      x = clamp(anchor.x, width);
      y = clamp(anchor.y, height);
      anchorOffsetX = anchor.x - x / (width - 1);
      anchorOffsetY = anchor.y - y / (height - 1);
      target = patch(sample.pixels, width, x, y);
      waitingForShot = false;
      yield { ...anchor, status: 'manual', shotStart: cut || undefined };
      continue;
    }
    if (!target || target.norm < 80) {
      yield {
        frame: sample.frame,
        x: current.x,
        y: current.y,
        status: waitingForShot ? 'scene-change' : 'uncertain',
        hold: true,
        shotStart: cut || undefined,
      };
      continue;
    }
    const found = match(sample.pixels, width, height, x, y, target);
    if (found.reliable) {
      x = found.x;
      y = found.y;
      const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
      current = {
        frame: sample.frame,
        x: 0.25 * current.x + 0.75 * clampUnit(x / (width - 1) + anchorOffsetX),
        y:
          0.25 * current.y + 0.75 * clampUnit(y / (height - 1) + anchorOffsetY),
      };
    }
    yield {
      frame: sample.frame,
      x: current.x,
      y: current.y,
      status: found.reliable ? 'tracked' : 'uncertain',
      hold: !found.reliable || undefined,
      confidence: Math.max(0, Math.min(1, found.score)),
    };
  }
}
