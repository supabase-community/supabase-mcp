import { codeBlock } from 'common-tags';
import { resolve } from 'node:path';

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

/**
 * Strips prefix from edge function file names, accounting for Deno 1 and 2.
 */
export function normalizeFilename({
  deploymentId,
  filename,
}: { deploymentId: string; filename: string }) {
  const pathPrefix = getPathPrefix(deploymentId);

  // Deno 2 uses relative filenames, Deno 1 uses absolute. Resolve both to absolute first.
  const filenameAbsolute = resolve(pathPrefix, filename);

  // Strip prefix(es)
  return filenameAbsolute.replace(pathPrefix, '').replace('source/', '');
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
