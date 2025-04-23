import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import { edgeFunctionExample, getFullEdgeFunction } from '../edge-function.js';
import {
  assertSuccess,
  type ManagementApiClient,
} from '../management-api/index.js';
import { injectProjectId } from './util.js';

export type EdgeFunctionToolsOptions = {
  managementApiClient: ManagementApiClient;
  projectId?: string;
};

export function getEdgeFunctionTools({
  managementApiClient,
  projectId,
}: EdgeFunctionToolsOptions) {
  return {
    list_edge_functions: injectProjectId(
      projectId,
      tool({
        description: 'Lists all Edge Functions in a Supabase project.',
        parameters: z.object({
          project_id: z.string(),
        }),
        execute: async ({ project_id }) => {
          const response = await managementApiClient.GET(
            '/v1/projects/{ref}/functions',
            {
              params: {
                path: {
                  ref: project_id,
                },
              },
            }
          );

          assertSuccess(response, 'Failed to fetch Edge Functions');

          // Fetch files for each Edge Function
          const edgeFunctions = await Promise.all(
            response.data.map(async (listedFunction) => {
              const { data: edgeFunction, error } = await getFullEdgeFunction(
                managementApiClient,
                project_id,
                listedFunction.slug
              );

              if (error) {
                throw error;
              }

              return edgeFunction;
            })
          );

          return edgeFunctions;
        },
      })
    ),
    deploy_edge_function: injectProjectId(
      projectId,
      tool({
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
        execute: async ({
          project_id,
          name,
          entrypoint_path,
          import_map_path,
          files,
        }) => {
          const { data: existingEdgeFunction } = await getFullEdgeFunction(
            managementApiClient,
            project_id,
            name
          );

          const import_map_file = files.find((file) =>
            ['deno.json', 'import_map.json'].includes(file.name)
          );

          // Use existing import map path or file name heuristic if not provided
          import_map_path ??=
            existingEdgeFunction?.import_map_path ?? import_map_file?.name;

          const response = await managementApiClient.POST(
            '/v1/projects/{ref}/functions/deploy',
            {
              params: {
                path: {
                  ref: project_id,
                },
                query: { slug: name },
              },
              body: {
                metadata: {
                  name,
                  entrypoint_path,
                  import_map_path,
                },
                file: files as any, // We need to pass file name and content to our serializer
              },
              bodySerializer(body) {
                const formData = new FormData();

                const blob = new Blob([JSON.stringify(body.metadata)], {
                  type: 'application/json',
                });
                formData.append('metadata', blob);

                body.file?.forEach((f: any) => {
                  const file: { name: string; content: string } = f;
                  const blob = new Blob([file.content], {
                    type: 'application/typescript',
                  });
                  formData.append('file', blob, file.name);
                });

                return formData;
              },
            }
          );

          assertSuccess(response, 'Failed to deploy Edge Function');

          return response.data;
        },
      })
    ),
  };
}
