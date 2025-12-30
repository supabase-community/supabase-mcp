import { z } from 'zod/v4';
import type { DevelopmentOperations } from '../platform/types.js';
import { generateTypescriptTypesResultSchema } from '../platform/types.js';
import { injectableTool } from './util.js';

export type DevelopmentToolsOptions = {
  development: DevelopmentOperations;
  projectId?: string;
};

export function getDevelopmentTools({
  development,
  projectId,
}: DevelopmentToolsOptions) {
  const project_id = projectId;

  return {
    get_project_url: injectableTool({
      description: 'Gets the API URL for a project.',
      annotations: {
        title: 'Get project URL',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      outputSchema: z.object({
        url: z.string(),
      }),
      execute: async ({ project_id }) => {
        return { url: await development.getProjectUrl(project_id) };
      },
    }),
    get_publishable_keys: injectableTool({
      description:
        'Gets all publishable API keys for a project, including legacy anon keys (JWT-based) and modern publishable keys (format: sb_publishable_...). Publishable keys are recommended for new applications due to better security and independent rotation. Legacy anon keys are included for compatibility, as many LLMs are pretrained on them. Disabled keys are indicated by the "disabled" field; only use keys where disabled is false or undefined.',
      annotations: {
        title: 'Get publishable keys',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      outputSchema: z.object({
        keys: z.array(
          z.object({
            api_key: z.string(),
            name: z.string(),
            type: z.enum(['legacy', 'publishable']),
            description: z.string().optional(),
            id: z.string().optional(),
            disabled: z.boolean().optional(),
          })
        ),
      }),
      execute: async ({ project_id }) => {
        return { keys: await development.getPublishableKeys(project_id) };
      },
    }),
    generate_typescript_types: injectableTool({
      description: 'Generates TypeScript types for a project.',
      annotations: {
        title: 'Generate TypeScript types',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      outputSchema: generateTypescriptTypesResultSchema,
      execute: async ({ project_id }) => {
        return development.generateTypescriptTypes(project_id);
      },
    }),
  };
}
