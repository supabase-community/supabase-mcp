import { tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import builtinSchema from '../../__generated__/content-api-schema.text';
import {
  contentApiFetchSchema,
  type ContentApiClient,
  type IContentApiFetchArgs,
} from '../content-api/index.js';

export type DocsToolsOptions = {
  contentApiClient: ContentApiClient;
};

export function getDocsTools({ contentApiClient }: DocsToolsOptions) {
  return {
    get_latest_content_api_schema: tool({
      description:
        'Get the latest GraphQL schema for the Supabase Content API, which can be used to fetch Supabase documentation via the get_docs tool.',
      parameters: z.object({}).strict(),
      execute: async () => {
        const query = `
            query SchemaQuery {
              schema
            }
          `;
        return await contentApiClient.fetch({ query });
      },
    }),
    get_docs: tool({
      description: `Get help for using Supabase products and features by querying information from the Supabase documentation. You must call this tool with a JSON object containing a valid GraphQL query string as the value for the query key.

Do not use plain text or natural language as the value.

The query value must be a syntactically correct GraphQL query. The query argument should take the form of a valid GraphQL query, for example:

\`\`\`graphql
query {
  searchDocs(query: "example query") {
    nodes {
      title
      content
    }
  }
}
\`\`\`

Common mistakes to avoid:
- DO NOT: {"query": "random string"}
- DO: {"query": "query { ... }"}

Below is the GraphQL schema for the Supabase docs endpoint. (You can alternately get the latest version of the schema by calling the get_latest_content_api_schema tool.)

${builtinSchema}`,
      parameters: contentApiFetchSchema,
      execute: async (params: IContentApiFetchArgs) => {
        return await contentApiClient.fetch(params);
      },
    }),
  };
}
