import type { ExportPreset } from './contracts';
import { EXPORT_PRESETS } from './contracts';

export interface ResolvedExportPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly width: number;
  readonly height: number;
}

export interface ExportWindow {
  readonly startFrame: number;
  readonly endFrame: number;
  readonly frameCount: number;
}

function evenDimension(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Resolves the output size without touching the project. `match-sequence`
 * presets inherit the sequence dimensions; every other preset is fixed.
 */
export function resolveExportPreset(
  presetId: string,
  sequenceWidth: number,
  sequenceHeight: number,
): ResolvedExportPreset {
  const preset =
    EXPORT_PRESETS.find((candidate) => candidate.id === presetId) ??
    EXPORT_PRESETS[0]!;
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    width: evenDimension(preset.width ?? sequenceWidth),
    height: evenDimension(preset.height ?? sequenceHeight),
  };
}

/**
 * Keeps an export inside the sequence and guarantees at least one frame.
 * End frames are exclusive, matching timerange conventions elsewhere.
 */
export function clampExportWindow(
  startFrame: number,
  endFrame: number,
  durationFrames: number,
): ExportWindow {
  const total = Math.max(1, Math.round(durationFrames));
  const start = Math.min(
    Math.max(0, Math.round(startFrame)),
    Math.max(0, total - 1),
  );
  const end = Math.min(Math.max(start + 1, Math.round(endFrame)), total);
  return {
    startFrame: start,
    endFrame: end,
    frameCount: end - start,
  };
}

export function exportPresetLabel(preset: ExportPreset | undefined): string {
  return preset?.name ?? 'Custom';
}

/** Produces a filesystem-safe default name without requiring a slug helper. */
export function suggestedExportName(
  projectName: string,
  presetName: string,
): string {
  const base = `${projectName}-${presetName}`
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'kerf-export'}.mp4`;
}
