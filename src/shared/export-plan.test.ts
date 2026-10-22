import { describe, expect, it } from 'vitest';
import {
  clampExportWindow,
  resolveExportPreset,
  suggestedExportName,
} from './export-plan';

describe('export planning', () => {
  it('resolves sequence and fixed-size presets to even dimensions', () => {
    expect(resolveExportPreset('sequence', 1919, 1081)).toMatchObject({
      width: 1920,
      height: 1082,
    });
    expect(resolveExportPreset('720p', 1919, 1081)).toMatchObject({
      width: 1280,
      height: 720,
    });
    expect(resolveExportPreset('vertical', 1920, 1080)).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('clamps a render window to the sequence and keeps one frame', () => {
    expect(clampExportWindow(-10, 20, 240)).toEqual({
      startFrame: 0,
      endFrame: 20,
      frameCount: 20,
    });
    expect(clampExportWindow(230, 999, 240)).toEqual({
      startFrame: 230,
      endFrame: 240,
      frameCount: 10,
    });
    expect(clampExportWindow(400, 500, 240)).toEqual({
      startFrame: 239,
      endFrame: 240,
      frameCount: 1,
    });
    expect(clampExportWindow(10, 10, 240)).toEqual({
      startFrame: 10,
      endFrame: 11,
      frameCount: 1,
    });
  });

  it('sanitizes a suggested output name', () => {
    expect(suggestedExportName('My film / v2', 'Match sequence')).toBe(
      'My-film-v2-Match-sequence.mp4',
    );
  });
});
