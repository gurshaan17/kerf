import { z } from 'zod';

export interface FrameRate {
  readonly numerator: number;
  readonly denominator: number;
}

export const FRAME_RATES = {
  film: { numerator: 24, denominator: 1 },
  ntscFilm: { numerator: 24000, denominator: 1001 },
  pal: { numerator: 25, denominator: 1 },
  ntsc: { numerator: 30000, denominator: 1001 },
  web30: { numerator: 30, denominator: 1 },
  ntsc60: { numerator: 60000, denominator: 1001 },
  web60: { numerator: 60, denominator: 1 },
  web120: { numerator: 120, denominator: 1 },
} as const satisfies Record<string, FrameRate>;

export const frameRateSchema = z
  .object({
    numerator: z.number().int().min(1).max(1000),
    denominator: z.number().int().min(1).max(1001).default(1),
  })
  .refine(
    (rate) => {
      const fps = fpsToNumber(rate);
      return fps >= 1 && fps <= 240;
    },
    { message: 'Frame rate must be between 1 and 240 fps' },
  );

export function fpsToNumber(rate: FrameRate): number {
  return rate.numerator / rate.denominator;
}

export function isDropFrameRate(rate: FrameRate): boolean {
  const base = Math.round(fpsToNumber(rate));
  return base === 30 || base === 60;
}

export function framesToSeconds(frames: number, rate: FrameRate): number {
  return frames / fpsToNumber(rate);
}

export type Rounding = 'round' | 'floor' | 'ceil';

export function secondsToFrames(
  seconds: number,
  rate: FrameRate,
  rounding: Rounding = 'round',
): number {
  const value = seconds * fpsToNumber(rate);
  if (rounding === 'floor') {
    return Math.floor(value);
  }
  if (rounding === 'ceil') {
    return Math.ceil(value);
  }
  return Math.round(value);
}

export function framesToMs(frames: number, rate: FrameRate): number {
  return Math.round(framesToSeconds(frames, rate) * 1000);
}

export function msToFrames(ms: number, rate: FrameRate): number {
  return secondsToFrames(ms / 1000, rate);
}

export function snapToFrame(seconds: number, rate: FrameRate): number {
  return secondsToFrames(seconds, rate);
}

const pad = (value: number, width = 2): string =>
  Math.trunc(value).toString().padStart(width, '0');

/**
 * Formats an absolute frame count as SMPTE-style timecode. Drop-frame rates use
 * a semicolon before the frame field, matching the usual editorial convention.
 */
export function formatTimecode(
  frames: number,
  rate: FrameRate,
  options: { dropFrame?: boolean } = {},
): string {
  const base = Math.round(fpsToNumber(rate));
  const total = Math.max(0, Math.round(frames));
  const drop = options.dropFrame === true && isDropFrameRate(rate);

  if (drop) {
    const dropped = base === 60 ? 4 : 2;
    const framesPerMinute = base * 60 - dropped;
    const framesPer10Minutes = base * 600;
    const tenMinuteChunks = Math.floor(total / framesPer10Minutes);
    const remainder = total % framesPer10Minutes;
    const adjusted =
      remainder > dropped
        ? total +
          dropped * 9 * tenMinuteChunks +
          dropped * Math.floor((remainder - dropped) / framesPerMinute)
        : total + dropped * 9 * tenMinuteChunks;

    const frameField = adjusted % base;
    const seconds = Math.floor(adjusted / base);
    return `${pad(Math.floor(seconds / 3600))}:${pad(
      Math.floor(seconds / 60) % 60,
    )}:${pad(seconds % 60)};${pad(frameField)}`;
  }

  const frameField = total % base;
  const seconds = Math.floor(total / base);
  return `${pad(Math.floor(seconds / 3600))}:${pad(
    Math.floor(seconds / 60) % 60,
  )}:${pad(seconds % 60)}:${pad(frameField)}`;
}

const TIMECODE_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)[:;](\d{2,3})$/;

/**
 * Parses `HH:MM:SS:FF`, or `HH:MM:SS;FF` for drop-frame timecode. Returns null
 * when the text is malformed or the frame field is outside the rate.
 */
export function parseTimecode(text: string, rate: FrameRate): number | null {
  const match = TIMECODE_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const frames = Number(match[4]);
  const base = Math.round(fpsToNumber(rate));
  if (frames >= base) {
    return null;
  }

  const drop = text.includes(';') && isDropFrameRate(rate);
  let total = ((hours * 60 + minutes) * 60 + seconds) * base + frames;

  if (drop) {
    const dropped = base === 60 ? 4 : 2;
    const totalMinutes = hours * 60 + minutes;
    total -= dropped * (totalMinutes - Math.floor(totalMinutes / 10));
  }

  return total;
}

/** Compact duration for the interface: `M:SS`, or `H:MM:SS` past an hour. */
export function formatDuration(frames: number, rate: FrameRate): string {
  const totalSeconds = Math.max(0, Math.round(framesToSeconds(frames, rate)));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}
