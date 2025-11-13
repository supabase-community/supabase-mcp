/**
 * Zod schema definitions for MCP client documentation system
 */

import { z } from 'zod';

// Zod schemas
export const DeeplinkConfigSchema = z.object({
  url: z.string().url('Invalid deeplink URL'),
  buttonImage: z.string().url('Invalid button image URL'),
  buttonAlt: z.string().min(1, 'Button alt text is required'),
});

export const CommandConfigSchema = z.object({
  command: z.string().min(1, 'Command is required'),
  description: z.string().optional(),
});

export const ManualConfigSchema = z.object({
  configFilePath: z.string().min(1, 'Config file path is required'),
  configFormat: z.enum(['mcpServers', 'servers', 'custom']),
  instructions: z.string().optional(),
});

export const RegistryConfigSchema = z.object({
  listed: z.boolean(),
  listingUrl: z.string().url('Invalid listing URL').optional(),
});

export const ClientInstallationSchema = z.object({
  deeplink: z
    .union([DeeplinkConfigSchema, z.array(DeeplinkConfigSchema)])
    .optional(),
  command: CommandConfigSchema.optional(),
  manual: ManualConfigSchema,
});

export const ClientSchema = z.object({
  id: z
    .string()
    .min(1, 'Client ID is required')
    .regex(
      /^[a-z0-9-]+$/,
      'Client ID must be lowercase alphanumeric with hyphens'
    ),
  name: z.string().min(1, 'Client name is required'),
  description: z.string().optional(),
  officialDocs: z.string().url('Invalid official docs URL').optional(),
  installation: ClientInstallationSchema,
  registry: RegistryConfigSchema.optional(),
});

export const ClientsDataSchema = z.object({
  clients: z.array(ClientSchema),
});

// TypeScript types inferred from Zod schemas
export type DeeplinkConfig = z.infer<typeof DeeplinkConfigSchema>;
export type CommandConfig = z.infer<typeof CommandConfigSchema>;
export type ManualConfig = z.infer<typeof ManualConfigSchema>;
export type RegistryConfig = z.infer<typeof RegistryConfigSchema>;
export type ClientInstallation = z.infer<typeof ClientInstallationSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type ClientsData = z.infer<typeof ClientsDataSchema>;

/**
 * Validates that a client object has all required fields using Zod
 */
export function validateClient(client: unknown): client is Client {
  try {
    ClientSchema.parse(client);
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Client validation error:');
      for (const issue of error.issues) {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      }
    }
    return false;
  }
}

/**
 * Validates the entire clients.json data structure using Zod
 */
export function validateClientsData(data: unknown): data is ClientsData {
  try {
    ClientsDataSchema.parse(data);
    return true;
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error('Clients data validation error:');
      for (const issue of error.issues) {
        console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
      }
    }
    return false;
  }
}

/**
 * Parses and validates clients data, throwing an error if invalid
 */
export function parseClientsData(data: unknown): ClientsData {
  return ClientsDataSchema.parse(data);
}

/**
 * Parses and validates a single client, throwing an error if invalid
 */
export function parseClient(data: unknown): Client {
  return ClientSchema.parse(data);
}
