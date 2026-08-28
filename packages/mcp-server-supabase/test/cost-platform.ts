import type { CreationRate } from '../src/cost-confirmation.js';
import type {
  AccountOperations,
  BranchingOperations,
  SupabasePlatform,
} from '../src/platform/types.js';

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

export function createCostPlatform() {
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
  };

  const readProjectCreationRate = async () => {
    calls.push('read_project_rate');
    return projectRates.shift() ?? PROJECT_RATE;
  };
  const readBranchCreationRate = async () => {
    calls.push('read_branch_rate');
    return branchRates.shift() ?? BRANCH_RATE;
  };

  return {
    platform: { account, branching } satisfies SupabasePlatform,
    calls,
    projectRates,
    branchRates,
    readProjectCreationRate,
    readBranchCreationRate,
  };
}
