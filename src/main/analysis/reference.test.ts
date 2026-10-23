import { describe, expect, it } from 'vitest';
import { buildReferenceMetrics, measureReferenceFrames } from './reference';
import type { RgbFrame } from './reference';

function solidFrame(red: number, green: number, blue: number): RgbFrame {
  const data = new Uint8Array(16 * 16 * 3);
  for (let index = 0; index < 16 * 16; index += 1) {
    data[index * 3] = red;
    data[index * 3 + 1] = green;
    data[index * 3 + 2] = blue;
  }
  return { width: 16, height: 16, data };
}

function checkerFrame(): RgbFrame {
  const data = new Uint8Array(16 * 16 * 3);
  for (let index = 0; index < 16 * 16; index += 1) {
    const value = index % 2 === 0 ? 0 : 255;
    data[index * 3] = value;
    data[index * 3 + 1] = value;
    data[index * 3 + 2] = value;
  }
  return { width: 16, height: 16, data };
}

describe('reference measurements', () => {
  it('builds a plausible profile for a six-shot fixture', () => {
    const frames = [
      solidFrame(20, 24, 30),
      solidFrame(220, 180, 120),
      solidFrame(40, 110, 180),
      solidFrame(180, 60, 70),
      solidFrame(90, 140, 90),
      solidFrame(240, 230, 210),
    ];
    const cuts = [1, 2, 3, 4, 5].map((timeSeconds) => ({
      timeSeconds,
      score: 0.4,
    }));
    const metrics = buildReferenceMetrics({
      durationFrames: 144,
      rate: { numerator: 24, denominator: 1 },
      cuts,
      frames,
    });

    expect(metrics.sceneCount).toBe(6);
    expect(metrics.averageShotLengthFrames).toBe(24);
    expect(metrics.cutsPerMinute).toBe(50);
    expect(metrics.meanLuma).toBeGreaterThan(0.2);
    expect(metrics.meanLuma).toBeLessThan(0.9);
    expect(metrics.meanSaturation).toBeGreaterThan(0);
    expect(metrics.meanContrast).toBeGreaterThan(0);
    expect(metrics.palette.length).toBeGreaterThan(0);
    expect(metrics.palette[0]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('reports measured contrast and saturation from sampled pixels', () => {
    const solid = measureReferenceFrames([solidFrame(128, 128, 128)]);
    const checker = measureReferenceFrames([checkerFrame()]);
    const red = measureReferenceFrames([solidFrame(255, 0, 0)]);

    expect(solid.meanLuma).toBeCloseTo(0.502, 2);
    expect(solid.meanContrast).toBe(0);
    expect(checker.meanContrast).toBeGreaterThan(0.9);
    expect(red.meanSaturation).toBe(1);
    expect(red.palette[0]).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps a profile usable when no frames could be sampled', () => {
    const metrics = buildReferenceMetrics({
      durationFrames: 48,
      rate: { numerator: 24, denominator: 1 },
      cuts: [],
      frames: [],
    });
    expect(metrics).toMatchObject({
      sceneCount: 1,
      averageShotLengthFrames: 48,
      cutsPerMinute: 0,
      meanLuma: null,
      meanSaturation: null,
      meanContrast: null,
      palette: [],
    });
  });
});
