import type { z } from 'zod';
import type { ToolContext } from './types';

export interface AnyToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly input: z.ZodTypeAny;
  readonly output?: z.ZodTypeAny;
  readonly readOnly: boolean;
  execute(context: ToolContext, input: unknown): Promise<unknown> | unknown;
}

export interface DefineToolInput<
  Input extends z.ZodTypeAny,
  Output extends z.ZodTypeAny,
> {
  readonly name: string;
  readonly description: string;
  readonly input: Input;
  readonly output?: Output;
  readonly readOnly?: boolean;
  readonly execute: (
    context: ToolContext,
    input: z.infer<Input>,
  ) => Promise<z.infer<Output>> | z.infer<Output>;
}

export function defineTool<
  Input extends z.ZodTypeAny,
  Output extends z.ZodTypeAny,
>(definition: DefineToolInput<Input, Output>): AnyToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    input: definition.input,
    output: definition.output,
    readOnly: definition.readOnly ?? false,
    execute(context, input) {
      return definition.execute(context, input as z.infer<Input>);
    },
  };
}

export class ToolRegistry {
  private readonly byName: ReadonlyMap<string, AnyToolDefinition>;

  constructor(definitions: readonly AnyToolDefinition[]) {
    const byName = new Map<string, AnyToolDefinition>();
    for (const definition of definitions) {
      if (byName.has(definition.name)) {
        throw new Error(`Duplicate tool name: ${definition.name}`);
      }
      byName.set(definition.name, definition);
    }
    this.byName = byName;
  }

  list(): readonly AnyToolDefinition[] {
    return [...this.byName.values()];
  }

  names(): readonly string[] {
    return [...this.byName.keys()];
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.byName.get(name);
  }

  require(name: string): AnyToolDefinition {
    const definition = this.get(name);
    if (!definition) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return definition;
  }

  async call(
    name: string,
    input: unknown,
    context: ToolContext,
  ): Promise<unknown> {
    const definition = this.require(name);
    const parsed = definition.input.parse(input);
    const output = await definition.execute(context, parsed);
    return definition.output ? definition.output.parse(output) : output;
  }
}
