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
