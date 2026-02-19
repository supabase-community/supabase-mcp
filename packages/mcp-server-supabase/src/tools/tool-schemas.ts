import type { z } from 'zod/v4';
import { CURRENT_FEATURE_GROUPS, type FeatureGroup } from '../types.js';
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

/**
 * Maps each feature group to its tool names.
 *
 * Used by {@link createToolSchemas} to filter tools by feature.
 */
const FEATURE_TOOL_MAP = {
  docs: ['search_docs'],
  account: [
    'list_organizations',
    'get_organization',
    'list_projects',
    'get_project',
    'get_cost',
    'confirm_cost',
    'create_project',
    'pause_project',
    'restore_project',
  ],
  database: [
    'list_tables',
    'list_extensions',
    'list_migrations',
    'apply_migration',
    'execute_sql',
  ],
  debugging: ['get_logs', 'get_advisors'],
  development: [
    'get_project_url',
    'get_publishable_keys',
    'generate_typescript_types',
  ],
  functions: [
    'list_edge_functions',
    'get_edge_function',
    'deploy_edge_function',
  ],
  branching: [
    'create_branch',
    'list_branches',
    'delete_branch',
    'merge_branch',
    'reset_branch',
    'rebase_branch',
  ],
  storage: [
    'list_storage_buckets',
    'get_storage_config',
    'update_storage_config',
  ],
} as const satisfies Record<
  FeatureGroup,
  readonly (keyof typeof supabaseMcpToolSchemas)[]
>;

/**
 * Pre-computed schemas with `project_id` omitted from input schemas.
 *
 * Used by {@link createToolSchemas} when `projectScoped` is true.
 * Account tools are not included here because they are excluded entirely
 * in project-scoped mode (matching server behavior).
 */
const PROJECT_SCOPED_OVERRIDES = {
  // branching
  create_branch: {
    inputSchema: createBranchInputSchema.omit({ project_id: true }),
    outputSchema: createBranchOutputSchema,
  },
  list_branches: {
    inputSchema: listBranchesInputSchema.omit({ project_id: true }),
    outputSchema: listBranchesOutputSchema,
  },
  // database
  list_tables: {
    inputSchema: listTablesInputSchema.omit({ project_id: true }),
    outputSchema: listTablesOutputSchema,
  },
  list_extensions: {
    inputSchema: listExtensionsInputSchema.omit({ project_id: true }),
    outputSchema: listExtensionsOutputSchema,
  },
  list_migrations: {
    inputSchema: listMigrationsInputSchema.omit({ project_id: true }),
    outputSchema: listMigrationsOutputSchema,
  },
  apply_migration: {
    inputSchema: applyMigrationInputSchema.omit({ project_id: true }),
    outputSchema: applyMigrationOutputSchema,
  },
  execute_sql: {
    inputSchema: executeSqlInputSchema.omit({ project_id: true }),
    outputSchema: executeSqlOutputSchema,
  },
  // debugging
  get_logs: {
    inputSchema: getLogsInputSchema.omit({ project_id: true }),
    outputSchema: getLogsOutputSchema,
  },
  get_advisors: {
    inputSchema: getAdvisorsInputSchema.omit({ project_id: true }),
    outputSchema: getAdvisorsOutputSchema,
  },
  // development
  get_project_url: {
    inputSchema: getProjectUrlInputSchema.omit({ project_id: true }),
    outputSchema: getProjectUrlOutputSchema,
  },
  get_publishable_keys: {
    inputSchema: getPublishableKeysInputSchema.omit({ project_id: true }),
    outputSchema: getPublishableKeysOutputSchema,
  },
  generate_typescript_types: {
    inputSchema: generateTypescriptTypesInputSchema.omit({ project_id: true }),
    outputSchema: generateTypescriptTypesOutputSchema,
  },
  // functions
  list_edge_functions: {
    inputSchema: listEdgeFunctionsInputSchema.omit({ project_id: true }),
    outputSchema: listEdgeFunctionsOutputSchema,
  },
  get_edge_function: {
    inputSchema: getEdgeFunctionInputSchema.omit({ project_id: true }),
    outputSchema: getEdgeFunctionOutputSchema,
  },
  deploy_edge_function: {
    inputSchema: deployEdgeFunctionInputSchema.omit({ project_id: true }),
    outputSchema: deployEdgeFunctionOutputSchema,
  },
  // storage
  list_storage_buckets: {
    inputSchema: listStorageBucketsInputSchema.omit({ project_id: true }),
    outputSchema: listStorageBucketsOutputSchema,
  },
  get_storage_config: {
    inputSchema: getStorageConfigInputSchema.omit({ project_id: true }),
    outputSchema: getStorageConfigOutputSchema,
  },
  update_storage_config: {
    inputSchema: updateStorageConfigInputSchema.omit({ project_id: true }),
    outputSchema: updateStorageConfigOutputSchema,
  },
} satisfies Partial<
  Record<
    keyof typeof supabaseMcpToolSchemas,
    { inputSchema: z.ZodObject<any>; outputSchema: z.ZodObject<any> }
  >
>;

/**
 * Tools that throw in read-only mode.
 *
 * Used by {@link createToolSchemas} when `readOnly` is true to
 * exclude write-only tools from the schema.
 */
const WRITE_TOOLS = [
  'create_project',
  'pause_project',
  'restore_project',
  'create_branch',
  'delete_branch',
  'merge_branch',
  'reset_branch',
  'rebase_branch',
  'apply_migration',
  'deploy_edge_function',
  'update_storage_config',
] as const satisfies readonly (keyof typeof supabaseMcpToolSchemas)[];

// ---------------------------------------------------------------------------
// Type-level helpers for createToolSchemas
// ---------------------------------------------------------------------------

type AllSchemas = typeof supabaseMcpToolSchemas;
type ProjectScopedSchemas = typeof PROJECT_SCOPED_OVERRIDES;
type FeatureToolMapType = typeof FEATURE_TOOL_MAP;

type ToolNameForFeature<Feature extends FeatureGroup> =
  FeatureToolMapType[Feature][number];

type AccountToolName = FeatureToolMapType['account'][number];
type WriteToolName = (typeof WRITE_TOOLS)[number];

/**
 * Computes the set of tool names available for a given configuration.
 *
 * - Resolves feature groups to their tool names
 * - Excludes account tools when project-scoped
 * - Excludes write-only tools when read-only
 */
type AvailableToolNames<
  Feature extends FeatureGroup,
  ProjectScoped extends boolean,
  ReadOnly extends boolean,
> = Exclude<
  ToolNameForFeature<Feature>,
  | (ProjectScoped extends true ? AccountToolName : never)
  | (ReadOnly extends true ? WriteToolName : never)
>;

/**
 * Computes the tool schemas for a given configuration.
 *
 * When `ProjectScoped` is `true`, tools with `project_id` use the
 * project-scoped override (with `project_id` omitted from the input
 * schema). All other tools use their original schemas.
 */
type ToolSchemasFor<
  Feature extends FeatureGroup,
  ProjectScoped extends boolean,
  ReadOnly extends boolean,
> = {
  [K in AvailableToolNames<Feature, ProjectScoped, ReadOnly> &
    keyof AllSchemas]: ProjectScoped extends true
    ? K extends keyof ProjectScopedSchemas
      ? ProjectScopedSchemas[K]
      : AllSchemas[K]
    : AllSchemas[K];
};

/**
 * Creates a dynamically scoped tool schema map for use with AI SDK's
 * `mcpClient.tools()`.
 *
 * Mirrors the server's dynamic tool behavior:
 * - `features` controls which tool groups are included
 * - `projectScoped` omits `project_id` from input schemas and excludes
 *   account tools (matching server behavior when `projectId` is set)
 * - `readOnly` excludes mutating tools
 *
 * @example
 * ```typescript
 * import { createToolSchemas } from '@supabase/mcp-server-supabase';
 *
 * // Project-scoped with specific features
 * const schemas = createToolSchemas({
 *   features: ['database', 'docs'],
 *   projectScoped: true,
 * });
 *
 * const tools = await mcpClient.tools({ schemas });
 * ```
 */
export function createToolSchemas<
  const Features extends readonly FeatureGroup[] = typeof CURRENT_FEATURE_GROUPS,
  const ProjectScoped extends boolean = false,
  const ReadOnly extends boolean = false,
>(options?: {
  features?: Features;
  projectScoped?: ProjectScoped;
  readOnly?: ReadOnly;
}): ToolSchemasFor<Features[number], ProjectScoped, ReadOnly> {
  const enabledFeatures = new Set<string>(
    options?.features ?? CURRENT_FEATURE_GROUPS
  );
  const projectScoped = options?.projectScoped ?? false;
  const readOnly = options?.readOnly ?? false;
  const writeToolSet = new Set<string>(WRITE_TOOLS);

  const result: Record<
    string,
    { inputSchema: z.ZodObject<any>; outputSchema: z.ZodObject<any> }
  > = {};

  for (const [feature, toolNames] of Object.entries(FEATURE_TOOL_MAP)) {
    if (!enabledFeatures.has(feature)) continue;
    if (projectScoped && feature === 'account') continue;

    for (const toolName of toolNames) {
      if (readOnly && writeToolSet.has(toolName)) continue;

      if (projectScoped && toolName in PROJECT_SCOPED_OVERRIDES) {
        result[toolName] =
          PROJECT_SCOPED_OVERRIDES[
            toolName as keyof typeof PROJECT_SCOPED_OVERRIDES
          ];
      } else {
        result[toolName] = supabaseMcpToolSchemas[toolName];
      }
    }
  }

  return result as ToolSchemasFor<Features[number], ProjectScoped, ReadOnly>;
}
