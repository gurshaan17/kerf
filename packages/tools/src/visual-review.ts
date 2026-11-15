import { z } from 'zod';
import {
  fitSchema,
  idSchema,
  overlayPropsPatchSchema,
  textStyleSchema,
  transformSchema,
} from '@kerf/model';
import type { Clip, FrameRate } from '@kerf/model';
import type { ToolContext, ToolRenderedFrame } from './types';
import type { TimelineFinding } from './verification';

export const VISUAL_REVIEW_LIMITS = {
  framesPerPass: 4,
  framesPerReview: 8,
  maxWidth: 960,
  imageBytes: 4_000_000,
  renderMsPerPass: 15_000,
  renderMsPerReview: 30_000,
  lifetimeMs: 120_000,
  repairs: 4,
  objects: 32,
} as const;

export const storyboardInputSchema = z
  .object({
    frames: z
      .array(z.number().int().nonnegative())
      .min(1)
      .max(VISUAL_REVIEW_LIMITS.framesPerPass)
      .refine(
        (frames) => new Set(frames).size === frames.length,
        'Choose distinct frames.',
      )
      .optional(),
    clipIds: z.array(idSchema('clip')).min(1).max(12).optional(),
    maxWidth: z
      .number()
      .int()
      .min(64)
      .max(VISUAL_REVIEW_LIMITS.maxWidth)
      .default(640),
    recheckOf: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.recheckOf
        ? !input.frames && !input.clipIds
        : Boolean(input.frames || input.clipIds),
    'Provide frames/clipIds for an initial review, or only recheckOf for its single recheck.',
  );
export type StoryboardInput = z.infer<typeof storyboardInputSchema>;

const visualPatchSchema = z
  .object({
    transform: z
      .object({
        x: transformSchema.shape.x.removeDefault().optional(),
        y: transformSchema.shape.y.removeDefault().optional(),
        scale: transformSchema.shape.scale.removeDefault().optional(),
        rotation: transformSchema.shape.rotation.removeDefault().optional(),
        opacity: transformSchema.shape.opacity.removeDefault().optional(),
        anchorX: transformSchema.shape.anchorX.removeDefault().optional(),
        anchorY: transformSchema.shape.anchorY.removeDefault().optional(),
      })
      .strict()
      .optional(),
    style: z
      .object({
        fontFamily: textStyleSchema.shape.fontFamily.removeDefault().optional(),
        fontSize: textStyleSchema.shape.fontSize.removeDefault().optional(),
        fontWeight: textStyleSchema.shape.fontWeight.removeDefault().optional(),
        color: textStyleSchema.shape.color.removeDefault().optional(),
        background: textStyleSchema.shape.background.removeDefault().optional(),
        align: textStyleSchema.shape.align.removeDefault().optional(),
        lineHeight: textStyleSchema.shape.lineHeight.removeDefault().optional(),
        letterSpacing: textStyleSchema.shape.letterSpacing
          .removeDefault()
          .optional(),
        padding: textStyleSchema.shape.padding.removeDefault().optional(),
      })
      .strict()
      .optional(),
    fit: fitSchema.optional(),
    props: overlayPropsPatchSchema
      .omit({
        kind: true,
        text: true,
        transitionInFrames: true,
        transitionOutFrames: true,
        easing: true,
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (patch) =>
      Object.values(patch).some(
        (value) =>
          typeof value !== 'object' ||
          (value !== null && Object.keys(value).length > 0),
      ),
    'Provide a visual property to repair.',
  );

export const visualFindingSchema = z
  .object({
    clipId: idSchema('clip'),
    frame: z.number().int().nonnegative(),
    category: z.enum(['text-clipping', 'contrast', 'framing', 'layout']),
    observation: z.string().trim().min(1).max(800),
    patch: visualPatchSchema.optional(),
  })
  .strict();
export const visualRepairInputSchema = z
  .object({
    storyboardId: z.string().min(1).max(100),
    findings: z.array(visualFindingSchema).max(8),
  })
  .strict();
export type VisualRepairInput = z.infer<typeof visualRepairInputSchema>;
export type VisualFinding = z.infer<typeof visualFindingSchema>;
export interface StoryboardFrame extends ToolRenderedFrame {
  readonly clipIds: readonly string[];
}
export interface StoryboardObject {
  readonly clipId: string;
  readonly type: Clip['type'];
  readonly label: string;
  readonly startFrame: number;
  readonly endFrame: number;
  readonly transform: Clip['transform'];
  readonly style?: Extract<Clip, { type: 'text' }>['style'];
  readonly fit?: Extract<Clip, { type: 'image' }>['fit'];
  readonly props?: Extract<Clip, { type: 'fxOverlay' }>['props'];
  readonly text?: string;
  readonly keyframeProperties: readonly string[];
}
export interface StoryboardResult {
  readonly storyboardId: string;
  readonly projectId: string;
  readonly revision: string;
  readonly frameRate: FrameRate;
  readonly pass: 'initial' | 'recheck';
  readonly status: 'ready' | 'partial' | 'blocked';
  readonly frames: readonly StoryboardFrame[];
  readonly canvas: { width: number; height: number };
  readonly objects: readonly StoryboardObject[];
  readonly objectsTruncated: boolean;
  readonly structuralFindings: readonly TimelineFinding[];
  readonly findings: readonly VisualFinding[];
  readonly samplingTruncated: boolean;
  readonly repairCommandId?: string;
  readonly budgets: {
    remainingFrames: number;
    remainingImageBytes: number;
    remainingRenderMs: number;
  };
  readonly scope: string;
  readonly note: string;
}
export interface VisualRepairResult {
  readonly storyboardId: string;
  readonly status: 'repaired' | 'reviewed' | 'no-change';
  readonly commandId?: string;
  readonly findings: readonly VisualFinding[];
  readonly recheckRequired: boolean;
  readonly note: string;
}
export interface ToolVisualReviewAccess {
  render(input: StoryboardInput): Promise<StoryboardResult>;
  repair(input: VisualRepairInput): VisualRepairResult;
}

export const VISUAL_REVIEW_TOOLS = [
  {
    name: 'renderStoryboard',
    readOnly: true,
    description:
      'Run structural checks, then render at most four composited timeline frames for visual inspection. Pass explicit frames or clipIds to sample boundaries and caption/overlay midpoints. Returns actual PNG images, canvas dimensions, up to 32 active objects with current visual properties, and revision-scoped evidence. One repairVisuals batch and one recheckOf are allowed; rendering/image/time budgets apply. Sampling does not verify playback, audio or the whole video.',
    input: storyboardInputSchema,
    execute(context: ToolContext, input: StoryboardInput) {
      if (!context.visualReview)
        throw new Error(
          'Storyboard inspection is unavailable in this session.',
        );
      return context.visualReview().render(input);
    },
  },
  {
    name: 'repairVisuals',
    readOnly: false,
    description:
      'Record frame-linked visual findings and optionally apply one small undoable batch of visual property repairs. Cite exact clipId/frame pairs returned by renderStoryboard. Patches can change transform, text style, fit or overlay appearance, never timing, speech or source media. Findings without patches are inspection only. Stale evidence, no-op patches, repeat repairs and more than four patches are rejected or closed without mutation. After a repair call renderStoryboard with recheckOf once, then report remaining issues and stop.',
    input: visualRepairInputSchema,
    execute(context: ToolContext, input: VisualRepairInput) {
      if (!context.visualReview)
        throw new Error('Visual refinement is unavailable in this session.');
      return context.visualReview().repair(input);
    },
  },
];
