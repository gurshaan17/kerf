import type { FrameRate } from '@kerf/model';

export interface AspectRatioPreset {
  readonly id: string;
  readonly label: string;
  readonly ratio: string;
  readonly width: number;
  readonly height: number;
}

export const ASPECT_RATIO_16_9: AspectRatioPreset = {
  id: '16:9',
  label: 'Landscape',
  ratio: '16:9',
  width: 1920,
  height: 1080,
};

export const ASPECT_RATIO_9_16: AspectRatioPreset = {
  id: '9:16',
  label: 'Vertical',
  ratio: '9:16',
  width: 1080,
  height: 1920,
};

export const ASPECT_RATIO_1_1: AspectRatioPreset = {
  id: '1:1',
  label: 'Square',
  ratio: '1:1',
  width: 1080,
  height: 1080,
};

export const ASPECT_RATIO_4_5: AspectRatioPreset = {
  id: '4:5',
  label: 'Portrait',
  ratio: '4:5',
  width: 1080,
  height: 1350,
};

export const ASPECT_RATIO_4_3: AspectRatioPreset = {
  id: '4:3',
  label: 'Classic',
  ratio: '4:3',
  width: 1440,
  height: 1080,
};

export const ASPECT_RATIO_21_9: AspectRatioPreset = {
  id: '21:9',
  label: 'Cinema',
  ratio: '21:9',
  width: 2560,
  height: 1080,
};

export const ASPECT_RATIO_PRESETS: readonly AspectRatioPreset[] = [
  ASPECT_RATIO_16_9,
  ASPECT_RATIO_9_16,
  ASPECT_RATIO_1_1,
  ASPECT_RATIO_4_5,
  ASPECT_RATIO_4_3,
  ASPECT_RATIO_21_9,
];

export const DEFAULT_ASPECT_RATIO_PRESET = ASPECT_RATIO_16_9;

export function aspectRatioPresetById(
  id: string,
): AspectRatioPreset | undefined {
  return ASPECT_RATIO_PRESETS.find((preset) => preset.id === id);
}

export function aspectRatioPresetForSize(
  width: number,
  height: number,
): AspectRatioPreset | undefined {
  return ASPECT_RATIO_PRESETS.find(
    (preset) => preset.width === width && preset.height === height,
  );
}

export interface FrameRatePreset {
  readonly id: string;
  readonly label: string;
  readonly frameRate: FrameRate;
}

export const FRAME_RATE_24: FrameRatePreset = {
  id: '24',
  label: '24 fps',
  frameRate: { numerator: 24, denominator: 1 },
};

export const FRAME_RATE_30: FrameRatePreset = {
  id: '30',
  label: '30 fps',
  frameRate: { numerator: 30, denominator: 1 },
};

export const FRAME_RATE_60: FrameRatePreset = {
  id: '60',
  label: '60 fps',
  frameRate: { numerator: 60, denominator: 1 },
};

export const FRAME_RATE_120: FrameRatePreset = {
  id: '120',
  label: '120 fps',
  frameRate: { numerator: 120, denominator: 1 },
};

export const FRAME_RATE_PRESETS: readonly FrameRatePreset[] = [
  FRAME_RATE_24,
  FRAME_RATE_30,
  FRAME_RATE_60,
  FRAME_RATE_120,
];

export const DEFAULT_FRAME_RATE_PRESET = FRAME_RATE_24;

export function frameRatePresetById(id: string): FrameRatePreset | undefined {
  return FRAME_RATE_PRESETS.find((preset) => preset.id === id);
}

export function frameRatePresetForRate(
  frameRate: FrameRate,
): FrameRatePreset | undefined {
  return FRAME_RATE_PRESETS.find(
    (preset) =>
      preset.frameRate.numerator === frameRate.numerator &&
      preset.frameRate.denominator === frameRate.denominator,
  );
}

export function formatFrameRate(frameRate: FrameRate): string {
  const fps = frameRate.numerator / frameRate.denominator;
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}
