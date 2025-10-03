import createClient, {
  type Client,
  type FetchResponse,
  type ParseAsResponse,
} from 'openapi-fetch';
import type {
  MediaType,
  ResponseObjectMap,
  SuccessResponse,
} from 'openapi-typescript-helpers';
import { z } from 'zod';
import {
  generateAuthErrorMessage,
  detectClientContext,
  validateAndSanitizeToken,
  type ClientContext
} from '../auth.js';
import type { paths } from './types.js';

export function createManagementApiClient(
  baseUrl: string,
  accessToken: string,
  headers: Record<string, string> = {},
  clientContext?: ClientContext
) {
  const client = createClient<paths>({
    baseUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...headers,
    },
  });

  // Store client context for error handling
  (client as any).__clientContext = clientContext;

  return client;
}

export type ManagementApiClient = Client<paths>;

export type SuccessResponseType<
  T extends Record<string | number, any>,
  Options,
  Media extends MediaType,
> = {
  data: ParseAsResponse<SuccessResponse<ResponseObjectMap<T>, Media>, Options>;
  error?: never;
  response: Response;
};

const errorSchema = z.object({
  message: z.string(),
});

export function assertSuccess<
  T extends Record<string | number, any>,
  Options,
  Media extends MediaType,
>(
  response: FetchResponse<T, Options, Media>,
  fallbackMessage: string,
  client?: any
): asserts response is SuccessResponseType<T, Options, Media> {
  if ('error' in response) {
    if (response.response.status === 401) {
      // Enhanced error logging with more context
      console.error('[MCP Debug] 401 Unauthorized response details:', {
        status: response.response.status,
        statusText: response.response.statusText,
        url: response.response.url,
        headers: Object.fromEntries(response.response.headers.entries()),
        error: response.error,
        timestamp: new Date().toISOString(),
        clientContext: client?.__clientContext
      });

      // Get client context for better error messages
      const clientContext: ClientContext = client?.__clientContext || detectClientContext();

      // Generate context-aware error message
      const authErrorMessage = generateAuthErrorMessage(
        'Unauthorized: Invalid or expired access token.',
        clientContext
      );

      throw new Error(authErrorMessage);
    }

    const { data: errorContent } = errorSchema.safeParse(response.error);

    if (errorContent) {
      throw new Error(errorContent.message);
    }

    throw new Error(fallbackMessage);
  }
}
