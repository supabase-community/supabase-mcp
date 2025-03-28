import createClient, { type Client, type FetchResponse } from 'openapi-fetch';
import { z } from 'zod';
import type { paths } from './types.js';

export function createManagementApiClient(
  baseUrl: string,
  accessToken: string,
  headers: Record<string, string> = {}
) {
  return createClient<paths>({
    baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });
}

export type ManagementApiClient = Client<paths>;

const errorSchema = z.object({
  message: z.string(),
});

export function assertManagementApiResponse(
  response: FetchResponse<any, any, any>,
  fallbackMessage: string
) {
  if (!response.response.ok) {
    if (response.response.status === 401) {
      throw new Error(
        'Unauthorized. Please provide a valid access token to the MCP server via the --access-token flag.'
      );
    }

    const { data: errorContent } = errorSchema.safeParse(response.error);

    if (errorContent) {
      throw new Error(errorContent.message);
    }

    throw new Error(fallbackMessage);
  }
}
