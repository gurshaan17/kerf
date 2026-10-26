import { z } from 'zod';
import { idSchema, newId } from './ids';
import { sequenceSchema, createSequence } from './sequence';
import {
  referenceProfileSchema,
  styleConfigSchema,
  DEFAULT_STYLE,
} from './style';
import { FRAME_RATES, frameRateSchema } from './time';
import type { Sequence } from './sequence';
import type { ReferenceProfile, StyleConfig } from './style';

export const PROJECT_SCHEMA_VERSION = 1;

export const projectSchema = z.object({
  schemaVersion: z
    .literal(PROJECT_SCHEMA_VERSION)
    .default(PROJECT_SCHEMA_VERSION),
  id: idSchema('project'),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sequence: sequenceSchema,
  style: styleConfigSchema.default(DEFAULT_STYLE),
  reference: referenceProfileSchema.nullable().default(null),
});

export type Project = z.infer<typeof projectSchema>;

export interface CreateProjectInput {
  name: string;
  width?: number;
  height?: number;
  frameRate?: z.input<typeof frameRateSchema>;
  sequence?: Sequence;
  style?: Partial<StyleConfig>;
  reference?: ReferenceProfile | null;
  now?: number;
}

export function createProject(input: CreateProjectInput): Project {
  const now = input.now ?? Date.now();
  const sequence =
    input.sequence ??
    createSequence({
      name: input.name,
      frameRate: input.frameRate ?? FRAME_RATES.film,
      width: input.width,
      height: input.height,
    });

  return projectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId('project'),
    name: input.name,
    createdAt: now,
    updatedAt: now,
    sequence,
    style: { ...DEFAULT_STYLE, ...input.style },
    reference: input.reference ?? null,
  });
}
