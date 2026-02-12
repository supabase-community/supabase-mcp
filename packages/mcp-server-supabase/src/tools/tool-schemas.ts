import type { z } from 'zod/v4';
import {
  // Account tools
  listOrganizationsInputSchema,
  listOrganizationsOutputSchema,
  getOrganizationInputSchema,
  getOrganizationOutputSchema,
  listProjectsInputSchema,
  listProjectsOutputSchema,
  getProjectInputSchema,
  getProjectOutputSchema,
  getCostInputSchema,
  getCostOutputSchema,
  confirmCostInputSchema,
  confirmCostOutputSchema,
  createProjectInputSchema,
  createProjectOutputSchema,
  pauseProjectInputSchema,
  pauseProjectOutputSchema,
  restoreProjectInputSchema,
  restoreProjectOutputSchema,
} from './account-tools.js';
import {
  // Branching tools
  createBranchInputSchema,
  createBranchOutputSchema,
  listBranchesInputSchema,
  listBranchesOutputSchema,
  deleteBranchInputSchema,
  deleteBranchOutputSchema,
  mergeBranchInputSchema,
  mergeBranchOutputSchema,
  resetBranchInputSchema,
  resetBranchOutputSchema,
  rebaseBranchInputSchema,
  rebaseBranchOutputSchema,
} from './branching-tools.js';
import {
  // Database operation tools
  listTablesInputSchema,
  listTablesOutputSchema,
  listExtensionsInputSchema,
  listExtensionsOutputSchema,
  listMigrationsInputSchema,
  listMigrationsOutputSchema,
  applyMigrationInputSchema,
  applyMigrationOutputSchema,
  executeSqlInputSchema,
  executeSqlOutputSchema,
} from './database-operation-tools.js';
import {
  // Debugging tools
  getLogsInputSchema,
  getLogsOutputSchema,
  getAdvisorsInputSchema,
  getAdvisorsOutputSchema,
} from './debugging-tools.js';
import {
  // Development tools
  getProjectUrlInputSchema,
  getProjectUrlOutputSchema,
  getPublishableKeysInputSchema,
  getPublishableKeysOutputSchema,
  generateTypescriptTypesInputSchema,
  generateTypescriptTypesOutputSchema,
} from './development-tools.js';
import {
  // Docs tools
  searchDocsInputSchema,
  searchDocsOutputSchema,
} from './docs-tools.js';
import {
  // Edge function tools
  listEdgeFunctionsInputSchema,
  listEdgeFunctionsOutputSchema,
  getEdgeFunctionInputSchema,
  getEdgeFunctionOutputSchema,
  deployEdgeFunctionInputSchema,
  deployEdgeFunctionOutputSchema,
} from './edge-function-tools.js';
import {
  // Storage tools
  listStorageBucketsInputSchema,
  listStorageBucketsOutputSchema,
  getStorageConfigInputSchema,
  getStorageConfigOutputSchema,
  updateStorageConfigInputSchema,
  updateStorageConfigOutputSchema,
} from './storage-tools.js';

/**
 * All Supabase MCP tool schemas (input + output pairs).
 *
 * Pass to AI SDK's `mcpClient.tools()` `schemas` option to get typed tool
 * inputs and outputs:
 * https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools#typed-tool-outputs
 *
 * @example
 * ```typescript
 * import { supabaseMcpToolSchemas } from '@supabase/mcp-server-supabase';
 *
 * const tools = await mcpClient.tools({
 *   schemas: supabaseMcpToolSchemas,
 * });
 * ```
 */
export const supabaseMcpToolSchemas = {
  // Account tools
  list_organizations: {
    inputSchema: listOrganizationsInputSchema,
    outputSchema: listOrganizationsOutputSchema,
  },
  get_organization: {
    inputSchema: getOrganizationInputSchema,
    outputSchema: getOrganizationOutputSchema,
  },
  list_projects: {
    inputSchema: listProjectsInputSchema,
    outputSchema: listProjectsOutputSchema,
  },
  get_project: {
    inputSchema: getProjectInputSchema,
    outputSchema: getProjectOutputSchema,
  },
  get_cost: {
    inputSchema: getCostInputSchema,
    outputSchema: getCostOutputSchema,
  },
  confirm_cost: {
    inputSchema: confirmCostInputSchema,
    outputSchema: confirmCostOutputSchema,
  },
  create_project: {
    inputSchema: createProjectInputSchema,
    outputSchema: createProjectOutputSchema,
  },
  pause_project: {
    inputSchema: pauseProjectInputSchema,
    outputSchema: pauseProjectOutputSchema,
  },
  restore_project: {
    inputSchema: restoreProjectInputSchema,
    outputSchema: restoreProjectOutputSchema,
  },
  // Branching tools
  create_branch: {
    inputSchema: createBranchInputSchema,
    outputSchema: createBranchOutputSchema,
  },
  list_branches: {
    inputSchema: listBranchesInputSchema,
    outputSchema: listBranchesOutputSchema,
  },
  delete_branch: {
    inputSchema: deleteBranchInputSchema,
    outputSchema: deleteBranchOutputSchema,
  },
  merge_branch: {
    inputSchema: mergeBranchInputSchema,
    outputSchema: mergeBranchOutputSchema,
  },
  reset_branch: {
    inputSchema: resetBranchInputSchema,
    outputSchema: resetBranchOutputSchema,
  },
  rebase_branch: {
    inputSchema: rebaseBranchInputSchema,
    outputSchema: rebaseBranchOutputSchema,
  },
  // Database operation tools
  list_tables: {
    inputSchema: listTablesInputSchema,
    outputSchema: listTablesOutputSchema,
  },
  list_extensions: {
    inputSchema: listExtensionsInputSchema,
    outputSchema: listExtensionsOutputSchema,
  },
  list_migrations: {
    inputSchema: listMigrationsInputSchema,
    outputSchema: listMigrationsOutputSchema,
  },
  apply_migration: {
    inputSchema: applyMigrationInputSchema,
    outputSchema: applyMigrationOutputSchema,
  },
  execute_sql: {
    inputSchema: executeSqlInputSchema,
    outputSchema: executeSqlOutputSchema,
  },
  // Debugging tools
  get_logs: {
    inputSchema: getLogsInputSchema,
    outputSchema: getLogsOutputSchema,
  },
  get_advisors: {
    inputSchema: getAdvisorsInputSchema,
    outputSchema: getAdvisorsOutputSchema,
  },
  // Development tools
  get_project_url: {
    inputSchema: getProjectUrlInputSchema,
    outputSchema: getProjectUrlOutputSchema,
  },
  get_publishable_keys: {
    inputSchema: getPublishableKeysInputSchema,
    outputSchema: getPublishableKeysOutputSchema,
  },
  generate_typescript_types: {
    inputSchema: generateTypescriptTypesInputSchema,
    outputSchema: generateTypescriptTypesOutputSchema,
  },
  // Docs tools
  search_docs: {
    inputSchema: searchDocsInputSchema,
    outputSchema: searchDocsOutputSchema,
  },
  // Edge function tools
  list_edge_functions: {
    inputSchema: listEdgeFunctionsInputSchema,
    outputSchema: listEdgeFunctionsOutputSchema,
  },
  get_edge_function: {
    inputSchema: getEdgeFunctionInputSchema,
    outputSchema: getEdgeFunctionOutputSchema,
  },
  deploy_edge_function: {
    inputSchema: deployEdgeFunctionInputSchema,
    outputSchema: deployEdgeFunctionOutputSchema,
  },
  // Storage tools
  list_storage_buckets: {
    inputSchema: listStorageBucketsInputSchema,
    outputSchema: listStorageBucketsOutputSchema,
  },
  get_storage_config: {
    inputSchema: getStorageConfigInputSchema,
    outputSchema: getStorageConfigOutputSchema,
  },
  update_storage_config: {
    inputSchema: updateStorageConfigInputSchema,
    outputSchema: updateStorageConfigOutputSchema,
  },
} satisfies Record<
  string,
  {
    inputSchema: z.ZodObject<any>;
    outputSchema: z.ZodObject<any>;
  }
>;
