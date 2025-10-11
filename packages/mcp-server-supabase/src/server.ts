import {
  createMcpServer,
  type Tool,
  type ToolCallCallback,
} from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import { createContentApiClient } from './content-api/index.js';
import type { SupabasePlatform } from './platform/types.js';
import { getAccountTools } from './tools/account-tools.js';
import { getAnalyticsTools } from './tools/analytics-tools.js';
import { getAuthConfigTools } from './tools/auth-config-tools.js';
import { getBillingTools } from './tools/billing-tools.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getDocsTools } from './tools/docs-tools.js';
import { getDomainTools } from './tools/domain-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getNetworkSecurityTools } from './tools/network-security-tools.js';
import { getProjectManagementTools } from './tools/project-management-tools.js';
import { getRuntimeTools } from './tools/runtime-tools.js';
import { getSecretsTools } from './tools/secrets-tools.js';
import { getSnippetsTools } from './tools/snippets-tools.js';
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
   * Options: 'account', 'analytics', 'auth', 'billing', 'branching', 'database',
   * 'debugging', 'development', 'docs', 'domains', 'functions', 'network',
   * 'project', 'runtime', 'secrets', 'storage'
   */
  features?: string[];

  /**
   * Callback for after a supabase tool is called.
   */
  onToolCall?: ToolCallCallback;
};

const DEFAULT_FEATURES: FeatureGroup[] = [
  'docs',
  'account',
  'analytics',
  'auth',
  'billing',
  'database',
  'debugging',
  'development',
  'domains',
  'functions',
  'network',
  'project',
  'secrets',
  'branching',
  'runtime',
];

export const PLATFORM_INDEPENDENT_FEATURES: FeatureGroup[] = [
  'docs',
  'runtime',
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
    onToolCall,
  } = options;

  const contentApiClientPromise = createContentApiClient(contentApiUrl, {
    'User-Agent': `supabase-mcp/${version}`,
  });

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
    title: 'Supabase',
    version,
    async onInitialize(info) {
      // Note: in stateless HTTP mode, `onInitialize` will not always be called
      // so we cannot rely on it for initialization. It's still useful for telemetry.
      const { clientInfo } = info;
      const userAgent = `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`;

      await Promise.all([
        platform.init?.(info),
        contentApiClientPromise.then((client) =>
          client.setUserAgent(userAgent)
        ),
      ]);
    },
    onToolCall,
    tools: async () => {
      const contentApiClient = await contentApiClientPromise;
      const tools: Record<string, Tool> = {};

      const {
        account,
        analytics,
        authConfig,
        backup,
        billing,
        branching,
        customDomain,
        database,
        databaseConfig,
        debugging,
        development,
        functions,
        networkSecurity,
        projectManagement,
        secrets,
        storage,
      } = platform;

      if (enabledFeatures.has('docs')) {
        Object.assign(tools, getDocsTools({ contentApiClient }));
      }

      if (!projectId && account && enabledFeatures.has('account')) {
        Object.assign(tools, getAccountTools({ account, readOnly }));
      }

      if (analytics && enabledFeatures.has('analytics')) {
        Object.assign(tools, getAnalyticsTools({ analytics, projectId }));
      }

      if (authConfig && enabledFeatures.has('auth')) {
        Object.assign(tools, getAuthConfigTools({ authConfig, projectId }));
      }

      if (billing && enabledFeatures.has('billing')) {
        Object.assign(tools, getBillingTools({ billing, projectId }));
      }

      if (database && enabledFeatures.has('database')) {
        Object.assign(
          tools,
          getDatabaseTools({
            database,
            backup,
            databaseConfig,
            projectId,
            readOnly,
          })
        );
        Object.assign(
          tools,
          getSnippetsTools({
            database,
            projectId,
          })
        );
      }

      if (debugging && enabledFeatures.has('debugging')) {
        Object.assign(tools, getDebuggingTools({ debugging, projectId }));
      }

      if (development && enabledFeatures.has('development')) {
        Object.assign(tools, getDevelopmentTools({ development, projectId }));
      }

      if (customDomain && enabledFeatures.has('domains')) {
        Object.assign(tools, getDomainTools({ customDomain, projectId }));
      }

      if (functions && enabledFeatures.has('functions')) {
        Object.assign(
          tools,
          getEdgeFunctionTools({ functions, projectId, readOnly })
        );
      }

      if (networkSecurity && enabledFeatures.has('network')) {
        Object.assign(
          tools,
          getNetworkSecurityTools({ networkSecurity, projectId })
        );
      }

      if (projectManagement && enabledFeatures.has('project')) {
        Object.assign(
          tools,
          getProjectManagementTools({ projectManagement, projectId })
        );
      }

      if (secrets && enabledFeatures.has('secrets')) {
        Object.assign(tools, getSecretsTools({ secrets, projectId, readOnly }));
      }

      if (branching && enabledFeatures.has('branching')) {
        Object.assign(
          tools,
          getBranchingTools({ branching, projectId, readOnly })
        );
      }

      if (storage && enabledFeatures.has('storage')) {
        Object.assign(tools, getStorageTools({ storage, projectId, readOnly }));
      }

      if (enabledFeatures.has('runtime')) {
        const runtimeTools = getRuntimeTools();

        // Always include mode management tools
        const modeTools = {
          toggle_read_only_mode: runtimeTools.toggle_read_only_mode,
          get_runtime_mode_status: runtimeTools.get_runtime_mode_status,
          set_read_only_mode: runtimeTools.set_read_only_mode,
          validate_mode_change: runtimeTools.validate_mode_change,
        };
        Object.assign(tools, modeTools);

        // Only include project tools when account operations are available and not project-scoped
        if (!projectId && account) {
          const projectTools = {
            switch_project: runtimeTools.switch_project,
            get_current_project: runtimeTools.get_current_project,
            list_projects: runtimeTools.list_projects,
          };
          Object.assign(tools, projectTools);
        }
      }

      return tools;
    },
  });

  return server;
}
