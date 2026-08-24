import type {
  AccountOperations,
  BranchingOperations,
  CreationRate,
  SupabasePlatform,
} from '../src/platform/types.js';

/**
 * A platform whose every value is fixed, for tests that pin exact bytes or the
 * order operations run in. Nothing here is random, so a result is reproducible
 * across runs and comparable against a measured baseline.
 */

export const PROJECT_RATE: CreationRate = {
  amount: 10,
  currency: 'USD',
  recurrence: 'monthly',
};

export const BRANCH_RATE: CreationRate = {
  amount: 0.01344,
  currency: 'USD',
  recurrence: 'hourly',
};

export const FIXED_PROJECT = {
  id: 'fixed-project-ref',
  ref: 'fixed-project-ref',
  organization_id: 'fixed-org',
  organization_slug: 'fixed-org',
  name: 'Fixture Project',
  status: 'UNKNOWN',
  created_at: '2026-01-01T00:00:00.000Z',
  region: 'us-east-1',
};

export const FIXED_BRANCH = {
  id: 'fixed-branch',
  name: 'develop',
  project_ref: 'fixed-branch-ref',
  parent_project_ref: 'fixed-project-ref',
  is_default: false,
  persistent: false,
  status: 'CREATING_PROJECT' as const,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export type CostPlatform = {
  platform: SupabasePlatform;
  /** Rate reads and creations, in the order they happened. */
  calls: string[];
  /** Rates the next reads return, one per read, before the default applies. */
  projectRates: CreationRate[];
  branchRates: CreationRate[];
};

export function createCostPlatform(): CostPlatform {
  const calls: string[] = [];
  const projectRates: CreationRate[] = [];
  const branchRates: CreationRate[] = [];

  const account: AccountOperations = {
    async listOrganizations() {
      return [{ id: 'fixed-org', slug: 'fixed-org', name: 'Fixture Org' }];
    },
    async getOrganization() {
      return {
        id: 'fixed-org',
        name: 'Fixture Org',
        plan: 'pro',
        allowed_release_channels: ['ga'],
        opt_in_tags: [],
      };
    },
    async listProjects() {
      return [FIXED_PROJECT];
    },
    async getProject() {
      return FIXED_PROJECT;
    },
    async createProject() {
      calls.push('create_project');
      return FIXED_PROJECT;
    },
    async pauseProject() {},
    async restoreProject() {},
    async getProjectCreationRate() {
      calls.push('read_project_rate');
      return projectRates.shift() ?? PROJECT_RATE;
    },
  };

  const branching: BranchingOperations = {
    async listBranches() {
      return [];
    },
    async createBranch() {
      calls.push('create_branch');
      return FIXED_BRANCH;
    },
    async deleteBranch() {},
    async mergeBranch() {},
    async resetBranch() {},
    async rebaseBranch() {},
    async getBranchCreationRate() {
      calls.push('read_branch_rate');
      return branchRates.shift() ?? BRANCH_RATE;
    },
  };

  return { platform: { account, branching }, calls, projectRates, branchRates };
}
