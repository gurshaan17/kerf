import { z } from 'zod';
import type { Composition } from '@kerf/model';
import { DEFAULT_COMPOSITION_SOURCE, fpsToNumber, idSchema } from '@kerf/model';
import {
  interpretSceneExpression,
  sceneTreeSchema,
  validateCompositionSource,
} from '@kerf/motion';
import type { PolicyIssue } from '@kerf/motion';
import type { ToolContext } from './types';

const compositionIdSchema = idSchema('composition');

interface InspectionIssue extends PolicyIssue {
  readonly hint: string;
}

interface Inspection {
  readonly valid: boolean;
  readonly sceneTree: unknown | null;
  readonly issues: readonly InspectionIssue[];
  readonly error: string | null;
}

function repairHint(message: string): string {
  if (/empty/i.test(message)) {
    return 'Return one object expression with a nodes array, for example ({ nodes: [] }).';
  }
  if (/single expression/i.test(message)) {
    return 'Wrap the scene in one expression. Do not add statements, variables or semicolons outside it.';
  }
  if (/not allowed|not available|whitelisted|computed|Spread/i.test(message)) {
    return 'Use only object and array literals, arithmetic, ternaries and whitelisted Math helpers. Remove DOM, network, global access and computed keys.';
  }
  if (/parse|could not|unexpected|expected|unterminated/i.test(message)) {
    return 'Check the brackets, commas and quotes near the reported line, then preview again.';
  }
  if (/scene|node|type/i.test(message)) {
    return 'Check each node has a supported type and the required fields for that type.';
  }
  return 'Simplify the expression and remove any values that are not literals or frame/time math.';
}

function inspectSource(
  context: ToolContext,
  source: string,
  frame: number,
): Inspection {
  const policy = validateCompositionSource(source);
  if (!policy.ok) {
    return {
      valid: false,
      sceneTree: null,
      issues: policy.issues.map((issue) => ({
        ...issue,
        hint: repairHint(issue.message),
      })),
      error:
        policy.issues[0]?.message ?? 'The composition source was rejected.',
    };
  }
  const snapshot = context.snapshot();
  const fps = snapshot ? fpsToNumber(snapshot.project.sequence.frameRate) : 30;
  try {
    const sceneTree = sceneTreeSchema.parse(
      interpretSceneExpression(policy.ast, frame, frame / fps),
    );
    return {
      valid: true,
      sceneTree,
      issues: [],
      error: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'The scene tree is invalid.';
    return {
      valid: false,
      sceneTree: null,
      issues: [
        {
          message,
          line: 1,
          column: 1,
          hint: repairHint(message),
        },
      ],
      error: message,
    };
  }
}

function compositionSummary(composition: Composition) {
  return {
    id: composition.id,
    name: composition.name,
    source: composition.source,
    width: composition.width,
    height: composition.height,
    durationFrames: composition.durationFrames,
    createdAt: composition.createdAt,
    updatedAt: composition.updatedAt,
  };
}

function requireSnapshot(context: ToolContext) {
  const snapshot = context.snapshot();
  if (!snapshot) {
    throw new Error('Open a project before using composition tools.');
  }
  return snapshot;
}

async function save(
  context: ToolContext,
  request: {
    id?: string;
    name: string;
    source: string;
    width?: number;
    height?: number;
    durationFrames?: number;
  },
): Promise<Composition> {
  if (!context.saveComposition) {
    throw new Error('Composition saving is not available in this session.');
  }
  return context.saveComposition(request);
}

export const authorCompositionTool = {
  name: 'authorComposition',
  description:
    'Author a motion composition from a sandboxed scene expression, validate it and save it to the project library.',
  input: z.object({
    name: z.string().trim().min(1).max(120),
    source: z.string().min(1).optional(),
    width: z.number().int().min(16).max(16_384).optional(),
    height: z.number().int().min(16).max(16_384).optional(),
    durationFrames: z.number().int().positive().max(100_000).optional(),
  }),
  async execute(
    context: ToolContext,
    input: {
      name: string;
      source?: string;
      width?: number;
      height?: number;
      durationFrames?: number;
    },
  ) {
    requireSnapshot(context);
    const source = input.source ?? DEFAULT_COMPOSITION_SOURCE;
    const inspection = inspectSource(context, source, 0);
    if (!inspection.valid) {
      return {
        valid: false,
        composition: null,
        issues: inspection.issues,
        repairHints: inspection.issues.map((issue) => issue.hint),
      };
    }
    const composition = await save(context, {
      name: input.name,
      source,
      width: input.width,
      height: input.height,
      durationFrames: input.durationFrames,
    });
    return {
      valid: true,
      composition: compositionSummary(composition),
      sceneTree: inspection.sceneTree,
      issues: [],
      repairHints: [],
    };
  },
};

export const reviseCompositionTool = {
  name: 'reviseComposition',
  description:
    'Revise a saved composition name, scene expression or dimensions. Invalid code returns policy issues and repair hints.',
  input: z
    .object({
      compositionId: compositionIdSchema,
      name: z.string().trim().min(1).max(120).optional(),
      source: z.string().min(1).optional(),
      width: z.number().int().min(16).max(16_384).optional(),
      height: z.number().int().min(16).max(16_384).optional(),
      durationFrames: z.number().int().positive().max(100_000).optional(),
    })
    .refine(
      (input) =>
        input.name !== undefined ||
        input.source !== undefined ||
        input.width !== undefined ||
        input.height !== undefined ||
        input.durationFrames !== undefined,
      { message: 'Pass at least one change.' },
    ),
  async execute(
    context: ToolContext,
    input: {
      compositionId: string;
      name?: string;
      source?: string;
      width?: number;
      height?: number;
      durationFrames?: number;
    },
  ) {
    const snapshot = requireSnapshot(context);
    const existing = snapshot.compositions.find(
      (composition) => composition.id === input.compositionId,
    );
    if (!existing) {
      throw new Error('That composition is not in the project library.');
    }
    const source = input.source ?? existing.source;
    const inspection = inspectSource(context, source, 0);
    if (!inspection.valid) {
      return {
        valid: false,
        composition: null,
        issues: inspection.issues,
        repairHints: inspection.issues.map((issue) => issue.hint),
      };
    }
    const composition = await save(context, {
      id: existing.id,
      name: input.name ?? existing.name,
      source,
      width: input.width ?? existing.width,
      height: input.height ?? existing.height,
      durationFrames: input.durationFrames ?? existing.durationFrames,
    });
    return {
      valid: true,
      composition: compositionSummary(composition),
      sceneTree: inspection.sceneTree,
      issues: [],
      repairHints: [],
    };
  },
};

export const previewCompositionTool = {
  name: 'previewComposition',
  description:
    'Evaluate a saved or proposed composition at a frame, returning the scene tree or actionable policy errors.',
  input: z
    .object({
      compositionId: compositionIdSchema.optional(),
      source: z.string().min(1).optional(),
      frame: z.number().int().nonnegative().max(100_000).default(0),
    })
    .refine((input) => Boolean(input.compositionId || input.source), {
      message: 'Pass compositionId or source.',
    })
    .default({ frame: 0 }),
  readOnly: true,
  async execute(
    context: ToolContext,
    input: { compositionId?: string; source?: string; frame: number },
  ) {
    const snapshot = requireSnapshot(context);
    const saved = input.compositionId
      ? snapshot.compositions.find(
          (composition) => composition.id === input.compositionId,
        )
      : null;
    if (input.compositionId && !saved) {
      throw new Error('That composition is not in the project library.');
    }
    const source = input.source ?? saved?.source;
    if (!source) {
      throw new Error('Pass compositionId or source.');
    }
    const inspection = inspectSource(context, source, input.frame);
    if (!inspection.valid) {
      return {
        valid: false,
        frame: input.frame,
        sceneTree: null,
        error: inspection.error,
        issues: inspection.issues,
        repairHints: inspection.issues.map((issue) => issue.hint),
      };
    }
    const renderer = context.renderer();
    if (renderer) {
      try {
        const rendered = await renderer.previewComposition({
          source,
          frame: input.frame,
        });
        if (!rendered.valid) {
          return {
            valid: false,
            frame: input.frame,
            sceneTree: null,
            error: rendered.error,
            issues: [],
            repairHints: [
              rendered.error
                ? repairHint(rendered.error)
                : 'Preview failed inside the sandbox. Simplify the expression and try again.',
            ],
          };
        }
        return {
          valid: true,
          frame: input.frame,
          sceneTree: rendered.sceneTree,
          error: null,
          issues: [],
          repairHints: [],
        };
      } catch {
        // The sandbox is optional for headless clients. The policy-checked
        // interpreter above already produced a deterministic scene tree.
      }
    }
    return {
      valid: true,
      frame: input.frame,
      sceneTree: inspection.sceneTree,
      error: null,
      issues: [],
      repairHints: [],
    };
  },
};

export const COMPOSITION_TOOLS = [
  authorCompositionTool,
  reviseCompositionTool,
  previewCompositionTool,
];
