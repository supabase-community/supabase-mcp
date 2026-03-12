import { z } from 'zod/v4';
import type { StorageOperations } from '../platform/types.js';
import { storageBucketSchema, storageConfigSchema } from '../platform/types.js';
import { injectableTool, type ToolDefs } from './util.js';

type StorageToolsOptions = {
  storage: StorageOperations;
  projectId?: string;
  readOnly?: boolean;
};

const listStorageBucketsInputSchema = z.object({
  project_id: z.string(),
});

const listStorageBucketsOutputSchema = z.object({
  buckets: z.array(storageBucketSchema),
});

const getStorageConfigInputSchema = z.object({
  project_id: z.string(),
});

const getStorageConfigOutputSchema = storageConfigSchema;

const updateStorageConfigInputSchema = z.object({
  project_id: z.string(),
  config: z.object({
    fileSizeLimit: z.number(),
    features: z.object({
      imageTransformation: z.object({ enabled: z.boolean() }),
      s3Protocol: z.object({ enabled: z.boolean() }),
    }),
  }),
});

const updateStorageConfigOutputSchema = z.object({
  success: z.boolean(),
});

export const storageToolDefs = {
  list_storage_buckets: {
    description: 'List all storage buckets in a Supabase project. Use when the user wants to view, audit, or manage existing storage containers and their configurations. Accepts `project_ref` (required) to specify which Supabase project to query. e.g., project_ref="abcd1234efgh5678". Do not use when you need to create a new bucket or manage bucket contents (use appropriate bucket management tools instead). Raises an error if the project reference is invalid or the user lacks storage access permissions.',
    parameters: listStorageBucketsInputSchema,
    outputSchema: listStorageBucketsOutputSchema,
    annotations: {
      title: 'List storage buckets',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  get_storage_config: {
    description: 'Retrieve the storage configuration settings for a Supabase project. Use when the user wants to view current storage limits, file size restrictions, or bucket policies. Do not use when you need general project details (use get_project instead). Accepts `project_id` (required string), e.g., "abc123def456". Returns configuration including max file size, allowed MIME types, and storage quotas. Raises an error if the project does not exist or you lack storage access permissions.',
    parameters: getStorageConfigInputSchema,
    outputSchema: getStorageConfigOutputSchema,
    annotations: {
      title: 'Get storage config',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  update_storage_config: {
    description: 'Update the storage configuration settings for a Supabase project. Use when the user wants to modify storage limits, file size restrictions, or bucket policies for their project. Accepts `project_ref` (required) and configuration parameters such as `file_size_limit`, `storage_limit`, and `allowed_mime_types`. Do not use when you need to create or manage individual storage buckets (use bucket management tools instead). e.g., updating file_size_limit to "50MB" or storage_limit to "10GB". Raises an error if the project is paused or if the specified limits exceed the subscription plan allowances.',
    parameters: updateStorageConfigInputSchema,
    outputSchema: updateStorageConfigOutputSchema,
    annotations: {
      title: 'Update storage config',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
} as const satisfies ToolDefs;

export function getStorageTools({
  storage,
  projectId,
  readOnly,
}: StorageToolsOptions) {
  const project_id = projectId;

  return {
    list_storage_buckets: injectableTool({
      ...storageToolDefs.list_storage_buckets,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return { buckets: await storage.listAllBuckets(project_id) };
      },
    }),
    get_storage_config: injectableTool({
      ...storageToolDefs.get_storage_config,
      inject: { project_id },
      execute: async ({ project_id }) => {
        return await storage.getStorageConfig(project_id);
      },
    }),
    update_storage_config: injectableTool({
      ...storageToolDefs.update_storage_config,
      inject: { project_id },
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
