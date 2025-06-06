import { createMcpServer, type Tool } from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import type { SupabasePlatform } from './platform/types.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseOperationTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getProjectManagementTools } from './tools/project-management-tools.js';
import { getStorageTools } from './tools/storage-tools.js';

const { version } = packageJson;

export type SupabaseMcpServerOptions = {
  /**
   * Platform implementation for Supabase.
   */
  platform: SupabasePlatform;

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
  const { platform, projectId, readOnly } = options;

  const server = createMcpServer({
    name: 'supabase',
    version,
    async onInitialize(info) {
      await platform.init?.(info);
    },
    tools: () => {
      const tools: Record<string, Tool> = {};

      // Add account-level tools only if projectId is not provided
      if (!projectId) {
        Object.assign(tools, getProjectManagementTools({ platform }));
      }

      // Add project-level tools
      Object.assign(
        tools,
        getDatabaseOperationTools({ platform, projectId, readOnly }),
        getEdgeFunctionTools({ platform, projectId }),
        getDebuggingTools({ platform, projectId }),
        getDevelopmentTools({ platform, projectId }),
        getBranchingTools({ platform, projectId }),
        getStorageTools({ platform, projectId })
      );

      return tools;
    },
  });

  return server;
}
