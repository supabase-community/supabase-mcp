import { type Tool, tool } from '@supabase/mcp-utils';
import { z } from 'zod';

type RequireKeys<Injected, Params> = {
  [K in keyof Injected]: K extends keyof Params ? Injected[K] : never;
};

export type InjectableTool<
  Params extends z.ZodObject<any> = z.ZodObject<any>,
  Result = unknown,
  Injected extends Partial<z.infer<Params>> = {},
> = Tool<Params, Result> & {
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
  Params extends z.ZodObject<any>,
  Result,
  Injected extends Partial<z.infer<Params>>,
>({
  description,
  parameters,
  inject,
  execute,
}: InjectableTool<Params, Result, Injected>) {
  // If all injected parameters are undefined, return the original tool
  if (!inject || Object.values(inject).every((value) => value === undefined)) {
    return tool({
      description,
      parameters,
      execute,
    });
  }

  // Create a mask used to remove injected parameters from the schema
  const mask = Object.fromEntries(
    Object.entries(inject)
      .filter(([_, value]) => value !== undefined)
      .map(([key]) => [key, true as const])
  );

  type NonNullableKeys = {
    [K in keyof Injected]: Injected[K] extends undefined ? never : K;
  }[keyof Injected];

  type CleanParams = z.infer<Params> extends any
    ? {
        [K in keyof z.infer<Params> as K extends NonNullableKeys
          ? never
          : K]: z.infer<Params>[K];
      }
    : never;

  return tool({
    description,
    parameters: parameters.omit(mask),
    execute: (args) => execute({ ...args, ...inject }),
  }) as Tool<z.ZodObject<any, any, any, CleanParams>, Result>;
}
