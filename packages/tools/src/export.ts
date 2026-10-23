import { z } from 'zod';
import { sequenceDurationFrames } from '@kerf/engine';
import type { ToolContext } from './types';

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using tools.');
  }
  return snapshot;
}

export const exportPresetsTool = {
  name: 'exportPresets',
  description:
    'List the export presets available to this build, including their output dimensions.',
  input: z.object({}).default({}),
  readOnly: true,
  execute(context: ToolContext) {
    return { presets: context.exports().presets() };
  },
};

export const startExportTool = {
  name: 'startExport',
  description:
    'Start an export for a frame range. The open editor renders and encodes the frames; poll readExport for progress.',
  input: z
    .object({
      presetId: z.string().min(1).default('sequence'),
      startFrame: z.number().int().nonnegative().optional(),
      endFrame: z.number().int().positive().optional(),
      outputPath: z.string().min(1).nullable().optional(),
    })
    .default({ presetId: 'sequence' }),
  execute(
    context: ToolContext,
    input: {
      presetId: string;
      startFrame?: number;
      endFrame?: number;
      outputPath?: string | null;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const duration = sequenceDurationFrames(snapshot.project.sequence);
    if (duration <= 0) {
      throw new Error('The sequence is empty. Add clips before exporting.');
    }
    const startFrame = input.startFrame ?? 0;
    const endFrame = input.endFrame ?? duration;
    if (startFrame >= endFrame) {
      throw new Error('The export end frame must be after the start frame.');
    }
    if (startFrame < 0 || endFrame > duration) {
      throw new Error(
        `The export range must stay inside the ${duration}-frame sequence.`,
      );
    }
    return context.exports().start({
      presetId: input.presetId,
      startFrame,
      endFrame,
      outputPath: input.outputPath ?? null,
    });
  },
};

export const readExportTool = {
  name: 'readExport',
  description:
    'Read one export by id, or list recent exports when no id is passed.',
  input: z
    .object({
      exportId: z.string().min(1).optional(),
    })
    .default({}),
  readOnly: true,
  execute(context: ToolContext, input: { exportId?: string }) {
    const exports = context.exports();
    if (input.exportId) {
      const record = exports.get(input.exportId);
      if (!record) {
        throw new Error('That export is not in this project.');
      }
      return { export: record };
    }
    return { exports: exports.list().slice(0, 10) };
  },
};

export const EXPORT_TOOLS = [
  exportPresetsTool,
  startExportTool,
  readExportTool,
];
