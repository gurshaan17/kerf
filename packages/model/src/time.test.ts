import { describe, expect, it } from 'vitest';
import {
  FRAME_RATES,
  formatDuration,
  formatTimecode,
  frameRateSchema,
  framesToMs,
  framesToSeconds,
  msToFrames,
  parseTimecode,
  secondsToFrames,
} from './time';

describe('time', () => {
  it('converts between seconds, frames and milliseconds', () => {
    expect(framesToSeconds(48, FRAME_RATES.film)).toBe(2);
    expect(secondsToFrames(2.5, FRAME_RATES.film)).toBe(60);
    expect(secondsToFrames(1 / 48, FRAME_RATES.film)).toBe(1);
    expect(framesToMs(24, FRAME_RATES.film)).toBe(1000);
    expect(msToFrames(1000, FRAME_RATES.film)).toBe(24);
  });

  it('rounds fractional frames predictably', () => {
    expect(secondsToFrames(0.5, FRAME_RATES.film, 'floor')).toBe(12);
    expect(secondsToFrames(0.51, FRAME_RATES.film, 'floor')).toBe(12);
    expect(secondsToFrames(0.51, FRAME_RATES.film, 'ceil')).toBe(13);
  });

  it('formats non-drop timecode', () => {
    expect(formatTimecode(0, FRAME_RATES.film)).toBe('00:00:00:00');
    expect(formatTimecode(24, FRAME_RATES.film)).toBe('00:00:01:00');
    expect(formatTimecode(90_000, FRAME_RATES.film)).toBe('01:02:30:00');
  });

  it('formats and parses drop-frame timecode', () => {
    const rate = FRAME_RATES.ntsc;
    expect(formatTimecode(0, rate, { dropFrame: true })).toBe('00:00:00;00');
    expect(formatTimecode(1798, rate, { dropFrame: true })).toBe('00:00:59;28');
    expect(formatTimecode(1800, rate, { dropFrame: true })).toBe('00:01:00;02');
    expect(parseTimecode('00:00:59;28', rate)).toBe(1798);
    expect(parseTimecode('00:01:00;02', rate)).toBe(1800);
  });

  it('round-trips timecode at common rates', () => {
    for (const rate of [
      FRAME_RATES.film,
      FRAME_RATES.pal,
      FRAME_RATES.ntsc,
      FRAME_RATES.web60,
    ]) {
      for (const frame of [0, 1, 47, 1798, 18_000]) {
        const text = formatTimecode(frame, rate);
        expect(parseTimecode(text, rate)).toBe(frame);
      }
    }
  });

  it('rejects malformed timecode and frame fields past the rate', () => {
    expect(parseTimecode('not timecode', FRAME_RATES.film)).toBeNull();
    expect(parseTimecode('00:00:00:24', FRAME_RATES.film)).toBeNull();
    expect(parseTimecode('00:60:00:00', FRAME_RATES.film)).toBeNull();
  });

  it('formats compact durations', () => {
    expect(formatDuration(0, FRAME_RATES.film)).toBe('0:00');
    expect(formatDuration(24 * 65, FRAME_RATES.film)).toBe('1:05');
    expect(formatDuration(24 * 3661, FRAME_RATES.film)).toBe('1:01:01');
  });

  it('validates frame rates', () => {
    expect(frameRateSchema.parse({ numerator: 24 })).toEqual({
      numerator: 24,
      denominator: 1,
    });
    expect(() => frameRateSchema.parse({ numerator: 0 })).toThrow();
    expect(() =>
      frameRateSchema.parse({ numerator: 1000, denominator: 1 }),
    ).toThrow();
  });

  it.each([
    ...Object.values(FRAME_RATES),
    { numerator: 20340, denominator: 647 },
    { numerator: 300000, denominator: 10001 },
  ])('accepts valid rational frame rates: %j', (rate) => {
    expect(frameRateSchema.parse(rate)).toEqual(rate);
  });

  it.each([
    { numerator: 1, denominator: 2 },
    { numerator: 241000, denominator: 1000 },
    { numerator: 30, denominator: 0 },
    { numerator: 30, denominator: -1 },
    { numerator: 30.5, denominator: 1 },
    { numerator: 30, denominator: 1.5 },
    { numerator: Number.MAX_SAFE_INTEGER + 1, denominator: 1000 },
    { numerator: 30, denominator: Infinity },
  ])('rejects invalid rational frame rates: %j', (rate) => {
    expect(frameRateSchema.safeParse(rate).success).toBe(false);
  });
});
