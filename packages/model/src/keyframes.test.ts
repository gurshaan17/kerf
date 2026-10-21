import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM,
  easingProgress,
  numberKeyframesSchema,
  sampleNumberKeyframes,
  sampleTransform,
  transformSchema,
} from './keyframes';

describe('keyframes', () => {
  it('samples flat tracks before and after the range', () => {
    const keys = [
      { frame: 10, value: 0, easing: 'linear' as const },
      { frame: 20, value: 100, easing: 'linear' as const },
    ];
    expect(sampleNumberKeyframes(keys, 0)).toBe(0);
    expect(sampleNumberKeyframes(keys, 10)).toBe(0);
    expect(sampleNumberKeyframes(keys, 15)).toBe(50);
    expect(sampleNumberKeyframes(keys, 20)).toBe(100);
    expect(sampleNumberKeyframes(keys, 40)).toBe(100);
    expect(sampleNumberKeyframes([], 3)).toBeUndefined();
  });

  it('holds the previous value for hold easing', () => {
    const keys = [
      { frame: 0, value: 10, easing: 'hold' as const },
      { frame: 10, value: 20, easing: 'linear' as const },
    ];
    expect(sampleNumberKeyframes(keys, 9)).toBe(10);
    expect(sampleNumberKeyframes(keys, 10)).toBe(20);
  });

  it('maps easing names to progress', () => {
    expect(easingProgress('linear', 0.5)).toBeCloseTo(0.5);
    expect(easingProgress('hold', 0.9)).toBe(0);
    expect(easingProgress('ease-in', 0.5)).toBeLessThan(0.5);
    expect(easingProgress('ease-out', 0.5)).toBeGreaterThan(0.5);
    expect(
      easingProgress({ type: 'bezier', x1: 0.2, y1: 0, x2: 0.8, y2: 1 }, 0.5),
    ).toBeCloseTo(0.5, 1);
  });

  it('validates ordered keyframes', () => {
    expect(
      numberKeyframesSchema.parse([
        { frame: 0, value: 0 },
        { frame: 4, value: 1 },
      ]),
    ).toHaveLength(2);
    expect(() =>
      numberKeyframesSchema.parse([
        { frame: 4, value: 1 },
        { frame: 0, value: 0 },
      ]),
    ).toThrow();
  });

  it('builds the default transform', () => {
    expect(DEFAULT_TRANSFORM).toEqual({
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    expect(transformSchema.parse({})).toEqual(DEFAULT_TRANSFORM);
  });

  it('samples animated transform properties', () => {
    const sampled = sampleTransform(
      DEFAULT_TRANSFORM,
      {
        x: [
          { frame: 0, value: 0, easing: 'linear' },
          { frame: 10, value: 100, easing: 'linear' },
        ],
        opacity: [],
        scale: [],
        rotation: [],
        y: [],
      },
      5,
    );
    expect(sampled.x).toBe(50);
    expect(sampled.opacity).toBe(1);
    expect(sampled.scale).toBe(1);
  });
});
