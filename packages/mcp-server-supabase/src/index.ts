import packageJson from '../package.json' with { type: 'json' };

export type { ToolCallCallback } from '@supabase/mcp-utils';
export type { SupabasePlatform } from './platform/index.js';
export {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from './server.js';
export {
  CURRENT_FEATURE_GROUPS,
  type FeatureGroup,
} from './types.js';
export const version = packageJson.version;

export {
  listOrganizationsInputSchema,
  listOrganizationsOutputSchema,
  type ListOrganizationsInput,
  type ListOrganizationsOutput,
  getOrganizationInputSchema,
  getOrganizationOutputSchema,
  type GetOrganizationInput,
  type GetOrganizationOutput,
  listProjectsInputSchema,
  listProjectsOutputSchema,
  type ListProjectsInput,
  type ListProjectsOutput,
  getProjectInputSchema,
  getProjectOutputSchema,
  type GetProjectInput,
  type GetProjectOutput,
  getCostInputSchema,
  getCostOutputSchema,
  type GetCostInput,
  type GetCostOutput,
  confirmCostInputSchema,
  confirmCostOutputSchema,
  type ConfirmCostInput,
  type ConfirmCostOutput,
  createProjectInputSchema,
  createProjectOutputSchema,
  type CreateProjectInput,
  type CreateProjectOutput,
  pauseProjectInputSchema,
  pauseProjectOutputSchema,
  type PauseProjectInput,
  type PauseProjectOutput,
  restoreProjectInputSchema,
  restoreProjectOutputSchema,
  type RestoreProjectInput,
  type RestoreProjectOutput,
} from './tools/account-tools.js';

export {
  createBranchInputSchema,
  createBranchOutputSchema,
  type CreateBranchInput,
  type CreateBranchOutput,
  listBranchesInputSchema,
  listBranchesOutputSchema,
  type ListBranchesInput,
  type ListBranchesOutput,
  deleteBranchInputSchema,
  deleteBranchOutputSchema,
  type DeleteBranchInput,
  type DeleteBranchOutput,
  mergeBranchInputSchema,
  mergeBranchOutputSchema,
  type MergeBranchInput,
  type MergeBranchOutput,
  resetBranchInputSchema,
  resetBranchOutputSchema,
  type ResetBranchInput,
  type ResetBranchOutput,
  rebaseBranchInputSchema,
  rebaseBranchOutputSchema,
  type RebaseBranchInput,
  type RebaseBranchOutput,
} from './tools/branching-tools.js';

export {
  listTablesInputSchema,
  listTablesOutputSchema,
  type ListTablesInput,
  type ListTablesOutput,
  listExtensionsInputSchema,
  listExtensionsOutputSchema,
  type ListExtensionsInput,
  type ListExtensionsOutput,
  listMigrationsInputSchema,
  listMigrationsOutputSchema,
  type ListMigrationsInput,
  type ListMigrationsOutput,
  applyMigrationInputSchema,
  applyMigrationOutputSchema,
  type ApplyMigrationInput,
  type ApplyMigrationOutput,
  executeSqlInputSchema,
  executeSqlOutputSchema,
  type ExecuteSqlInput,
  type ExecuteSqlOutput,
} from './tools/database-operation-tools.js';

export {
  getLogsInputSchema,
  getLogsOutputSchema,
  type GetLogsInput,
  type GetLogsOutput,
  getAdvisorsInputSchema,
  getAdvisorsOutputSchema,
  type GetAdvisorsInput,
  type GetAdvisorsOutput,
} from './tools/debugging-tools.js';

export {
  getProjectUrlInputSchema,
  getProjectUrlOutputSchema,
  type GetProjectUrlInput,
  type GetProjectUrlOutput,
  getPublishableKeysInputSchema,
  getPublishableKeysOutputSchema,
  type GetPublishableKeysInput,
  type GetPublishableKeysOutput,
  generateTypescriptTypesInputSchema,
  generateTypescriptTypesOutputSchema,
  type GenerateTypescriptTypesInput,
  type GenerateTypescriptTypesOutput,
} from './tools/development-tools.js';

export {
  searchDocsInputSchema,
  searchDocsOutputSchema,
  type SearchDocsInput,
  type SearchDocsOutput,
} from './tools/docs-tools.js';

export {
  listEdgeFunctionsInputSchema,
  listEdgeFunctionsOutputSchema,
  type ListEdgeFunctionsInput,
  type ListEdgeFunctionsOutput,
  getEdgeFunctionInputSchema,
  getEdgeFunctionOutputSchema,
  type GetEdgeFunctionInput,
  type GetEdgeFunctionOutput,
  deployEdgeFunctionInputSchema,
  deployEdgeFunctionOutputSchema,
  type DeployEdgeFunctionInput,
  type DeployEdgeFunctionOutput,
} from './tools/edge-function-tools.js';

export {
  listStorageBucketsInputSchema,
  listStorageBucketsOutputSchema,
  type ListStorageBucketsInput,
  type ListStorageBucketsOutput,
  getStorageConfigInputSchema,
  getStorageConfigOutputSchema,
  type GetStorageConfigInput,
  type GetStorageConfigOutput,
  updateStorageConfigInputSchema,
  updateStorageConfigOutputSchema,
  type UpdateStorageConfigInput,
  type UpdateStorageConfigOutput,
} from './tools/storage-tools.js';

export { supabaseMcpTools } from './tools/registry.js';
