import { createMcpServer, type Tool } from '@supabase/mcp-utils';
import { z } from 'zod';
import packageJson from '../package.json' with { type: 'json' };
import { createContentApiClient } from './content-api/index.js';
import type { SupabasePlatform } from './platform/types.js';
import { getAccountTools } from './tools/account-tools.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseOperationTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getDocsTools } from './tools/docs-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getStorageTools } from './tools/storage-tools.js';

const { version } = packageJson;

export type SupabasePlatformOptions = {
  /**
   * The access token for the Supabase Management API.
   */
  accessToken: string;

  /**
   * The API URL for the Supabase Management API.
   */
  apiUrl?: string;
};

export type SupabaseMcpServerOptions = {
  /**
   * Platform implementation for Supabase.
   */
  platform: SupabasePlatform;

  /**
   * The API URL for the Supabase Content API.
   */
  contentApiUrl?: string;

  /**
   * The project ID to scope the server to.
   *
   * If undefined, the server will have access
   * to all organizations and projects for the user.
   */
  projectId?: string;

  /**
   * Executes database queries in read-only mode if true.
   */
  readOnly?: boolean;

  /**
   * Features to enable.
   * Options: 'account', 'branching', 'database', 'debug', 'development', 'docs', 'functions', 'storage'
   */
  features?: string[];
};

const featureGroupSchema = z.enum([
  'docs',
  'account',
  'database',
  'debug',
  'development',
  'functions',
  'branching',
  'storage',
]);

export type FeatureGroup = z.infer<typeof featureGroupSchema>;

const DEFAULT_FEATURES: FeatureGroup[] = [
  'docs',
  'account',
  'database',
  'debug',
  'development',
  'functions',
  'branching',
];

/**
 * Creates an MCP server for interacting with Supabase.
 */
export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const {
    platform,
    projectId,
    readOnly,
    features,
    contentApiUrl = 'https://supabase.com/docs/api/graphql',
  } = options;

  const contentApiClientPromise = createContentApiClient(contentApiUrl);

  const enabledFeatures = z
    .set(featureGroupSchema)
    .parse(new Set(features ?? DEFAULT_FEATURES));

  const server = createMcpServer({
    name: 'supabase',
    version,
    async onInitialize(info) {
      // Note: in stateless HTTP mode, `onInitialize` will not always be called
      // so we cannot rely on it for initialization. It's still useful for telemetry.
      await platform.init?.(info);
    },
    tools: async () => {
      const contentApiClient = await contentApiClientPromise;
      const tools: Record<string, Tool> = {};

      // Add feature-based tools
      if (!projectId && enabledFeatures.has('account')) {
        Object.assign(tools, getAccountTools({ platform }));
      }

      if (enabledFeatures.has('branching')) {
        Object.assign(tools, getBranchingTools({ platform, projectId }));
      }

      if (enabledFeatures.has('database')) {
        Object.assign(
          tools,
          getDatabaseOperationTools({ platform, projectId, readOnly })
        );
      }

      if (enabledFeatures.has('debug')) {
        Object.assign(tools, getDebuggingTools({ platform, projectId }));
      }

      if (enabledFeatures.has('development')) {
        Object.assign(tools, getDevelopmentTools({ platform, projectId }));
      }

      if (enabledFeatures.has('docs')) {
        Object.assign(tools, getDocsTools({ contentApiClient }));
      }

      if (enabledFeatures.has('functions')) {
        Object.assign(tools, getEdgeFunctionTools({ platform, projectId }));
      }

      if (enabledFeatures.has('storage')) {
        Object.assign(tools, getStorageTools({ platform, projectId }));
      }

      return tools;
    },
  });

  return server;
}
