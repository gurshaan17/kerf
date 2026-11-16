import { z } from 'zod';
import { idSchema } from '@kerf/model';

export const chatScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project') }),
  z.object({
    kind: z.literal('targets'),
    clipIds: z.array(idSchema('clip')).max(50),
    assetIds: z.array(idSchema('asset')).max(50),
    revision: z.number().nonnegative(),
  }),
]);
export type ChatScope = import('@kerf/tools').EditingScope;
