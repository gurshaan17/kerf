import { BEAT_TOOLS } from './beat';
import { COMPOSITION_TOOLS } from './composition';
import { EDIT_TOOLS } from './edit';
import { EXPORT_TOOLS } from './export';
import { MACRO_TOOLS } from './macros';
import { READ_TOOLS } from './read';
import { REFERENCE_TOOLS } from './reference';
import { ToolRegistry } from './registry';
import type { AnyToolDefinition } from './registry';

export * from './beat';
export * from './composition';
export * from './edit';
export * from './export';
export * from './macros';
export * from './read';
export * from './reference';
export * from './registry';
export * from './types';

export const TOOL_DEFINITIONS = [
  ...READ_TOOLS,
  ...EDIT_TOOLS,
  ...MACRO_TOOLS,
  ...BEAT_TOOLS,
  ...REFERENCE_TOOLS,
  ...EXPORT_TOOLS,
  ...COMPOSITION_TOOLS,
] as unknown as readonly AnyToolDefinition[];

export const toolRegistry = new ToolRegistry(TOOL_DEFINITIONS);
