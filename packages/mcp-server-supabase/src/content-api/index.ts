import { z } from 'zod';
import { GraphQLClient, type GraphQLRequest, type QueryFn } from './graphql.js';

const contentApiSchemaResponseSchema = z.object({
  schema: z.string(),
});

export type ContentApiClient = {
  schema: string;
  query: QueryFn;
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

  const { source } = await graphqlClient.schemaLoaded;

  return {
    schema: source,
    async query(request: GraphQLRequest) {
      return graphqlClient.query(request);
    },
  };
}
