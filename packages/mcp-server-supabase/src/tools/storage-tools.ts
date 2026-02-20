import { z } from 'zod/v4';
import type { StorageOperations } from '../platform/types.js';
import { storageBucketSchema, storageConfigSchema } from '../platform/types.js';
import { injectableTool } from './util.js';

export type ListStorageBucketsInput = z.infer<
  typeof listStorageBucketsInputSchema
>;
export type ListStorageBucketsOutput = z.infer<
  typeof listStorageBucketsOutputSchema
>;
export type GetStorageConfigInput = z.infer<typeof getStorageConfigInputSchema>;
export type GetStorageConfigOutput = z.infer<
  typeof getStorageConfigOutputSchema
>;
export type UpdateStorageConfigInput = z.infer<
  typeof updateStorageConfigInputSchema
>;
export type UpdateStorageConfigOutput = z.infer<
  typeof updateStorageConfigOutputSchema
>;
export type StorageToolsOptions = {
  storage: StorageOperations;
  projectId?: string;
  readOnly?: boolean;
};

export const listStorageBucketsInputSchema = z.object({
  project_id: z.string(),
});

export const listStorageBucketsOutputSchema = z.object({
  buckets: z.array(storageBucketSchema),
});

export const getStorageConfigInputSchema = z.object({
  project_id: z.string(),
});

export const getStorageConfigOutputSchema = storageConfigSchema;

export const updateStorageConfigInputSchema = z.object({
  project_id: z.string(),
  config: z.object({
    fileSizeLimit: z.number(),
    features: z.object({
      imageTransformation: z.object({ enabled: z.boolean() }),
      s3Protocol: z.object({ enabled: z.boolean() }),
    }),
  }),
});

export const updateStorageConfigOutputSchema = z.object({
  success: z.boolean(),
});

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
      parameters: listStorageBucketsInputSchema,
      inject: { project_id },
      outputSchema: listStorageBucketsOutputSchema,
      execute: async ({ project_id }) => {
        return { buckets: await storage.listAllBuckets(project_id) };
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
      parameters: getStorageConfigInputSchema,
      inject: { project_id },
      outputSchema: getStorageConfigOutputSchema,
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
      parameters: updateStorageConfigInputSchema,
      inject: { project_id },
      outputSchema: updateStorageConfigOutputSchema,
      execute: async ({ project_id, config }) => {
        if (readOnly) {
          throw new Error('Cannot update storage config in read-only mode.');
        }

        await storage.updateStorageConfig(project_id, config);
        return { success: true };
      },
    }),
  };
}
