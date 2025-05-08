import { codeBlock } from 'common-tags';
import { fileURLToPath } from 'node:url';
import { extractFiles } from './eszip.js';
import {
  assertSuccess,
  type ManagementApiClient,
} from './management-api/index.js';

/**
 * Gets the deployment ID for an Edge Function.
 */
export function getDeploymentId(
  projectId: string,
  functionId: string,
  functionVersion: number
): string {
  return `${projectId}_${functionId}_${functionVersion}`;
}

/**
 * Gets the path prefix applied to each file in an Edge Function.
 */
export function getPathPrefix(deploymentId: string) {
  return `/tmp/user_fn_${deploymentId}/`;
}

export const edgeFunctionExample = codeBlock`
  import "jsr:@supabase/functions-js/edge-runtime.d.ts";

  Deno.serve(async (req: Request) => {
    const data = {
      message: "Hello there!"
    };
    
    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  });
`;

/**
 * Fetches a full Edge Function from the Supabase Management API.

 * - Includes both function metadata and the contents of each file.
 * - Normalizes file paths to be relative to the project root.
 */
export async function getFullEdgeFunction(
  managementApiClient: ManagementApiClient,
  projectId: string,
  functionSlug: string
) {
  const functionResponse = await managementApiClient.GET(
    '/v1/projects/{ref}/functions/{function_slug}',
    {
      params: {
        path: {
          ref: projectId,
          function_slug: functionSlug,
        },
      },
    }
  );

  if (functionResponse.error) {
    return {
      data: undefined,
      error: functionResponse.error as { message: string },
    };
  }

  assertSuccess(functionResponse, 'Failed to fetch Edge Function');

  const edgeFunction = functionResponse.data;

  const deploymentId = getDeploymentId(
    projectId,
    edgeFunction.id,
    edgeFunction.version
  );

  const pathPrefix = getPathPrefix(deploymentId);

  const entrypoint_path = edgeFunction.entrypoint_path
    ? fileURLToPath(edgeFunction.entrypoint_path, { windows: false }).replace(
        pathPrefix,
        ''
      )
    : undefined;

  const import_map_path = edgeFunction.import_map_path
    ? fileURLToPath(edgeFunction.import_map_path, { windows: false }).replace(
        pathPrefix,
        ''
      )
    : undefined;

  const eszipResponse = await managementApiClient.GET(
    '/v1/projects/{ref}/functions/{function_slug}/body',
    {
      params: {
        path: {
          ref: projectId,
          function_slug: functionSlug,
        },
      },
      parseAs: 'arrayBuffer',
    }
  );

  assertSuccess(eszipResponse, 'Failed to fetch Edge Function eszip bundle');

  const extractedFiles = await extractFiles(
    new Uint8Array(eszipResponse.data),
    pathPrefix
  );

  const files = await Promise.all(
    extractedFiles.map(async (file) => ({
      name: file.name,
      content: await file.text(),
    }))
  );

  const normalizedFunction = {
    ...edgeFunction,
    entrypoint_path,
    import_map_path,
    files,
  };

  return { data: normalizedFunction, error: undefined };
}
