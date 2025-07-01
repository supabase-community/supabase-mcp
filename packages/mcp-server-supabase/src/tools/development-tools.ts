import { z } from 'zod';
import type { SupabasePlatform } from '../platform/types.js';
import { injectableTool } from './util.js';

export type DevelopmentToolsOptions = {
  platform: SupabasePlatform;
  projectRef?: string;
};

export function getDevelopmentTools({
  platform,
  projectRef,
}: DevelopmentToolsOptions) {
  const project_ref = projectRef;

  return {
    get_project_url: injectableTool({
      description: 'Gets the API URL for a project.',
      parameters: z.object({
        project_ref: z.string(),
      }),
      inject: { project_ref },
      execute: async ({ project_ref }) => {
        return platform.getProjectUrl(project_ref);
      },
    }),
    get_anon_key: injectableTool({
      description: 'Gets the anonymous API key for a project.',
      parameters: z.object({
        project_ref: z.string(),
      }),
      inject: { project_ref },
      execute: async ({ project_ref }) => {
        return platform.getAnonKey(project_ref);
      },
    }),
    generate_typescript_types: injectableTool({
      description: 'Generates TypeScript types for a project.',
      parameters: z.object({
        project_ref: z.string(),
      }),
      inject: { project_ref },
      execute: async ({ project_ref }) => {
        return platform.generateTypescriptTypes(project_ref);
      },
    }),
  };
}
