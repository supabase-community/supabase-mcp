import { z } from 'zod';
import type { SupabasePlatform } from '../platform/types.js';
import { injectableTool } from './util.js';

export type StorageToolsOptions = {
  platform: SupabasePlatform;
  projectRef?: string;
};

export function getStorageTools({ platform, projectRef }: StorageToolsOptions) {
  const project_ref = projectRef;

  return {
    list_storage_buckets: injectableTool({
      description: 'Lists all storage buckets in a Supabase project.',
      parameters: z.object({
        project_ref: z.string(),
      }),
      inject: { project_ref },
      execute: async ({ project_ref }) => {
        return await platform.listAllBuckets(project_ref);
      },
    }),
    get_storage_config: injectableTool({
      description: 'Get the storage config for a Supabase project.',
      parameters: z.object({
        project_ref: z.string(),
      }),
      inject: { project_ref },
      execute: async ({ project_ref }) => {
        return await platform.getStorageConfig(project_ref);
      },
    }),
    update_storage_config: injectableTool({
      description: 'Update the storage config for a Supabase project.',
      parameters: z.object({
        project_ref: z.string(),
        config: z.object({
          fileSizeLimit: z.number(),
          features: z.object({
            imageTransformation: z.object({ enabled: z.boolean() }),
            s3Protocol: z.object({ enabled: z.boolean() }),
          }),
        }),
      }),
      inject: { project_ref },
      execute: async ({ project_ref, config }) => {
        await platform.updateStorageConfig(project_ref, config);
        return { success: true };
      },
    }),
  };
}
