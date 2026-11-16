import { z } from 'zod';

const reference = z.object({
  kind: z.enum(['clip', 'asset']),
  id: z.string(),
  fingerprint: z.string().nullable(),
  role: z.enum(['scope', 'input', 'output', 'removed']),
  stale: z.boolean().default(false),
});
const task = z.object({
  turnId: z.string(),
  request: z.string(),
  requestTruncated: z.boolean(),
  state: z.enum(['requested', 'pending', 'applied', 'failed', 'cancelled']),
  turnState: z.enum(['streaming', 'done', 'error', 'aborted']),
  references: z.array(reference).max(20),
  omittedReferences: z.number(),
  omittedDetails: z.boolean().default(false),
  commandIds: z.array(z.string()).max(20),
  jobIds: z.array(z.string()).max(20),
  proposalJobIds: z.array(z.string()).max(20),
  verification: z.enum(['unverified', 'partial', 'checked']),
  unresolvedConstraints: z.array(z.string()).max(20),
});
export const editingContextSchema = z.object({
  version: z.literal(1),
  projectId: z.string(),
  conversationId: z.string(),
  tasks: z.array(task).max(10),
  omittedTasks: z.number(),
});
export type EditingTask = z.infer<typeof task>;
export type EditingContext = z.infer<typeof editingContextSchema>;
