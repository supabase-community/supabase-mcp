import { source } from 'common-tags';
import { z } from 'zod';
import type { DatabaseOperations } from '../platform/types.js';
import { injectableTool } from './util.js';
import { limitResponseSize } from '../response/index.js';

export type SnippetsToolsOptions = {
  database: DatabaseOperations;
  projectId?: string;
};

export function getSnippetsTools({
  database,
  projectId,
}: SnippetsToolsOptions) {
  const project_id = projectId;

  const snippetsTools = {
    list_sql_snippets: injectableTool({
      description:
        'Lists SQL snippets for the logged in user. Can optionally filter by project.',
      annotations: {
        title: 'List SQL snippets',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z
          .string()
          .optional()
          .describe(
            'Optional project ID to filter snippets. If omitted, returns all snippets for the user.'
          ),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const snippets = await database.listSnippets(project_id);

        return {
          content: [
            {
              type: 'text' as const,
              text: limitResponseSize(
                snippets,
                'SQL snippets',
                {
                  maxTokens: 20000,
                  maxArrayItems: 100,
                  includeWarning: true,
                }
              ),
            },
          ],
        };
      },
    }),

    get_sql_snippet: injectableTool({
      description:
        'Gets a specific SQL snippet by ID. Returns the snippet content and metadata.',
      annotations: {
        title: 'Get SQL snippet',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        snippet_id: z
          .string()
          .describe('The ID of the SQL snippet to retrieve'),
      }),
      execute: async ({ snippet_id }) => {
        const snippet = await database.getSnippet(snippet_id);

        return source`
          SQL Snippet Details:

          Name: ${snippet.name}
          ID: ${snippet.id}
          ${snippet.description ? `Description: ${snippet.description}` : ''}

          Type: ${snippet.type}
          Visibility: ${snippet.visibility}
          Favorite: ${snippet.favorite}

          Project: ${snippet.project.name} (ID: ${snippet.project.id})
          Owner: ${snippet.owner.username} (ID: ${snippet.owner.id})
          Updated by: ${snippet.updated_by.username} (ID: ${snippet.updated_by.id})

          Created: ${snippet.inserted_at}
          Updated: ${snippet.updated_at}

          SQL Content:
          \`\`\`sql
          ${snippet.content.sql}
          \`\`\`

          Schema Version: ${snippet.content.schema_version}
        `;
      },
    }),
  };

  return snippetsTools;
}
