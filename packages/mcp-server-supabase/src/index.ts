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
export const version = packageJson.version;
