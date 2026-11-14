import { z } from 'zod';
import { idSchema } from '@kerf/model';
import type { ToolContext, ToolEditingAccess } from './types';

const jobInput = z.object({ jobId: idSchema('job') });
const planInput = z.object({
  clipId: idSchema('clip'),
  providerId: z.string().min(1),
});
function access(context: ToolContext): ToolEditingAccess {
  if (!context.editing)
    throw new Error('AI editing analysis is unavailable in this session.');
  return context.editing();
}
export const EDITING_TOOLS = [
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
    ) => access(context).requestApply(input.jobId, input.changeIds),
  },
];
