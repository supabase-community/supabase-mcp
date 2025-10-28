import { z } from 'zod';
import type { StorageOperations } from '../platform/types.js';
import { injectableTool } from './util.js';

const SUCCESS_RESPONSE = { success: true };

export type StorageToolsOptions = {
  storage: StorageOperations;
  projectId?: string;
  readOnly?: boolean;
};

export function getStorageTools({
  storage,
  projectId,
  readOnly,
}: StorageToolsOptions) {
  const project_id = projectId;

  return {
    list_storage_buckets: injectableTool({
      description: 'Lists all storage buckets in a Supabase project.',
      annotations: {
        title: 'List storage buckets',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        title: 'Get storage config',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
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
      annotations: {
        title: 'Update storage config',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
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
        if (readOnly) {
          throw new Error('Cannot update storage config in read-only mode.');
        }

        await storage.updateStorageConfig(project_id, config);
        return SUCCESS_RESPONSE;
      },
    }),
  };
}
