import { z } from 'zod/v4';
import type { DevelopmentOperations } from '../platform/types.js';
import { generateTypescriptTypesResultSchema } from '../platform/types.js';
import { injectableTool } from './util.js';

export const getProjectUrlInputSchema = z.object({
  project_id: z.string(),
});

export const getProjectUrlOutputSchema = z.object({
  url: z.string(),
});

export type GetProjectUrlInput = z.infer<typeof getProjectUrlInputSchema>;
export type GetProjectUrlOutput = z.infer<typeof getProjectUrlOutputSchema>;

export const getPublishableKeysInputSchema = z.object({
  project_id: z.string(),
});

export const getPublishableKeysOutputSchema = z.object({
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
});

export type GetPublishableKeysInput = z.infer<typeof getPublishableKeysInputSchema>;
export type GetPublishableKeysOutput = z.infer<typeof getPublishableKeysOutputSchema>;

export const generateTypescriptTypesInputSchema = z.object({
  project_id: z.string(),
});

export const generateTypescriptTypesOutputSchema = generateTypescriptTypesResultSchema;

export type GenerateTypescriptTypesInput = z.infer<typeof generateTypescriptTypesInputSchema>;
export type GenerateTypescriptTypesOutput = z.infer<typeof generateTypescriptTypesOutputSchema>;

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
      parameters: getProjectUrlInputSchema,
      inject: { project_id },
      outputSchema: getProjectUrlOutputSchema,
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
      parameters: getPublishableKeysInputSchema,
      inject: { project_id },
      outputSchema: getPublishableKeysOutputSchema,
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
      parameters: generateTypescriptTypesInputSchema,
      inject: { project_id },
      outputSchema: generateTypescriptTypesOutputSchema,
      execute: async ({ project_id }) => {
        return development.generateTypescriptTypes(project_id);
      },
    }),
  };
}
