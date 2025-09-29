import { z } from 'zod';
import type { SecretsOperations } from '../platform/types.js';
import { injectableTool } from './util.js';

export type SecretsToolsOptions = {
  secrets: SecretsOperations;
  projectId?: string;
  readOnly?: boolean;
};

export function getSecretsTools({
  secrets,
  projectId,
  readOnly,
}: SecretsToolsOptions) {
  const project_id = projectId;

  return {
    list_api_keys: injectableTool({
      description:
        'Lists all API keys for a project. Use the reveal parameter to show the actual key values.',
      annotations: {
        title: 'List API keys',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        reveal: z
          .boolean()
          .optional()
          .describe('Whether to reveal the actual API key values'),
      }),
      inject: { project_id },
      execute: async ({ project_id, reveal }) => {
        return await secrets.listApiKeys(project_id, reveal);
      },
    }),
    get_api_key: injectableTool({
      description:
        'Gets details for a specific API key. Use the reveal parameter to show the actual key value.',
      annotations: {
        title: 'Get API key',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        key_id: z.string().describe('The ID of the API key to retrieve'),
        reveal: z
          .boolean()
          .optional()
          .describe('Whether to reveal the actual API key value'),
      }),
      inject: { project_id },
      execute: async ({ project_id, key_id, reveal }) => {
        return await secrets.getApiKey(project_id, key_id, reveal);
      },
    }),
    create_api_key: injectableTool({
      description:
        'Creates a new API key for the project. The key name must be unique within the project and follow the naming pattern.',
      annotations: {
        title: 'Create API key',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        type: z
          .enum(['publishable', 'secret'])
          .describe('The type of API key to create'),
        name: z
          .string()
          .min(4)
          .max(64)
          .regex(/^[a-z_][a-z0-9_]+$/)
          .describe(
            'Name for the API key (4-64 chars, lowercase, starts with letter/underscore)'
          ),
        description: z
          .string()
          .optional()
          .describe('Optional description for the API key'),
        reveal: z
          .boolean()
          .optional()
          .describe('Whether to reveal the actual API key value in response'),
      }),
      inject: { project_id },
      execute: async ({ project_id, type, name, description, reveal }) => {
        if (readOnly) {
          throw new Error('Cannot create API key in read-only mode.');
        }

        return await secrets.createApiKey(
          project_id,
          {
            type,
            name,
            description: description || null,
          },
          reveal
        );
      },
    }),
    update_api_key: injectableTool({
      description:
        'Updates an existing API key. You can change the name, description, or JWT template.',
      annotations: {
        title: 'Update API key',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        key_id: z.string().describe('The ID of the API key to update'),
        name: z
          .string()
          .min(4)
          .max(64)
          .regex(/^[a-z_][a-z0-9_]+$/)
          .optional()
          .describe('New name for the API key'),
        description: z
          .string()
          .optional()
          .describe('New description for the API key'),
        reveal: z
          .boolean()
          .optional()
          .describe('Whether to reveal the actual API key value in response'),
      }),
      inject: { project_id },
      execute: async ({ project_id, key_id, name, description, reveal }) => {
        if (readOnly) {
          throw new Error('Cannot update API key in read-only mode.');
        }

        const updates: any = {};
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;

        return await secrets.updateApiKey(project_id, key_id, updates, reveal);
      },
    }),
    delete_api_key: injectableTool({
      description:
        'Deletes an API key from the project. This action cannot be undone.',
      annotations: {
        title: 'Delete API key',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
        key_id: z.string().describe('The ID of the API key to delete'),
        was_compromised: z
          .boolean()
          .optional()
          .describe('Whether the key was compromised (for audit purposes)'),
        reason: z
          .string()
          .optional()
          .describe('Reason for deletion (for audit purposes)'),
      }),
      inject: { project_id },
      execute: async ({ project_id, key_id, was_compromised, reason }) => {
        if (readOnly) {
          throw new Error('Cannot delete API key in read-only mode.');
        }

        const options: any = {};
        if (was_compromised !== undefined)
          options.was_compromised = was_compromised;
        if (reason !== undefined) options.reason = reason;

        return await secrets.deleteApiKey(project_id, key_id, options);
      },
    }),
    list_legacy_api_keys: injectableTool({
      description: 'Lists legacy API keys for backward compatibility.',
      annotations: {
        title: 'List legacy API keys',
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
        return (await secrets.listLegacyApiKeys?.(project_id)) ?? [];
      },
    }),
    rotate_anon_key: injectableTool({
      description:
        'Rotates the anonymous (anon) API key for a project. This will invalidate the current key.',
      annotations: {
        title: 'Rotate anon key',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot rotate anon key in read-only mode.');
        }

        const result = await secrets.rotateAnonKey?.(project_id);
        return result ?? { message: 'Anon key rotated successfully' };
      },
    }),
    rotate_service_role_key: injectableTool({
      description:
        'Rotates the service role API key for a project. This will invalidate the current key.',
      annotations: {
        title: 'Rotate service role key',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        if (readOnly) {
          throw new Error('Cannot rotate service role key in read-only mode.');
        }

        const result = await secrets.rotateServiceRoleKey?.(project_id);
        return result ?? { message: 'Service role key rotated successfully' };
      },
    }),
    set_jwt_template: injectableTool({
      description:
        'Sets a custom JWT template for API keys to include additional claims.',
      annotations: {
        title: 'Set JWT template',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      parameters: z.object({
        project_id: z.string(),
        key_id: z.string().describe('The ID of the API key'),
        template: z
          .object({
            claims: z
              .record(z.any())
              .describe('Custom claims to include in JWT'),
            expires_in: z
              .number()
              .optional()
              .describe('Token expiry in seconds'),
          })
          .describe('JWT template configuration'),
      }),
      inject: { project_id },
      execute: async ({ project_id, key_id, template }) => {
        if (readOnly) {
          throw new Error('Cannot set JWT template in read-only mode.');
        }

        const result = await secrets.setJwtTemplate?.(
          project_id,
          key_id,
          template
        );
        return result ?? { message: 'JWT template set successfully' };
      },
    }),
    get_project_claim_token: injectableTool({
      description:
        'Gets a claim token for project ownership transfer or verification.',
      annotations: {
        title: 'Get project claim token',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
      parameters: z.object({
        project_id: z.string(),
      }),
      inject: { project_id },
      execute: async ({ project_id }) => {
        const token = await secrets.getProjectClaimToken?.(project_id);
        return token ?? { message: 'Claim token functionality not available' };
      },
    }),
  };
}
