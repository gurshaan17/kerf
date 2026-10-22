import { describe, expect, it } from 'vitest';
import { detectBeatAnalysis } from './beats';

function clickTrack(bpm: number, seconds: number): Float32Array {
  const sampleRate = 16_000;
  const samples = new Float32Array(sampleRate * seconds);
  const interval = 60 / bpm;
  for (let time = 0; time < seconds; time += interval) {
    const start = Math.round(time * sampleRate);
    for (let offset = 0; offset < 240; offset += 1) {
      const index = start + offset;
      if (index >= samples.length) {
        break;
      }
      samples[index] = Math.exp(-offset / 35) * (offset % 2 === 0 ? 1 : -1);
    }
  }
  return samples;
}

describe('detectBeatAnalysis', () => {
  it('finds a 120 BPM click track and makes downbeat sections', () => {
    const result = detectBeatAnalysis(
      clickTrack(120, 8),
      16_000,
      { numerator: 30, denominator: 1 },
      240,
    );

    expect(result.bpm).toBeGreaterThan(117);
    expect(result.bpm).toBeLessThan(123);
    expect(result.beats.length).toBeGreaterThanOrEqual(14);
    expect(result.beats[0]?.frame).toBeLessThan(4);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    expect(result.sections[0]?.startFrame).toBeGreaterThanOrEqual(0);
  });

  it('handles silence without inventing tempo confidence', () => {
    const result = detectBeatAnalysis(
      new Float32Array(16_000 * 2),
      16_000,
      { numerator: 24, denominator: 1 },
      48,
    );
    expect(result.beats.length).toBeGreaterThan(0);
    expect(result.beats.length).toBeLessThan(20);
    expect(result.beats.every((beat) => beat.strength >= 0.05)).toBe(true);
  });
});
