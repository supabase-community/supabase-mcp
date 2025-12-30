import { type Tool, tool } from '@supabase/mcp-utils';
import { z } from 'zod/v4';

type RequireKeys<Injected, Params> = {
  [K in keyof Injected]: K extends keyof Params ? Injected[K] : never;
};

type RecordSchema = z.ZodObject<any> | z.ZodRecord<any, any>;

export type InjectableTool<
  Params extends z.ZodObject,
  OutputSchema extends RecordSchema = RecordSchema,
  Injected extends Partial<z.infer<Params>> = {},
> = Tool<Params, OutputSchema> & {
  /**
   * Optionally injects static parameter values into the tool's
   * execute function and removes them from the parameter schema.
   *
   * Useful to scope tools to a specific project at config time
   * without redefining the tool.
   */
  inject?: Injected & RequireKeys<Injected, z.infer<Params>>;
};

export function injectableTool<
  Params extends z.ZodObject,
  OutputSchema extends RecordSchema,
  Injected extends Partial<z.infer<Params>>,
>({
  description,
  annotations,
  parameters,
  outputSchema,
  inject,
  execute,
}: InjectableTool<Params, OutputSchema, Injected>) {
  // If all injected parameters are undefined, return the original tool
  if (!inject || Object.values(inject).every((value) => value === undefined)) {
    return tool({
      description,
      annotations,
      parameters,
      outputSchema,
      execute,
    });
  }

  // Create a mask used to remove injected parameters from the schema
  const mask = Object.fromEntries(
    Object.keys(inject)
      .filter((key) => inject[key as keyof Injected] !== undefined)
      .map((key) => [key, true as const])
  );

  // Schema without injected parameters
  const cleanParametersSchema = parameters.omit(mask);

  // Wrapper that merges injected values with provided args
  const executeWithInjection = async (
    args: z.infer<typeof cleanParametersSchema>
  ) => {
    return execute({ ...args, ...inject } as z.infer<Params>);
  };

  return tool({
    description,
    annotations,
    parameters: cleanParametersSchema,
    outputSchema,
    execute: executeWithInjection,
  });
}
