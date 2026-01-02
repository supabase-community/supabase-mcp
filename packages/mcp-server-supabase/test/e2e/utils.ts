import { anthropic } from '@ai-sdk/anthropic';
import { StreamTransport, type ToolRegistry } from '@supabase/mcp-utils';
import { createMCPClient } from '@ai-sdk/mcp';
import { createSupabaseMcpServer } from '../../src/index.js';
import { createSupabaseApiPlatform } from '../../src/platform/api-platform.js';
import { ACCESS_TOKEN, API_URL, MCP_CLIENT_NAME } from '../mocks.js';
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
  // Debugging tools
  getLogsInputSchema,
  getLogsOutputSchema,
  getAdvisorsInputSchema,
  getAdvisorsOutputSchema,
  // Development tools
  getProjectUrlInputSchema,
  getProjectUrlOutputSchema,
  getPublishableKeysInputSchema,
  getPublishableKeysOutputSchema,
  generateTypescriptTypesInputSchema,
  generateTypescriptTypesOutputSchema,
  // Docs tools
  searchDocsInputSchema,
  searchDocsOutputSchema,
  // Edge function tools
  listEdgeFunctionsInputSchema,
  listEdgeFunctionsOutputSchema,
  getEdgeFunctionInputSchema,
  getEdgeFunctionOutputSchema,
  deployEdgeFunctionInputSchema,
  deployEdgeFunctionOutputSchema,
  // Storage tools
  listStorageBucketsInputSchema,
  listStorageBucketsOutputSchema,
  getStorageConfigInputSchema,
  getStorageConfigOutputSchema,
  updateStorageConfigInputSchema,
  updateStorageConfigOutputSchema,
} from '../../src/index.js';

const DEFAULT_TEST_MODEL = 'claude-3-7-sonnet-20250219';

type SetupOptions = {
  projectId?: string;
};

/**
 * Sets up an MCP client and server for testing.
 */
export async function setup({ projectId }: SetupOptions = {}) {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const platform = createSupabaseApiPlatform({
    apiUrl: API_URL,
    accessToken: ACCESS_TOKEN,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
  });

  await server.connect(serverTransport);

  const client = await createMCPClient({
    name: MCP_CLIENT_NAME,
    transport: clientTransport,
  });

  return { client, clientTransport, server, serverTransport };
}

/**
 * Gets the default model for testing, with the ability to override.
 */
export function getTestModel(modelId?: string) {
  return anthropic(modelId ?? DEFAULT_TEST_MODEL);
}

/**
 * Complete registry of all Supabase MCP tools with their input and output schemas.
 * Used for type-safe parsing of tool calls and results.
 */
export const supabaseMcpTools = {
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
} satisfies ToolRegistry;
