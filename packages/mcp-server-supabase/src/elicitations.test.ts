import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { InMemoryReplayStore } from '@supabase/mcp-utils';
import type { SetupServer } from 'msw/node';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  MCP_CLIENT_NAME,
  MCP_CLIENT_VERSION,
  setupMockApis,
} from '../test/mocks.js';
import type {
  Branch,
  CreateBranchOptions,
  CreateProjectOptions,
  Project,
  SupabasePlatform,
} from './platform/types.js';
import * as toolUtil from './tools/util.js';
import { createSupabaseMcpHandler } from './transports/http.js';
import * as pricing from './pricing.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const STATE_KEY = new Uint8Array(32).fill(5);

let mockServer!: SetupServer;
const cleanups: Array<() => Promise<void>> = [];

beforeEach(() => {
  mockServer = setupMockApis();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  mockServer.close();
});

type ClientFixtureOptions = {
  onElicit?: () => void;
  transformRequest?: (body: Record<string, any>) => void;
  duplicateRetry?: boolean;
  projectId?: string;
  continuationProjectId?: string;
};

async function setupClient(
  responses: Array<{
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, string | number | boolean | string[]>;
  }>,
  platform: SupabasePlatform,
  fixtureOptions: ClientFixtureOptions = {}
) {
  const replayStore = new InMemoryReplayStore();
  const createHandler = (projectId?: string) =>
    createSupabaseMcpHandler({
      platform,
      projectId,
      elicitation: {
        stateKey: STATE_KEY,
        approverId: 'approver-1',
        replayStore,
        formDeliveryAvailable: true,
      },
    });
  const handler = createHandler(fixtureOptions.projectId);
  const continuationHandler =
    fixtureOptions.continuationProjectId === undefined
      ? undefined
      : createHandler(fixtureOptions.continuationProjectId);
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body = (await request.clone().json()) as Record<string, any>;
      fixtureOptions.transformRequest?.(body);
      const forwarded = new Request(url, {
        ...init,
        body: JSON.stringify(body),
      });
      if (
        fixtureOptions.duplicateRetry &&
        body.method === 'tools/call' &&
        typeof body.params?.requestState === 'string'
      ) {
        await handler.fetch(forwarded.clone());
      }
      const retry =
        body.method === 'tools/call' &&
        typeof body.params?.requestState === 'string';
      if (retry && continuationHandler !== undefined) {
        return continuationHandler.fetch(forwarded);
      }
      return handler.fetch(forwarded);
    },
  });
  const client = new Client(
    { name: MCP_CLIENT_NAME, version: MCP_CLIENT_VERSION },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );
  client.setRequestHandler('elicitation/create', async () => {
    fixtureOptions.onElicit?.();
    const response = responses.shift();
    if (response === undefined) throw new Error('Missing elicitation response');
    return response;
  });
  await client.connect(transport);
  cleanups.push(
    () => client.close(),
    () => handler.close(),
    ...(continuationHandler === undefined
      ? []
      : [() => continuationHandler.close()])
  );
  return client;
}

function paidProjectPlatform() {
  const organization = {
    id: 'org-1',
    name: 'Paid Org',
    plan: 'pro',
    allowed_release_channels: ['ga'],
    opt_in_tags: [],
  };
  const projects: Project[] = [
    {
      id: 'existing',
      ref: 'existing',
      organization_id: organization.id,
      organization_slug: 'paid-org',
      name: 'Existing',
      status: 'ACTIVE_HEALTHY',
      created_at: '2026-08-18T00:00:00.000Z',
      region: 'us-east-1',
    },
  ];
  const platform: SupabasePlatform = {
    account: {
      listOrganizations: async () => [
        { id: organization.id, slug: 'paid-org', name: organization.name },
      ],
      getOrganization: async () => organization,
      listProjects: async () => projects,
      getProject: async (projectId) => {
        const project = projects.find(({ id }) => id === projectId);
        if (project === undefined) throw new Error('Project not found');
        return project;
      },
      createProject: async (options: CreateProjectOptions) => {
        const project: Project = {
          id: `project-${projects.length}`,
          ref: `project-${projects.length}`,
          organization_id: options.organization_id,
          organization_slug: 'paid-org',
          name: options.name,
          status: 'COMING_UP',
          created_at: '2026-08-18T00:00:00.000Z',
          region: options.region,
        };
        projects.push(project);
        return project;
      },
      pauseProject: async () => {},
      restoreProject: async () => {},
    },
  };
  return { organization, platform, projects };
}
function branchingPlatform() {
  const branches: Branch[] = [];
  const createBranch = vi.fn(
    async (projectId: string, options: CreateBranchOptions) => {
      const branch: Branch = {
        id: `branch-${branches.length}`,
        name: options.name,
        project_ref: `branch-ref-${branches.length}`,
        parent_project_ref: projectId,
        is_default: false,
        persistent: false,
        status: 'CREATING_PROJECT',
        created_at: '2026-08-18T00:00:00.000Z',
        updated_at: '2026-08-18T00:00:00.000Z',
      };
      branches.push(branch);
      return branch;
    }
  );
  const platform: SupabasePlatform = {
    branching: {
      listBranches: async () => branches,
      createBranch,
      deleteBranch: async () => {},
      mergeBranch: async () => {},
      resetBranch: async () => {},
      rebaseBranch: async () => {},
    },
  };
  return { branches, createBranch, platform };
}

describe('paid resource Human Confirmation', () => {
  test('acceptance creates exactly one project', async () => {
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Confirmed',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(projects.filter(({ name }) => name === 'Confirmed')).toHaveLength(1);
  });

  test.each([
    ['decline', 'declined'],
    ['cancel', 'cancelled'],
  ] as const)('%s creates nothing and returns %s', async (action, status) => {
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient([{ action }], platform);

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Rejected',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ status });
    expect(projects).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Rejected' })])
    );
  });
  test('returns recovery text after confirmation expiry without creating', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      {
        onElicit: () => {
          vi.setSystemTime(new Date('2030-01-01T00:02:01.000Z'));
        },
      }
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Expired',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'This confirmation expired. Run the tool again to request a new confirmation.',
      },
    ]);
    expect(projects).toHaveLength(1);
  });

  test('rejects argument mutation between confirmation legs', async () => {
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      {
        transformRequest: (body) => {
          if (
            body.method === 'tools/call' &&
            typeof body.params?.requestState === 'string'
          ) {
            body.params.arguments.name = 'Mutated';
          }
        },
      }
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Original',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('arguments changed'),
    });
    expect(projects).toHaveLength(1);
  });

  test('rejects same-process replay after one execution', async () => {
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      { duplicateRetry: true }
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'One only',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('already used'),
    });
    expect(projects.filter(({ name }) => name === 'One only')).toHaveLength(1);
  });

  test('reissues invalid form input without preparing again', async () => {
    const getCost = vi.spyOn(pricing, 'getNextProjectCost');
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [
        { action: 'accept', content: {} },
        { action: 'accept', content: { confirm: true } },
      ],
      platform
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Reissued',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(getCost).toHaveBeenCalledTimes(2);
    expect(projects.filter(({ name }) => name === 'Reissued')).toHaveLength(1);
  });

  test('ignores a capable caller legacy token and still requires form approval', async () => {
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient([{ action: 'decline' }], platform);

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Cannot bypass',
        region: 'us-east-1',
        organization_id: organization.id,
        confirm_cost_id: 'legacy-token',
      },
    });

    expect(result.structuredContent).toEqual({ status: 'declined' });
    expect(projects).toHaveLength(1);
  });

  test('executes a zero-rate project without eliciting', async () => {
    const { organization, platform, projects } = paidProjectPlatform();
    organization.plan = 'free';
    projects.length = 0;
    const client = await setupClient([], platform);

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Included',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(projects.filter(({ name }) => name === 'Included')).toHaveLength(1);
  });

  test('allows a lower live rate than the approved maximum', async () => {
    vi.spyOn(pricing, 'getNextProjectCost')
      .mockResolvedValueOnce({
        type: 'project',
        recurrence: 'monthly',
        amount: 10,
      })
      .mockResolvedValueOnce({
        type: 'project',
        recurrence: 'monthly',
        amount: 0,
      });
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Lower rate',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(projects.filter(({ name }) => name === 'Lower rate')).toHaveLength(1);
  });

  test('rejects a higher live rate before creating', async () => {
    vi.spyOn(pricing, 'getNextProjectCost')
      .mockResolvedValueOnce({
        type: 'project',
        recurrence: 'monthly',
        amount: 10,
      })
      .mockResolvedValueOnce({
        type: 'project',
        recurrence: 'monthly',
        amount: 20,
      });
    const { organization, platform, projects } = paidProjectPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform
    );

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        name: 'Higher rate',
        region: 'us-east-1',
        organization_id: organization.id,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('approved_rate_stale'),
    });
    expect(projects).toHaveLength(1);
  });

  test('hides confirm_cost from discovery but keeps migration guidance callable', async () => {
    const { organization, platform } = paidProjectPlatform();
    const client = await setupClient([], platform);

    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: 'confirm_cost',
      arguments: { type: 'project', recurrence: 'monthly', amount: 10 },
    });
    const stillAlive = await client.callTool({
      name: 'get_cost',
      arguments: {
        type: 'project',
        organization_id: organization.id,
      },
    });

    const createProjectTool = tools.find(({ name }) => name === 'create_project');
    expect(tools.map(({ name }) => name)).toContain('get_cost');
    expect(tools.map(({ name }) => name)).not.toContain('confirm_cost');
    expect(createProjectTool?.inputSchema).not.toHaveProperty(
      'properties.confirm_cost_id'
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('elicitation flow'),
    });
    expect(stillAlive.isError).not.toBe(true);
  });

  test('creates a branch with the injected project and exact approved rate', async () => {
    const getBranchCost = vi.spyOn(pricing, 'getBranchCost');
    const assertRateAllowed = vi.spyOn(toolUtil, 'assertRateAllowed');
    const { branches, createBranch, platform } = branchingPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      { projectId: 'project-scoped' }
    );

    const result = await client.callTool({
      name: 'create_branch',
      arguments: { name: 'confirmed-branch' },
    });

    const approvedRate = {
      amount: pricing.BRANCH_COST_HOURLY,
      recurrence: 'hourly',
    };
    expect(result.isError).not.toBe(true);
    expect(getBranchCost).toHaveBeenCalledTimes(2);
    expect(getBranchCost).toHaveBeenNthCalledWith(1, {
      projectId: 'project-scoped',
    });
    expect(getBranchCost).toHaveBeenNthCalledWith(2, {
      projectId: 'project-scoped',
    });
    expect(assertRateAllowed).toHaveBeenCalledWith(
      { type: 'branch', ...approvedRate },
      approvedRate
    );
    expect(createBranch).toHaveBeenCalledWith('project-scoped', {
      name: 'confirmed-branch',
    });
    expect(branches).toHaveLength(1);
  });

  test.each([
    ['decline', 'declined'],
    ['cancel', 'cancelled'],
  ] as const)('%s creates no branch and returns %s', async (action, status) => {
    const { branches, platform } = branchingPlatform();
    const client = await setupClient([{ action }], platform, {
      projectId: 'project-scoped',
    });

    const result = await client.callTool({
      name: 'create_branch',
      arguments: { name: 'rejected-branch' },
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ status });
    expect(branches).toHaveLength(0);
  });

  test('binds the injected project to the signed branch arguments', async () => {
    const getBranchCost = vi.spyOn(pricing, 'getBranchCost');
    const { branches, createBranch, platform } = branchingPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      {
        projectId: 'project-original',
        continuationProjectId: 'project-mutated',
      }
    );

    const result = await client.callTool({
      name: 'create_branch',
      arguments: { name: 'bound-branch' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('arguments changed'),
    });
    expect(getBranchCost).toHaveBeenCalledTimes(1);
    expect(getBranchCost).toHaveBeenCalledWith({
      projectId: 'project-original',
    });
    expect(createBranch).not.toHaveBeenCalled();
    expect(branches).toHaveLength(0);
  });

  test('rejects a higher branch rate before creation', async () => {
    vi.spyOn(pricing, 'getBranchCost')
      .mockReturnValueOnce({
        type: 'branch',
        recurrence: 'hourly',
        amount: pricing.BRANCH_COST_HOURLY,
      })
      .mockReturnValueOnce({
        type: 'branch',
        recurrence: 'hourly',
        amount: 1,
      });
    const { branches, createBranch, platform } = branchingPlatform();
    const client = await setupClient(
      [{ action: 'accept', content: { confirm: true } }],
      platform,
      { projectId: 'project-scoped' }
    );

    const result = await client.callTool({
      name: 'create_branch',
      arguments: { name: 'stale-branch' },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('approved_rate_stale'),
    });
    expect(createBranch).not.toHaveBeenCalled();
    expect(branches).toHaveLength(0);
  });
});
