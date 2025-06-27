import { createMcpServer, type Tool } from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import { createContentApiClient } from './content-api/index.js';
import type { SupabasePlatform } from './platform/types.js';
import { getAccountTools } from './tools/account-tools.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getDocsTools } from './tools/docs-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getStorageTools } from './tools/storage-tools.js';
import type { FeatureGroup } from './types.js';
import { parseFeatureGroups } from './util.js';

const { version } = packageJson;

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
   * Options: 'account', 'branching', 'database', 'debugging', 'development', 'docs', 'functions', 'storage'
   */
  features?: string[];
};

const DEFAULT_FEATURES: FeatureGroup[] = [
  'docs',
  'account',
  'database',
  'debugging',
  'development',
  'functions',
  'branching',
];

export const PLATFORM_INDEPENDENT_FEATURES: FeatureGroup[] = ['docs'];

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

  // Filter the default features based on the platform's capabilities
  const availableDefaultFeatures = DEFAULT_FEATURES.filter(
    (key) =>
      PLATFORM_INDEPENDENT_FEATURES.includes(key) ||
      Object.keys(platform).includes(key)
  );

  // Validate the desired features against the platform's available features
  const enabledFeatures = parseFeatureGroups(
    platform,
    features ?? availableDefaultFeatures
  );

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

      const {
        account,
        database,
        functions,
        debugging,
        development,
        storage,
        branching,
      } = platform;

      if (enabledFeatures.has('docs')) {
        Object.assign(tools, getDocsTools({ contentApiClient }));
      }

      if (!projectId && account && enabledFeatures.has('account')) {
        Object.assign(tools, getAccountTools({ account }));
      }

      if (database && enabledFeatures.has('database')) {
        Object.assign(
          tools,
          getDatabaseTools({
            database,
            projectId,
            readOnly,
          })
        );
      }

      if (debugging && enabledFeatures.has('debugging')) {
        Object.assign(tools, getDebuggingTools({ debugging, projectId }));
      }

      if (development && enabledFeatures.has('development')) {
        Object.assign(tools, getDevelopmentTools({ development, projectId }));
      }

      if (functions && enabledFeatures.has('functions')) {
        Object.assign(tools, getEdgeFunctionTools({ functions, projectId }));
      }

      if (branching && enabledFeatures.has('branching')) {
        Object.assign(tools, getBranchingTools({ branching, projectId }));
      }

      if (storage && enabledFeatures.has('storage')) {
        Object.assign(tools, getStorageTools({ storage, projectId }));
      }

      return tools;
    },
  });

  return server;
}
