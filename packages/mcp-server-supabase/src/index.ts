import packageJson from '../package.json' with { type: 'json' };

export type { ToolCallCallback } from '@supabase/mcp-utils';
export type { SupabasePlatform } from './platform/index.js';
export {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from './server.js';
export {
  featureGroupSchema,
  currentFeatureGroupSchema,
  type FeatureGroup,
} from './types.js';
export {
  clients,
  type Client,
  type ClientInstallation,
  type DeeplinkConfig,
  type CommandConfig,
  type ManualConfig,
  type RegistryConfig,
} from '../docs/clients.js';
export const version = packageJson.version;
