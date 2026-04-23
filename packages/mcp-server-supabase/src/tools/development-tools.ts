import { z } from 'zod/v4';
import type { DevelopmentOperations } from '../platform/types.js';
import { generateTypescriptTypesResultSchema } from '../platform/types.js';
import { injectableTool, type ToolDefs } from './util.js';

type DevelopmentToolsOptions = {
  development: DevelopmentOperations;
  projectId?: string;
};

const getProjectUrlInputSchema = z.object({
  project_id: z.string(),
});

const getProjectUrlOutputSchema = z.object({
  url: z.string(),
});

const getPublishableKeysInputSchema = z.object({
  project_id: z.string(),
});

const getPublishableKeysOutputSchema = z.object({
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

const generateTypescriptTypesInputSchema = z.object({
  project_id: z.string(),
});

const generateTypescriptTypesOutputSchema = generateTypescriptTypesResultSchema;

export const developmentToolDefs = {
  get_project_url: {
    description: 'Retrieve the API URL for a Supabase project to enable programmatic access. Use when the user wants to connect their application or configure API endpoints for database operations. Do not use when you need general project information like region or plan details (use get_project instead). Accepts `project_ref` (required), e.g., "abcdefghijklmnop". Returns the full API URL such as "https://abcdefghijklmnop.supabase.co". Raises an error if the project reference is invalid or the user lacks access permissions.',
    parameters: getProjectUrlInputSchema,
    outputSchema: getProjectUrlOutputSchema,
    annotations: {
      title: 'Get project URL',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_publishable_keys: {
    description:
      'Retrieve all publishable API keys for a Supabase project, including legacy anon keys and modern publishable keys. Use when the user wants to access API credentials for connecting applications or troubleshooting authentication issues. Do not use when you need general project information (use get_project instead). Accepts `project_id` (required). Returns both JWT-based anon keys and sb_publishable_ format keys, e.g., "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." or "sb_publishable_abc123...". Only use keys where disabled is false or undefined. Raises an error if the project does not exist or access is denied.',
    parameters: getPublishableKeysInputSchema,
    outputSchema: getPublishableKeysOutputSchema,
    annotations: {
      title: 'Get publishable keys',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  generate_typescript_types: {
    description: 'Generate TypeScript type definitions for a project's codebase or configuration files. Use when the user wants to create type-safe interfaces, convert JavaScript to TypeScript, or generate types from existing schemas. Accepts `project_path` (required directory or file path) and `output_format` (optional: "interface" or "type"). e.g., project_path="./src" or output_format="interface". Do not use when you need to list available projects first (use list_projects instead). Raises an error if the specified path does not exist or contains invalid syntax.',
    parameters: generateTypescriptTypesInputSchema,
    outputSchema: generateTypescriptTypesOutputSchema,
    annotations: {
      title: 'Generate TypeScript types',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getDevelopmentTools({
  development,
  projectId,
}: DevelopmentToolsOptions) {
  const project_id = projectId;

  return {
    get_project_url: injectableTool({
      ...developmentToolDefs.get_project_url,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { url: await development.getProjectUrl(project_id) };
      },
    }),
    get_publishable_keys: injectableTool({
      ...developmentToolDefs.get_publishable_keys,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { keys: await development.getPublishableKeys(project_id) };
      },
    }),
    generate_typescript_types: injectableTool({
      ...developmentToolDefs.generate_typescript_types,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.generateTypescriptTypes(project_id);
      },
    }),
  };
}
