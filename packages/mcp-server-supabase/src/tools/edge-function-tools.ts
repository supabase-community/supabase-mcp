import { z } from 'zod';
import { edgeFunctionExample } from '../edge-function.js';
import type { EdgeFunctionsOperations } from '../platform/types.js';
import { injectableTool } from './util.js';

export type EdgeFunctionToolsOptions = {
  functions: EdgeFunctionsOperations;
  projectId?: string;
};

export function getEdgeFunctionTools({
  functions,
  projectId,
}: EdgeFunctionToolsOptions) {
  const project_id = projectId;

  return {
    list_edge_functions: injectableTool({
      description: 'Lists all Edge Functions in a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return await functions.listEdgeFunctions(project_id);
      },
    }),
    deploy_edge_function: injectableTool({
      description: `Deploys an Edge Function to a Supabase project. If the function already exists, this will create a new version. Example:\n\n${edgeFunctionExample}`,
      parameters: z.object({
        project_id: z.string(),
        name: z.string().describe('The name of the function'),
        entrypoint_path: z
          .string()
          .default('index.ts')
          .describe('The entrypoint of the function'),
        import_map_path: z
          .string()
          .describe('The import map for the function.')
          .optional(),
        files: z
          .array(
            z.object({
              name: z.string(),
              content: z.string(),
            })
          )
          .describe(
            'The files to upload. This should include the entrypoint and any relative dependencies.'
          ),
      }),
      inject: { project_id },
      execute: async ({
        project_id,
        name,
        entrypoint_path,
        import_map_path,
        files,
      }) => {
        return await functions.deployEdgeFunction(project_id, {
          name,
          entrypoint_path,
          import_map_path,
          files,
        });
      },
    }),
  };
}
