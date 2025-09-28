import type { InitData } from '@supabase/mcp-utils';
import { z } from 'zod';
import { AWS_REGION_CODES } from '../regions.js';

export const storageBucketSchema = z.object({
  id: z.string(),
  name: z.string(),
  owner: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  public: z.boolean(),
});

export const storageConfigSchema = z.object({
  fileSizeLimit: z.number(),
  features: z.object({
    imageTransformation: z.object({ enabled: z.boolean() }),
    s3Protocol: z.object({ enabled: z.boolean() }),
  }),
});

export const organizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  plan: z.string().optional(),
  allowed_release_channels: z.array(z.string()),
  opt_in_tags: z.array(z.string()),
});

export const projectSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.string(),
  region: z.string(),
});

export const branchSchema = z.object({
  id: z.string(),
  name: z.string(),
  project_ref: z.string(),
  parent_project_ref: z.string(),
  is_default: z.boolean(),
  git_branch: z.string().optional(),
  pr_number: z.number().optional(),
  latest_check_run_id: z.number().optional(),
  persistent: z.boolean(),
  status: z.enum([
    'CREATING_PROJECT',
    'RUNNING_MIGRATIONS',
    'MIGRATIONS_PASSED',
    'MIGRATIONS_FAILED',
    'FUNCTIONS_DEPLOYED',
    'FUNCTIONS_FAILED',
  ]),
  created_at: z.string(),
  updated_at: z.string(),
});

export const edgeFunctionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  version: z.number(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
  verify_jwt: z.boolean().optional(),
  import_map: z.boolean().optional(),
  import_map_path: z.string().optional(),
  entrypoint_path: z.string().optional(),
});

export const edgeFunctionWithBodySchema = edgeFunctionSchema.extend({
  files: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
    })
  ),
});

export const createProjectOptionsSchema = z.object({
  name: z.string(),
  organization_id: z.string(),
  region: z.enum(AWS_REGION_CODES),
  db_pass: z.string().optional(),
});

export const createBranchOptionsSchema = z.object({
  name: z.string(),
});

export const resetBranchOptionsSchema = z.object({
  migration_version: z.string().optional(),
});

export const deployEdgeFunctionOptionsSchema = z.object({
  name: z.string(),
  entrypoint_path: z.string(),
  import_map_path: z.string().optional(),
  files: z.array(
    z.object({
      name: z.string(),
      content: z.string(),
    })
  ),
});

export const executeSqlOptionsSchema = z.object({
  query: z.string(),
  read_only: z.boolean().optional(),
});

export const applyMigrationOptionsSchema = z.object({
  name: z.string(),
  query: z.string(),
});

export const migrationSchema = z.object({
  version: z.string(),
  name: z.string().optional(),
});

export const getLogsOptionsSchema = z.object({
  sql: z.string(),
  iso_timestamp_start: z.string().optional(),
  iso_timestamp_end: z.string().optional(),
});

export const generateTypescriptTypesResultSchema = z.object({
  types: z.string(),
});

export const apiKeySchema = z.object({
  id: z.string().nullable().optional(),
  api_key: z.string().nullable().optional(),
  type: z.enum(['legacy', 'publishable', 'secret']).nullable().optional(),
  prefix: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  hash: z.string().nullable().optional(),
  secret_jwt_template: z.record(z.unknown()).nullable().optional(),
  inserted_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

export const createApiKeyOptionsSchema = z.object({
  type: z.enum(['publishable', 'secret']),
  name: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]+$/),
  description: z.string().nullable().optional(),
  secret_jwt_template: z.record(z.unknown()).nullable().optional(),
});

export const updateApiKeyOptionsSchema = z.object({
  name: z
    .string()
    .min(4)
    .max(64)
    .regex(/^[a-z_][a-z0-9_]+$/)
    .optional(),
  description: z.string().nullable().optional(),
  secret_jwt_template: z.record(z.unknown()).nullable().optional(),
});

export const deleteApiKeyOptionsSchema = z.object({
  was_compromised: z.boolean().optional(),
  reason: z.string().optional(),
});

export const snippetListItemSchema = z.object({
  id: z.string(),
  inserted_at: z.string(),
  updated_at: z.string(),
  type: z.enum(['sql']),
  visibility: z.enum(['user', 'project', 'org', 'public']),
  name: z.string(),
  description: z.string().nullable(),
  project: z.object({
    id: z.number(),
    name: z.string(),
  }),
  owner: z.object({
    id: z.number(),
    username: z.string(),
  }),
  updated_by: z.object({
    id: z.number(),
    username: z.string(),
  }),
  favorite: z.boolean(),
});

export const snippetSchema = snippetListItemSchema.extend({
  content: z.object({
    schema_version: z.string(),
    sql: z.string(),
  }),
});

export const organizationMemberSchema = z.object({
  user_id: z.string(),
  user_name: z.string(),
  email: z.string().optional(),
  role_name: z.string(),
  mfa_enabled: z.boolean(),
});

export const serviceHealthSchema = z.object({
  name: z.enum([
    'auth',
    'db',
    'db_postgres_user',
    'pooler',
    'realtime',
    'rest',
    'storage',
    'pg_bouncer',
  ]),
  healthy: z.boolean(),
  status: z.enum(['COMING_UP', 'ACTIVE_HEALTHY', 'UNHEALTHY']),
  info: z.union([
    z.object({
      name: z.enum(['GoTrue']),
      version: z.string(),
      description: z.string(),
    }),
    z.object({
      healthy: z.boolean(),
      db_connected: z.boolean(),
      connected_cluster: z.number(),
    }),
  ]).optional(),
  error: z.string().optional(),
});

export type Organization = z.infer<typeof organizationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Branch = z.infer<typeof branchSchema>;
export type EdgeFunction = z.infer<typeof edgeFunctionSchema>;
export type EdgeFunctionWithBody = z.infer<typeof edgeFunctionWithBodySchema>;

export type CreateProjectOptions = z.infer<typeof createProjectOptionsSchema>;
export type CreateBranchOptions = z.infer<typeof createBranchOptionsSchema>;
export type ResetBranchOptions = z.infer<typeof resetBranchOptionsSchema>;
export type DeployEdgeFunctionOptions = z.infer<
  typeof deployEdgeFunctionOptionsSchema
>;

export type ExecuteSqlOptions = z.infer<typeof executeSqlOptionsSchema>;
export type ApplyMigrationOptions = z.infer<typeof applyMigrationOptionsSchema>;
export type Migration = z.infer<typeof migrationSchema>;
export type ListMigrationsResult = z.infer<typeof migrationSchema>;

export type GetLogsOptions = z.infer<typeof getLogsOptionsSchema>;
export type GenerateTypescriptTypesResult = z.infer<
  typeof generateTypescriptTypesResultSchema
>;

export type StorageConfig = z.infer<typeof storageConfigSchema>;
export type StorageBucket = z.infer<typeof storageBucketSchema>;

export type ApiKey = z.infer<typeof apiKeySchema>;
export type CreateApiKeyOptions = z.infer<typeof createApiKeyOptionsSchema>;
export type UpdateApiKeyOptions = z.infer<typeof updateApiKeyOptionsSchema>;
export type DeleteApiKeyOptions = z.infer<typeof deleteApiKeyOptionsSchema>;
export type SnippetListItem = z.infer<typeof snippetListItemSchema>;
export type Snippet = z.infer<typeof snippetSchema>;
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;
export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

// Analytics & Monitoring schemas
export const apiUsageSchema = z.object({
  timestamp: z.string(),
  count: z.number(),
  endpoint: z.string().optional(),
});

export const logEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  level: z.enum(['info', 'warn', 'error', 'debug']),
  message: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export const networkBanSchema = z.object({
  ip: z.string(),
  reason: z.string(),
  banned_at: z.string(),
  expires_at: z.string().optional(),
});

// Auth Configuration schemas
export const authProviderSchema = z.object({
  provider: z.string(),
  enabled: z.boolean(),
  client_id: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const authConfigSchema = z.object({
  site_url: z.string().optional(),
  jwt_exp: z.number().optional(),
  email_enabled: z.boolean().optional(),
  phone_enabled: z.boolean().optional(),
  providers: z.array(authProviderSchema).optional(),
});

// Backup schemas
export const backupSchema = z.object({
  id: z.string(),
  created_at: z.string(),
  status: z.enum(['completed', 'in_progress', 'failed']),
  type: z.enum(['manual', 'scheduled', 'pitr']),
  size_bytes: z.number().optional(),
});

// Billing schemas
export const billingAddonSchema = z.object({
  variant: z.string(),
  name: z.string(),
  price: z.number(),
  unit: z.string(),
  enabled: z.boolean(),
});

// Custom Domain schemas
export const customHostnameSchema = z.object({
  hostname: z.string(),
  status: z.enum(['pending', 'active', 'failed']),
  ssl_status: z.enum(['pending', 'active', 'failed']).optional(),
  verification_errors: z.array(z.string()).optional(),
});

// Network Restriction schemas
export const networkRestrictionSchema = z.object({
  allowed_ips: z.array(z.string()),
  enabled: z.boolean(),
  last_updated: z.string().optional(),
});

// Database Config schemas
export const poolerConfigSchema = z.object({
  pool_mode: z.enum(['transaction', 'session', 'statement']),
  max_connections: z.number(),
  default_pool_size: z.number(),
});

export type ApiUsage = z.infer<typeof apiUsageSchema>;
export type LogEntry = z.infer<typeof logEntrySchema>;
export type NetworkBan = z.infer<typeof networkBanSchema>;
export type AuthProvider = z.infer<typeof authProviderSchema>;
export type AuthConfig = z.infer<typeof authConfigSchema>;
export type Backup = z.infer<typeof backupSchema>;
export type BillingAddon = z.infer<typeof billingAddonSchema>;
export type CustomHostname = z.infer<typeof customHostnameSchema>;
export type NetworkRestriction = z.infer<typeof networkRestrictionSchema>;
export type PoolerConfig = z.infer<typeof poolerConfigSchema>;

export type DatabaseOperations = {
  executeSql<T>(projectId: string, options: ExecuteSqlOptions): Promise<T[]>;
  listMigrations(projectId: string): Promise<Migration[]>;
  applyMigration(
    projectId: string,
    options: ApplyMigrationOptions
  ): Promise<void>;
  listSnippets(projectId?: string): Promise<SnippetListItem[]>;
  getSnippet(snippetId: string): Promise<Snippet>;
};

export type AccountOperations = {
  listOrganizations(): Promise<Pick<Organization, 'id' | 'name'>[]>;
  getOrganization(organizationId: string): Promise<Organization>;
  listProjects(): Promise<Project[]>;
  getProject(projectId: string): Promise<Project>;
  createProject(options: CreateProjectOptions): Promise<Project>;
  pauseProject(projectId: string): Promise<void>;
  restoreProject(projectId: string): Promise<void>;
  listOrganizationMembers(organizationId: string): Promise<OrganizationMember[]>;
};

export type EdgeFunctionsOperations = {
  listEdgeFunctions(projectId: string): Promise<EdgeFunction[]>;
  getEdgeFunction(
    projectId: string,
    functionSlug: string
  ): Promise<EdgeFunctionWithBody>;
  deployEdgeFunction(
    projectId: string,
    options: DeployEdgeFunctionOptions
  ): Promise<Omit<EdgeFunction, 'files'>>;
};

export type DebuggingOperations = {
  getLogs(projectId: string, options: GetLogsOptions): Promise<unknown>;
  getSecurityAdvisors(projectId: string): Promise<unknown>;
  getPerformanceAdvisors(projectId: string): Promise<unknown>;
  getProjectHealth(projectId: string): Promise<ServiceHealth[]>;
  getUpgradeStatus(projectId: string): Promise<unknown>;
  checkUpgradeEligibility(projectId: string): Promise<unknown>;
};

export type DevelopmentOperations = {
  getProjectUrl(projectId: string): Promise<string>;
  getAnonKey(projectId: string): Promise<string>;
  generateTypescriptTypes(
    projectId: string
  ): Promise<GenerateTypescriptTypesResult>;
};

export type StorageOperations = {
  getStorageConfig(projectId: string): Promise<StorageConfig>;
  updateStorageConfig(projectId: string, config: StorageConfig): Promise<void>;
  listAllBuckets(projectId: string): Promise<StorageBucket[]>;
};

export type BranchingOperations = {
  listBranches(projectId: string): Promise<Branch[]>;
  createBranch(
    projectId: string,
    options: CreateBranchOptions
  ): Promise<Branch>;
  deleteBranch(branchId: string): Promise<void>;
  mergeBranch(branchId: string): Promise<void>;
  resetBranch(branchId: string, options: ResetBranchOptions): Promise<void>;
  rebaseBranch(branchId: string): Promise<void>;
};

export type SecretsOperations = {
  listApiKeys(projectId: string, reveal?: boolean): Promise<ApiKey[]>;
  getApiKey(projectId: string, keyId: string, reveal?: boolean): Promise<ApiKey>;
  createApiKey(projectId: string, options: CreateApiKeyOptions, reveal?: boolean): Promise<ApiKey>;
  updateApiKey(projectId: string, keyId: string, options: UpdateApiKeyOptions, reveal?: boolean): Promise<ApiKey>;
  deleteApiKey(projectId: string, keyId: string, options?: DeleteApiKeyOptions): Promise<ApiKey>;
  // Legacy API keys
  listLegacyApiKeys?(projectId: string): Promise<ApiKey[]>;
  rotateAnonKey?(projectId: string): Promise<unknown>;
  rotateServiceRoleKey?(projectId: string): Promise<unknown>;
  setJwtTemplate?(projectId: string, keyId: string, template: unknown): Promise<unknown>;
  getProjectClaimToken?(projectId: string): Promise<unknown>;
  // Environment secrets
  listEnvSecrets?(projectId: string): Promise<Array<{ name: string; value?: string }>>;
  getEnvSecret?(projectId: string, key: string): Promise<string>;
  setEnvSecret?(projectId: string, key: string, value: string): Promise<void>;
  deleteEnvSecret?(projectId: string, key: string): Promise<void>;
  bulkUpdateSecrets?(projectId: string, secrets: Record<string, string>): Promise<void>;
};

export type AnalyticsOperations = {
  getApiUsage(projectId: string, timeRange?: { start: string; end: string }): Promise<unknown>;
  getFunctionStats(projectId: string, functionSlug?: string): Promise<unknown>;
  getAllLogs(projectId: string, options?: { limit?: number; offset?: number; query?: string }): Promise<unknown>;
  queryLogs(projectId: string, sql: string, timeRange: { start: string; end: string }): Promise<unknown>;
  getNetworkBans(projectId: string): Promise<unknown>;
  getEnrichedBans(projectId: string): Promise<unknown>;
};

export type AuthConfigOperations = {
  getAuthConfig(projectId: string): Promise<unknown>;
  updateAuthConfig(projectId: string, config: unknown): Promise<unknown>;
  // Third-party auth
  listThirdPartyAuth(projectId: string): Promise<unknown[]>;
  getThirdPartyAuth(projectId: string, providerId: string): Promise<unknown>;
  createThirdPartyAuth(projectId: string, provider: unknown): Promise<unknown>;
  updateThirdPartyAuth(projectId: string, providerId: string, config: unknown): Promise<unknown>;
  deleteThirdPartyAuth(projectId: string, providerId: string): Promise<void>;
  // SSO providers
  listSsoProviders(projectId: string): Promise<unknown[]>;
  createSsoProvider(projectId: string, provider: unknown): Promise<unknown>;
  updateSsoProvider(projectId: string, providerId: string, config: unknown): Promise<unknown>;
  deleteSsoProvider(projectId: string, providerId: string): Promise<void>;
  // JWT and signing keys
  rotateJwtSecret(projectId: string): Promise<unknown>;
  getSigningKeys(projectId: string): Promise<unknown>;
};

export type NetworkSecurityOperations = {
  // Network restrictions
  getNetworkRestrictions(projectId: string): Promise<unknown>;
  updateNetworkRestrictions(projectId: string, restrictions: { allowed_ips: string[]; enabled: boolean }): Promise<unknown>;
  applyNetworkRestrictions(projectId: string): Promise<void>;
  // SSL enforcement
  getSSLEnforcement(projectId: string): Promise<unknown>;
  updateSSLEnforcement(projectId: string, config: { enforced: boolean; mode?: string }): Promise<unknown>;
  // Network bans
  addNetworkBan(projectId: string, ban: { ip_address: string; reason?: string; duration?: number }): Promise<unknown>;
  removeNetworkBan(projectId: string, ipAddress: string): Promise<void>;
  // Read replicas
  configureReadReplicas(projectId: string, config: { enabled: boolean; regions?: string[]; max_replicas?: number }): Promise<unknown>;
  setupReadReplica(projectId: string, config: { region: string; size?: string }): Promise<unknown>;
  removeReadReplica(projectId: string, replicaId: string): Promise<void>;
};

export type BackupOperations = {
  listBackups(projectId: string): Promise<unknown[]>;
  createBackup(projectId: string, region?: string): Promise<unknown>;
  restoreBackup(projectId: string, backupId: string): Promise<unknown>;
  restoreToPointInTime(projectId: string, timestamp: string): Promise<unknown>;
  undoRestore(projectId: string): Promise<void>;
};

export type BillingOperations = {
  // Subscription and usage
  getBillingSubscription(projectId: string): Promise<unknown>;
  getBillingUsage(projectId: string, billingPeriod?: string): Promise<unknown>;
  getBillingStatus(projectId: string): Promise<unknown>;
  getUsageMetrics(projectId: string, timeRange?: { start: string; end: string }): Promise<unknown>;
  // Add-ons
  listBillingAddons(projectId: string): Promise<unknown[]>;
  addBillingAddon(projectId: string, addon: { type: string; variant?: string; quantity?: number }): Promise<unknown>;
  updateBillingAddon(projectId: string, addonType: string, config: unknown): Promise<unknown>;
  removeBillingAddon(projectId: string, addonType: string): Promise<void>;
  // Spend caps and credits
  getSpendCap(projectId: string): Promise<unknown>;
  updateSpendCap(projectId: string, config: { enabled: boolean; monthly_limit?: number; action?: string }): Promise<unknown>;
  getBillingCredits(options: { project_id?: string; organization_id?: string }): Promise<unknown>;
  // Invoices and estimates
  getInvoices(options: { project_id?: string; organization_id?: string; limit?: number; status?: string }): Promise<unknown>;
  estimateCosts(projectId: string, usageEstimates: unknown, period?: string): Promise<unknown>;
};

export type CustomDomainOperations = {
  // Custom hostname
  getCustomHostname(projectId: string): Promise<unknown>;
  createCustomHostname(projectId: string, hostname: string): Promise<unknown>;
  initializeCustomHostname(projectId: string): Promise<unknown>;
  activateCustomHostname(projectId: string): Promise<unknown>;
  reverifyCustomHostname(projectId: string): Promise<unknown>;
  deleteCustomHostname(projectId: string): Promise<void>;
  // Vanity subdomain
  getVanitySubdomain(projectId: string): Promise<unknown>;
  createVanitySubdomain(projectId: string, subdomain: string): Promise<unknown>;
  checkSubdomainAvailability(projectId: string, subdomain: string): Promise<{ available: boolean }>;
  activateVanitySubdomain(projectId: string): Promise<unknown>;
  deleteVanitySubdomain(projectId: string): Promise<void>;
};

export type ProjectManagementOperations = {
  // Project lifecycle
  pauseProject(projectId: string): Promise<void>;
  restoreProject(projectId: string): Promise<void>;
  cancelProjectRestore(projectId: string): Promise<void>;
  transferProject(projectId: string, targetOrganizationId: string): Promise<unknown>;
  // Read-only mode
  setProjectReadonly(projectId: string, readonly: boolean): Promise<void>;
  disableReadonlyTemporarily(projectId: string, durationMinutes?: number): Promise<unknown>;
  // Upgrades
  upgradeProject(projectId: string, targetTier: string): Promise<unknown>;
  getUpgradeStatus(projectId: string): Promise<unknown>;
  checkUpgradeEligibility(projectId: string, targetTier?: string): Promise<unknown>;
  // Features and configuration
  enablePgsodium(projectId: string): Promise<void>;
  getProjectContext(projectId: string): Promise<unknown>;
  enablePostgrest(projectId: string, config?: { max_rows?: number; default_limit?: number }): Promise<unknown>;
  getProjectHealth(projectId: string): Promise<unknown>;
  // Secrets
  getProjectSecrets(projectId: string): Promise<unknown>;
  updateProjectSecrets(projectId: string, secrets: Record<string, string>): Promise<void>;
};

export type DatabaseConfigOperations = {
  // PostgreSQL configuration
  getPostgresConfig(projectId: string): Promise<unknown>;
  updatePostgresConfig(projectId: string, config: unknown): Promise<unknown>;
  // Connection pooler
  getPoolerConfig(projectId: string): Promise<unknown>;
  updatePoolerConfig(projectId: string, config: unknown): Promise<unknown>;
  configurePgBouncer(projectId: string, settings: unknown): Promise<void>;
  // PostgREST
  getPostgrestConfig(projectId: string): Promise<unknown>;
  updatePostgrestConfig(projectId: string, config: unknown): Promise<void>;
  // Database features
  enableDatabaseWebhooks(projectId: string): Promise<void>;
  configurePitr(projectId: string, config: { enabled: boolean; retention_period?: number }): Promise<unknown>;
  managePgSodium(projectId: string, action: 'enable' | 'disable'): Promise<void>;
  manageReadReplicas(projectId: string, action: 'setup' | 'remove'): Promise<void>;
};

export type SupabasePlatform = {
  init?(info: InitData): Promise<void>;
  account?: AccountOperations;
  database?: DatabaseOperations;
  functions?: EdgeFunctionsOperations;
  debugging?: DebuggingOperations;
  development?: DevelopmentOperations;
  storage?: StorageOperations;
  branching?: BranchingOperations;
  secrets?: SecretsOperations;
  analytics?: AnalyticsOperations;
  authConfig?: AuthConfigOperations;
  networkSecurity?: NetworkSecurityOperations;
  backup?: BackupOperations;
  billing?: BillingOperations;
  customDomain?: CustomDomainOperations;
  projectManagement?: ProjectManagementOperations;
  databaseConfig?: DatabaseConfigOperations;
};
