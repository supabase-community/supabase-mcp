import { tool } from '@supabase/mcp-utils';
import { source } from 'common-tags';
import { z } from 'zod/v4';
import type { ContentApiClient } from '../content-api/index.js';

// Schemas with .describe() moved to module level to avoid re-registering in Zod's globalRegistry
const graphqlQuerySchema = z.string().describe('GraphQL query string');

export type DocsToolsOptions = {
  contentApiClient: ContentApiClient;
};

export function getDocsTools({ contentApiClient }: DocsToolsOptions) {
  return {
    search_docs: tool({
      description: async () => {
        const schema = await contentApiClient.loadSchema();

        return source`
          Search the Supabase documentation using GraphQL. Must be a valid GraphQL query.
          You should default to calling this even if you think you already know the answer, since the documentation is always being updated.

          Below is the GraphQL schema for this tool:

          ${schema}
        `;
      },
      annotations: {
        title: 'Search docs',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        // Intentionally use a verbose param name for the LLM
        graphql_query: graphqlQuerySchema,
      }),
      execute: async ({ graphql_query }) => {
        return await contentApiClient.query({ query: graphql_query });
      },
    }),
  };
}
