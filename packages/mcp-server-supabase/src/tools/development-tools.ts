import { z } from 'zod';
import type { DevelopmentOperations } from '../platform/types.js';
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
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.getProjectUrl(project_id);
      },
    }),
    get_anon_key: injectableTool({
      description: 'Gets the anonymous API key for a project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.getAnonKey(project_id);
      },
    }),
    generate_typescript_types: injectableTool({
      description: 'Generates TypeScript types for a project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return development.generateTypescriptTypes(project_id);
      },
    }),
  };
}
