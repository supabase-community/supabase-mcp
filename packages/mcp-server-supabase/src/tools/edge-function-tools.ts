import { z } from 'zod';
import { edgeFunctionExample } from '../edge-function.js';
import type { EdgeFunctionsOperations } from '../platform/types.js';
import { injectableTool } from './util.js';

export type EdgeFunctionToolsOptions = {
  functions: EdgeFunctionsOperations;
  projectId?: string;
  readOnly?: boolean;
};

export function getEdgeFunctionTools({
  functions,
  projectId,
  readOnly,
}: EdgeFunctionToolsOptions) {
  const project_id = projectId;

  return {
    list_edge_functions: injectableTool({
      description: 'Lists all Edge Functions in a Supabase project.',
      annotations: {
        title: 'List Edge Functions',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return await functions.listEdgeFunctions(project_id);
      },
    }),
    get_edge_function: injectableTool({
      description:
        'Retrieves file contents for an Edge Function in a Supabase project.',
      annotations: {
        title: 'Get Edge Function',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        function_slug: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id, function_slug }) => {
        return await functions.getEdgeFunction(project_id, function_slug);
      },
    }),
    deploy_edge_function: injectableTool({
      description: `Deploys an Edge Function to a Supabase project. If the function already exists, this will create a new version. Example:\n\n${edgeFunctionExample}`,
      annotations: {
        title: 'Deploy Edge Function',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        if (readOnly) {
          throw new Error('Cannot deploy an edge function in read-only mode.');
        }

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
