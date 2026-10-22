import { z } from 'zod';
import { idSchema, newId } from './ids';
import type { ProjectId } from './ids';

export const COMPOSITION_SOURCE_LIMIT = 60_000;

export const compositionSchema = z.object({
  id: idSchema('composition'),
  projectId: idSchema('project'),
  name: z.string().trim().min(1).max(120),
  source: z.string().min(1).max(COMPOSITION_SOURCE_LIMIT),
  width: z.number().int().min(16).max(16_384).default(1920),
  height: z.number().int().min(16).max(16_384).default(1080),
  durationFrames: z.number().int().positive().default(120),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export type Composition = z.infer<typeof compositionSchema>;

export const DEFAULT_COMPOSITION_SOURCE = `({
  background: '#111315',
  nodes: [
    {
      type: 'box',
      x: 8,
      y: 74,
      width: 46,
      height: 14,
      fill: '#c9a46a',
      radius: 2
    },
    {
      type: 'text',
      x: 12,
      y: 78,
      text: 'Kerf composition',
      fontSize: 3.2,
      fontWeight: 600,
      color: '#111315'
    }
  ]
})`;

export interface CreateCompositionInput {
  projectId: ProjectId;
  name: string;
  source?: string;
  width?: number;
  height?: number;
  durationFrames?: number;
  now?: number;
}

export function createComposition(input: CreateCompositionInput): Composition {
  const now = input.now ?? Date.now();
  return compositionSchema.parse({
    id: newId('composition'),
    projectId: input.projectId,
    name: input.name,
    source: input.source ?? DEFAULT_COMPOSITION_SOURCE,
    width: input.width,
    height: input.height,
    durationFrames: input.durationFrames,
    createdAt: now,
    updatedAt: now,
  });
}
