import { tool } from '@supabase/mcp-utils';
import { source } from 'common-tags';
import { z } from 'zod';
import { type ContentApiClient } from '../content-api/index.js';

export type DocsToolsOptions = {
  contentApiClient: ContentApiClient;
};

export function getDocsTools({ contentApiClient }: DocsToolsOptions) {
  return {
    search_docs: tool({
      description: source`
        Search the Supabase documentation using GraphQL. Must be a valid GraphQL query.

        You should default to calling this even if you think you already know the answer, since the documentation is always being updated.

        Below is the GraphQL schema for the Supabase docs endpoint:
        ${contentApiClient.schema}
      `,
      parameters: z.object({
        // Intentionally use a verbose param name for the LLM
        graphql_query: z.string().describe('GraphQL query string'),
      }),
      execute: async ({ graphql_query }) => {
        return await contentApiClient.query({ query: graphql_query });
      },
    }),
  };
}
