import { z } from 'zod';
import { idSchema } from '@kerf/model';
import type { ToolContext, ToolEditingAccess } from './types';

const jobInput = z.object({ jobId: idSchema('job') });
const planInput = z.object({
  clipId: idSchema('clip'),
  providerId: z.string().min(1),
});
export const suggestedZoomSchema = planInput
  .extend({
    storyboardId: z.string().min(1),
    frame: z.number().int().nonnegative(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();
export type SuggestedZoom = z.infer<typeof suggestedZoomSchema>;
function access(context: ToolContext): ToolEditingAccess {
  if (!context.editing)
    throw new Error('AI editing analysis is unavailable in this session.');
  return context.editing();
}
export const EDITING_TOOLS = [
  {
    name: 'suggestZoom',
    description:
      'Prepare one gentle zoom at an inspected storyboard frame. Coordinates are normalized to the composited canvas. Creates a previewable suggestion only. The timeline changes only when the user applies it in Kerf.',
    input: suggestedZoomSchema,
    readOnly: false,
    execute: (context: ToolContext, input: SuggestedZoom) => {
      const editing = access(context);
      if (!editing.suggestZoom)
        throw new Error('Zoom suggestions are unavailable.');
      const visualReview = context.visualReview?.();
      if (!visualReview?.checkZoomEvidence)
        throw new Error('Visual evidence is unavailable.');
      visualReview.checkZoomEvidence(input);
      return editing.suggestZoom(input, context.checkCommand);
    },
  },
  {
    name: 'planAutoCut',
    description:
      'Start contextual cut analysis for a normal-speed video clip up to five minutes. Requires configured vision and chat consent. Returns a job; does not edit the timeline.',
    input: planInput.extend({
      purpose: z.string().trim().max(1000).default(''),
    }),
    readOnly: false,
    execute: (
      context: ToolContext,
      input: { clipId: string; providerId: string; purpose: string },
    ) => access(context).start('autoCut', input),
  },
  {
    name: 'planScreenPolish',
    description:
      'Start screen-interaction analysis for a normal-speed video clip up to five minutes. Requires configured vision consent. Returns a job; does not edit the timeline.',
    input: planInput,
    readOnly: false,
    execute: (
      context: ToolContext,
      input: { clipId: string; providerId: string },
    ) => access(context).start('screenPolish', input),
  },
  {
    name: 'readEditingJob',
    description:
      'Read a project-scoped editing job, progress, error and review/apply status. Poll on a later turn if still running; do not spin indefinitely.',
    input: jobInput,
    readOnly: true,
    execute: (context: ToolContext, input: { jobId: string }) =>
      access(context).read(input.jobId),
  },
  {
    name: 'cancelEditingJob',
    description:
      'Idempotently cancel project-scoped editing analysis and invalidate pending review. Already committed edits remain applied.',
    input: jobInput,
    readOnly: false,
    execute: (context: ToolContext, input: { jobId: string }) =>
      access(context).cancel(input.jobId),
  },
  {
    name: 'readEditProposal',
    description:
      'Read stored editing evidence, reasons, eligible change IDs and source fingerprint. No proposal until analysis succeeds.',
    input: jobInput,
    readOnly: true,
    execute: (context: ToolContext, input: { jobId: string }) =>
      access(context).proposal(input.jobId),
  },
  {
    name: 'applyEditProposal',
    description:
      'Request desktop review of selected stored change IDs. Returns awaiting-review; edits apply only after the user reviews and clicks Apply in Kerf chat. Never claim edits were applied from this response. Both chat and MCP require this review.',
    input: jobInput.extend({
      changeIds: z.array(z.string().min(1)).min(1).max(400),
    }),
    readOnly: false,
    execute: (
      context: ToolContext,
      input: { jobId: string; changeIds: string[] },
    ) =>
      access(context).requestApply(
        input.jobId,
        input.changeIds,
        context.checkCommand,
      ),
  },
];
