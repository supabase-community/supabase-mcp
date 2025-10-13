import { z } from 'zod';
import { GraphQLClient, type GraphQLRequest, type QueryFn } from './graphql.js';

const contentApiSchemaResponseSchema = z.object({
  schema: z.string(),
});

export type ContentApiClient = {
  schema: string;
  query: QueryFn;
  setUserAgent: (userAgent: string) => void;
};

export async function createContentApiClient(
  url: string,
  headers?: Record<string, string>
): Promise<ContentApiClient> {
  const graphqlClient = new GraphQLClient({
    url,
    headers,
    // Content API provides schema string via `schema` query
    loadSchema: async ({ query }) => {
      const response = await query({ query: '{ schema }' });
      const { schema } = contentApiSchemaResponseSchema.parse(response);
      return schema;
    },
  });

  // Lazy schema loading - don't wait for schema on initialization
  // Schema will be loaded when first query is made
  let schemaSource: string | null = null;

  return {
    get schema(): string {
      // Return empty string if schema not yet loaded
      // Will be populated after first query
      return schemaSource ?? '';
    },
    async query(request: GraphQLRequest) {
      // Load schema on first query if not already loaded
      if (schemaSource === null) {
        try {
          const { source } = await graphqlClient.schemaLoaded;
          schemaSource = source;
        } catch {
          // If schema loading fails, continue without validation
          // This allows the server to start even if docs API is down
        }
      }
      return graphqlClient.query(request);
    },
    setUserAgent(userAgent: string) {
      graphqlClient.setUserAgent(userAgent);
    },
  };
}
