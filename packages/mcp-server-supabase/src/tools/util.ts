import { type Tool, tool } from '@supabase/mcp-utils';
import { z } from 'zod';

export type OmitFromZodObject<
  T extends z.ZodObject<any>,
  K extends string,
> = z.ZodObject<Omit<T['shape'], K>>;

/**
 * Optionally injects the project ID into the tool's execute function
 * and removes it from the parameters.
 *
 * Used to scope tools to a specific project set at config time.
 */
export function injectProjectId<Params extends z.ZodObject<any>, Result>(
  projectId: string | undefined,
  toolDef: Tool<Params, Result>
) {
  if (!toolDef.parameters.shape.project_id) {
    throw new Error('Tool parameters must have a project_id field to inject');
  }

  if (!projectId) {
    return toolDef;
  }

  return tool({
    ...toolDef,
    parameters: toolDef.parameters.omit({
      project_id: true,
    }) as OmitFromZodObject<Params, 'project_id'>,
    execute: async (args) => {
      return toolDef.execute({ ...args, project_id: projectId });
    },
  });
}
