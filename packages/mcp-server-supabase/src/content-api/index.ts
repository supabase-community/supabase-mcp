import { z } from 'zod';

export interface ContentApiClient {
  fetch: (args: IContentApiFetchArgs) => Promise<unknown>;
}

export const contentApiFetchSchema = z.object({
  query: z.string(),
  variables: z.record(z.string(), z.unknown()).optional(),
});
export type IContentApiFetchArgs = z.infer<typeof contentApiFetchSchema>;

export function createContentApiClient(
  url: string,
  headers: Record<string, string> = {}
): ContentApiClient {
  async function fetchImpl(args: IContentApiFetchArgs) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Accept: 'applicaton/json',
      },
      body: JSON.stringify(args),
    });
    await assertSuccess(response);

    try {
      const json = await response.json();
      const data = extractGraphQLData(json);
      return data;
    } catch (error) {
      const message =
        isPlainObjectOrClass(error) && 'message' in error
          ? error.message
          : null;
      throw Error(
        `Content API response was not valid JSON${message ? `: ${message}` : ''}`
      );
    }
  }

  return {
    async fetch(args: unknown) {
      const result = contentApiFetchSchema.safeParse(args);
      if (result.success) {
        const res = await fetchImpl(result.data);
        return res;
      } else {
        const error = result.error;
        throw Error(
          `Content API fetch called with incorrect arguments: ${error.message}`,
          { cause: error }
        );
      }
    },
  };
}

async function assertSuccess(response: Response) {
  if (!response.ok) {
    const message = await response.text();
    throw Error(`Content API responded with non-2xx HTTP status: ${message}`);
  }
}

function isPlainObjectOrClass(value: unknown): value is object {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function extractGraphQLData(json: { data?: any; errors?: Array<any> }) {
  if ('errors' in json) {
    const concatenatedMessage = json
      .errors!.map((error) =>
        isPlainObjectOrClass(error) && 'message' in error ? error.message : null
      )
      .filter(Boolean)
      .join('; ');
    throw Error(`Content API responded with error: ${concatenatedMessage}`, {
      cause: json.errors,
    });
  } else {
    return json.data;
  }
}
