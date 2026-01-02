import { z } from 'zod/v4';
import { edgeFunctionExample } from '../edge-function.js';
import type { EdgeFunctionsOperations } from '../platform/types.js';
import {
  edgeFunctionSchema,
  edgeFunctionWithBodySchema,
} from '../platform/types.js';
import { injectableTool } from './util.js';

export type ListEdgeFunctionsInput = z.infer<typeof listEdgeFunctionsInputSchema>;
export type ListEdgeFunctionsOutput = z.infer<typeof listEdgeFunctionsOutputSchema>;
export type GetEdgeFunctionInput = z.infer<typeof getEdgeFunctionInputSchema>;
export type GetEdgeFunctionOutput = z.infer<typeof getEdgeFunctionOutputSchema>;
export type DeployEdgeFunctionInput = z.infer<typeof deployEdgeFunctionInputSchema>;
export type DeployEdgeFunctionOutput = z.infer<typeof deployEdgeFunctionOutputSchema>;
export type EdgeFunctionToolsOptions = {
  functions: EdgeFunctionsOperations;
  projectId?: string;
  readOnly?: boolean;
};

export const listEdgeFunctionsInputSchema = z.object({
  project_id: z.string(),
});

export const listEdgeFunctionsOutputSchema = z.object({
  functions: z.array(edgeFunctionSchema),
});

export const getEdgeFunctionInputSchema = z.object({
  project_id: z.string(),
  function_slug: z.string(),
});

export const getEdgeFunctionOutputSchema = edgeFunctionWithBodySchema;

export const deployEdgeFunctionInputSchema = z.object({
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
  verify_jwt: z
    .boolean()
    .default(true)
    .describe(
      "Whether to require a valid JWT in the Authorization header. You SHOULD ALWAYS enable this to ensure authorized access. ONLY disable if the function previously had it disabled OR you've confirmed the function body implements custom authentication (e.g., API keys, webhooks) OR the user explicitly requested it be disabled."
    ),
  files: z
    .array(
      z.object({
        name: z.string(),
        content: z.string(),
      })
    )
    .describe(
      'The files to upload. This should include the entrypoint, deno.json, and any relative dependencies. Always include a deno.json file to configure the Deno runtime (e.g., compiler options, imports) UNLESS it was previously deployed without deno.json.'
    ),
});

export const deployEdgeFunctionOutputSchema = edgeFunctionSchema;

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
      parameters: listEdgeFunctionsInputSchema,
      inject: { project_id },
      outputSchema: listEdgeFunctionsOutputSchema,
      execute: async ({ project_id }) => {
        return { functions: await functions.listEdgeFunctions(project_id) };
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
      parameters: getEdgeFunctionInputSchema,
      inject: { project_id },
      outputSchema: getEdgeFunctionOutputSchema,
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
      parameters: deployEdgeFunctionInputSchema,
      inject: { project_id },
      outputSchema: deployEdgeFunctionOutputSchema,
      execute: async ({
        project_id,
        name,
        entrypoint_path,
        import_map_path,
        verify_jwt,
        files,
      }) => {
        if (readOnly) {
          throw new Error('Cannot deploy an edge function in read-only mode.');
        }

        return await functions.deployEdgeFunction(project_id, {
          name,
          entrypoint_path,
          import_map_path,
          verify_jwt,
          files,
        });
      },
    }),
  };
}
