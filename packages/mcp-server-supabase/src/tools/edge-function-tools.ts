import { z } from 'zod/v4';
import { edgeFunctionExample } from '../edge-function.js';
import type { EdgeFunctionsOperations } from '../platform/types.js';
import {
  edgeFunctionSchema,
  edgeFunctionWithBodySchema,
} from '../platform/types.js';
import { injectableTool, type ToolDefs } from './util.js';

type EdgeFunctionToolsOptions = {
  functions: EdgeFunctionsOperations;
  projectId?: string;
  readOnly?: boolean;
};

const listEdgeFunctionsInputSchema = z.object({
  project_id: z.string(),
});

const listEdgeFunctionsOutputSchema = z.object({
  functions: z.array(edgeFunctionSchema),
});

const getEdgeFunctionInputSchema = z.object({
  project_id: z.string(),
  function_slug: z.string(),
});

const getEdgeFunctionOutputSchema = edgeFunctionWithBodySchema;

const deployEdgeFunctionInputSchema = z.object({
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
      'The files to upload. This should include the entrypoint, deno.json, and any relative dependencies. Include the deno.json and deno.jsonc files to configure the Deno runtime (e.g., compiler options, imports) if they exist.'
    ),
});

const deployEdgeFunctionOutputSchema = edgeFunctionSchema;

export const edgeFunctionToolDefs = {
  list_edge_functions: {
    description: 'List all Edge Functions deployed in a Supabase project. Use when the user wants to view, review, or inventory existing serverless functions for debugging or management purposes. Accepts `project_ref` (required project identifier). e.g., project_ref="abcd1234efgh5678". Do not use when you need to create or deploy new functions (use appropriate deployment tools instead). Returns an error if the project reference is invalid or you lack access permissions.',
    parameters: listEdgeFunctionsInputSchema,
    outputSchema: listEdgeFunctionsOutputSchema,
    annotations: {
      title: 'List Edge Functions',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_edge_function: {
    description:
      'Retrieve the source code and configuration of a specific Edge Function deployed in a Supabase project. Use when the user wants to examine, debug, or review the implementation of an existing serverless function. Accepts `project_ref` (required) and `function_slug` (required string identifier). e.g., function_slug="hello-world" or "user-authentication". Do not use when you need to see all available functions (use list_edge_functions instead). Raises an error if the function does not exist or the project reference is invalid.',
    parameters: getEdgeFunctionInputSchema,
    outputSchema: getEdgeFunctionOutputSchema,
    annotations: {
      title: 'Get Edge Function',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  deploy_edge_function: {
    description: `Deploy an Edge Function to a Supabase project, creating a new version if the function already exists. Use when the user wants to publish serverless functions for real-time data processing or API endpoints. Do not use when you need to list existing functions or manage project-level deployments (use list_projects or create_project instead). Accepts `project_ref` (required), `function_name` (required), and `function_code` (required TypeScript/JavaScript string), e.g., function_name="hello-world" with basic HTTP handler code. Raises an error if the project reference is invalid or the function code contains syntax errors.`,
    parameters: deployEdgeFunctionInputSchema,
    outputSchema: deployEdgeFunctionOutputSchema,
    annotations: {
      title: 'Deploy Edge Function',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getEdgeFunctionTools({
  functions,
  projectId,
  readOnly,
}: EdgeFunctionToolsOptions) {
  const project_id = projectId;

  return {
    list_edge_functions: injectableTool({
      ...edgeFunctionToolDefs.list_edge_functions,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { functions: await functions.listEdgeFunctions(project_id) };
      },
    }),
    get_edge_function: injectableTool({
      ...edgeFunctionToolDefs.get_edge_function,
      inject: { project_id },
      execute: async ({ project_id, function_slug }) => {
        return await functions.getEdgeFunction(project_id, function_slug);
      },
    }),
    deploy_edge_function: injectableTool({
      ...edgeFunctionToolDefs.deploy_edge_function,
      inject: { project_id },
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
