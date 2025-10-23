import { z } from 'zod';
import { GraphQLClient, type GraphQLRequest, type QueryFn } from './graphql.js';

const contentApiSchemaResponseSchema = z.object({
  schema: z.string(),
});

export type ContentApiClient = {
  loadSchema: () => Promise<string>;
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
  });

  return {
    // Content API provides schema string via `schema` query
    loadSchema: async () => {
      const response = await graphqlClient.query({ query: '{ schema }' });
      const { schema } = contentApiSchemaResponseSchema.parse(response);
      return schema;
    },
    async query(request: GraphQLRequest) {
      return graphqlClient.query(request);
    },
    setUserAgent(userAgent: string) {
      graphqlClient.setUserAgent(userAgent);
    },
  };
}
