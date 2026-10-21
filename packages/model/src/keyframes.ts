import { z } from 'zod';

export const easingNameSchema = z.enum([
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'hold',
]);

export const bezierEasingSchema = z.object({
  type: z.literal('bezier'),
  x1: z.number().min(0).max(1),
  y1: z.number(),
  x2: z.number().min(0).max(1),
  y2: z.number(),
});

export const easingSchema = z.union([easingNameSchema, bezierEasingSchema]);

export type EasingName = z.infer<typeof easingNameSchema>;
export type BezierEasing = z.infer<typeof bezierEasingSchema>;
export type Easing = z.infer<typeof easingSchema>;

export const numberKeyframeSchema = z.object({
  frame: z.number().int().nonnegative(),
  value: z.number().finite(),
  easing: easingSchema.default('linear'),
});

export const numberKeyframesSchema = z
  .array(numberKeyframeSchema)
  .refine(
    (keyframes) =>
      keyframes.every(
        (keyframe, index) =>
          index === 0 ||
          keyframe.frame >= (keyframes[index - 1]?.frame ?? keyframe.frame),
      ),
    { message: 'Keyframes must be ordered by frame' },
  );

export type NumberKeyframe = z.infer<typeof numberKeyframeSchema>;
export type NumberKeyframes = z.infer<typeof numberKeyframesSchema>;

export function sortKeyframes<T extends { frame: number }>(
  keyframes: readonly T[],
): T[] {
  return [...keyframes].sort((a, b) => a.frame - b.frame);
}

function cubicPoint(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return 3 * inverse * inverse * t * p1 + 3 * inverse * t * t * p2 + t * t * t;
}

function cubicDerivative(t: number, p1: number, p2: number): number {
  const inverse = 1 - t;
  return (
    3 * inverse * inverse * p1 +
    6 * inverse * t * (p2 - p1) +
    3 * t * t * (1 - p2)
  );
}

function makeCubicBezier(x1: number, y1: number, x2: number, y2: number) {
  return (progress: number): number => {
    const target = Math.min(Math.max(progress, 0), 1);
    let t = target;

    for (let iteration = 0; iteration < 8; iteration += 1) {
      const current = cubicPoint(t, x1, x2) - target;
      if (Math.abs(current) < 1e-6) {
        break;
      }

      const slope = cubicDerivative(t, x1, x2);
      if (Math.abs(slope) < 1e-6) {
        break;
      }
      t -= current / slope;
    }

    return cubicPoint(Math.min(Math.max(t, 0), 1), y1, y2);
  };
}

const easeIn = makeCubicBezier(0.42, 0, 1, 1);
const easeOut = makeCubicBezier(0, 0, 0.58, 1);
const easeInOut = makeCubicBezier(0.42, 0, 0.58, 1);

export function easingProgress(easing: Easing, progress: number): number {
  const t = Math.min(Math.max(progress, 0), 1);
  if (typeof easing === 'object') {
    return makeCubicBezier(easing.x1, easing.y1, easing.x2, easing.y2)(t);
  }

  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in':
      return easeIn(t);
    case 'ease-out':
      return easeOut(t);
    case 'ease-in-out':
      return easeInOut(t);
    case 'hold':
      return 0;
  }
}

/**
 * Samples a sorted keyframe track at an absolute frame. Values before and after
 * the track are held flat, which keeps animated properties stable at the edges.
 */
export function sampleNumberKeyframes(
  keyframes: readonly NumberKeyframe[],
  frame: number,
): number | undefined {
  const list = sortKeyframes(keyframes);
  const first = list[0];
  const last = list.at(-1);
  if (!first || !last) {
    return undefined;
  }

  if (frame <= first.frame) {
    return first.value;
  }
  if (frame >= last.frame) {
    return last.value;
  }

  for (let index = 1; index < list.length; index += 1) {
    const left = list[index - 1];
    const right = list[index];
    if (!left || !right || frame > right.frame) {
      continue;
    }

    if (frame === right.frame) {
      return right.value;
    }

    const span = right.frame - left.frame;
    if (span <= 0) {
      return right.value;
    }

    const eased = easingProgress(left.easing, (frame - left.frame) / span);
    return left.value + (right.value - left.value) * eased;
  }

  return last.value;
}

export const transformSchema = z.object({
  x: z.number().finite().default(0),
  y: z.number().finite().default(0),
  scale: z.number().positive().default(1),
  rotation: z.number().finite().default(0),
  opacity: z.number().min(0).max(1).default(1),
  anchorX: z.number().min(0).max(1).default(0.5),
  anchorY: z.number().min(0).max(1).default(0.5),
});

export const transformKeyframesSchema = z
  .object({
    x: numberKeyframesSchema.default([]),
    y: numberKeyframesSchema.default([]),
    scale: numberKeyframesSchema.default([]),
    rotation: numberKeyframesSchema.default([]),
    opacity: numberKeyframesSchema.default([]),
  })
  .default({ x: [], y: [], scale: [], rotation: [], opacity: [] });

export type Transform = z.infer<typeof transformSchema>;
export type TransformKeyframes = z.infer<typeof transformKeyframesSchema>;

export const DEFAULT_TRANSFORM: Transform = transformSchema.parse({});

export function sampleTransform(
  base: Transform,
  keyframes: TransformKeyframes,
  frame: number,
): Transform {
  const opacity =
    sampleNumberKeyframes(keyframes.opacity, frame) ?? base.opacity;
  const scale = sampleNumberKeyframes(keyframes.scale, frame) ?? base.scale;

  return {
    x: sampleNumberKeyframes(keyframes.x, frame) ?? base.x,
    y: sampleNumberKeyframes(keyframes.y, frame) ?? base.y,
    scale: Math.max(0.001, scale),
    rotation: sampleNumberKeyframes(keyframes.rotation, frame) ?? base.rotation,
    opacity: Math.min(Math.max(opacity, 0), 1),
    anchorX: base.anchorX,
    anchorY: base.anchorY,
  };
}
