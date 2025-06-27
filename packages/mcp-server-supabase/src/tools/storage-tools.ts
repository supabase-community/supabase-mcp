import { z } from 'zod';
import type { StorageOperations } from '../platform/types.js';
import { injectableTool } from './util.js';

export type StorageToolsOptions = {
  storage: StorageOperations;
  projectId?: string;
};

export function getStorageTools({ storage, projectId }: StorageToolsOptions) {
  const project_id = projectId;

  return {
    list_storage_buckets: injectableTool({
      description: 'Lists all storage buckets in a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return await storage.listAllBuckets(project_id);
      },
    }),
    get_storage_config: injectableTool({
      description: 'Get the storage config for a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        return await storage.getStorageConfig(project_id);
      },
    }),
    update_storage_config: injectableTool({
      description: 'Update the storage config for a Supabase project.',
      parameters: z.object({
        project_id: z.string(),
        config: z.object({
          fileSizeLimit: z.number(),
          features: z.object({
            imageTransformation: z.object({ enabled: z.boolean() }),
            s3Protocol: z.object({ enabled: z.boolean() }),
          }),
        }),
      }),
      inject: { project_id },
      execute: async ({ project_id, config }) => {
        await storage.updateStorageConfig(project_id, config);
        return { success: true };
      },
    }),
  };
}
