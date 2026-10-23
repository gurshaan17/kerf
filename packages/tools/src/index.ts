import { EDIT_TOOLS } from './edit';
import { READ_TOOLS } from './read';
import { ToolRegistry } from './registry';
import type { AnyToolDefinition } from './registry';

export * from './edit';
export * from './read';
export * from './registry';
export * from './types';

export const TOOL_DEFINITIONS = [
  ...READ_TOOLS,
  ...EDIT_TOOLS,
] as unknown as readonly AnyToolDefinition[];

export const toolRegistry = new ToolRegistry(TOOL_DEFINITIONS);
