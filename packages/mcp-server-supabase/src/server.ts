import { createMcpServer } from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import {
  createManagementApiClient,
  type ManagementApiClient,
} from './management-api/index.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseOperationTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getProjectManagementTools } from './tools/project-management-tools.js';

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
   * Platform options for Supabase.
   */
  platform: SupabasePlatformOptions;

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
};

/**
 * Creates an MCP server for interacting with Supabase.
 */
export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const managementApiUrl =
    options.platform.apiUrl ?? 'https://api.supabase.com';
  const projectId = options.projectId;
  const readOnly = options.readOnly;

  let managementApiClient: ManagementApiClient;

  const server = createMcpServer({
    name: 'supabase',
    version,
    onInitialize({ clientInfo }) {
      managementApiClient = createManagementApiClient(
        managementApiUrl,
        options.platform.accessToken,
        {
          'User-Agent': `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`,
        }
      );
    },
    tools: () => {
      // Note: tools are intentionally snake_case to align better with most MCP clients
      const tools = {
        ...getDatabaseOperationTools({
          managementApiClient,
          projectId,
          readOnly,
        }),
        ...getEdgeFunctionTools({
          managementApiClient,
          projectId,
        }),
        ...getDebuggingTools({
          managementApiClient,
          projectId,
        }),
        ...getDevelopmentTools({
          managementApiClient,
          projectId,
        }),
        ...getBranchingTools({
          managementApiClient,
          projectId,
        }),
      };

      // Add account-level management tools only if projectId is not provided
      if (!projectId) {
        Object.assign(
          tools,
          getProjectManagementTools({ managementApiClient })
        );
      }

      return tools;
    },
  });

  return server;
}
