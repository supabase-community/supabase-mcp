import { tool } from '@supabase/mcp-utils';
import { source } from 'common-tags';
import { z } from 'zod/v4';
import type { ContentApiClient } from '../content-api/index.js';

export type SearchDocsInput = z.infer<typeof searchDocsInputSchema>;
export type SearchDocsOutput = z.infer<typeof searchDocsOutputSchema>;
export type DocsToolsOptions = {
  contentApiClient: ContentApiClient;
};

export const searchDocsInputSchema = z.object({
  graphql_query: z.string().describe('GraphQL query string'),
});

export const searchDocsOutputSchema = z.record(z.string(), z.unknown());

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
      parameters: searchDocsInputSchema,
      outputSchema: searchDocsOutputSchema,
      execute: async ({ graphql_query }) => {
        const result = await contentApiClient.query({ query: graphql_query });
        return result as Record<string, unknown>;
      },
    }),
  };
}
