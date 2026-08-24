import { Client } from '@modelcontextprotocol/client';
import {
  createMcpServer,
  StreamTransport,
  type Tool,
} from '@supabase/mcp-utils';
import { expect, test } from 'vitest';

import { createElicitationRuntime } from '../elicitations/runtime.js';
import type {
  AccountOperations,
  BranchingOperations,
  CreationRate,
} from '../platform/types.js';
import { getAccountTools } from '../tools/account-tools.js';
import { getBranchingTools } from '../tools/branching-tools.js';
import {
  createCostConfirmationPolicy,
  routeCostConfirmation,
  routeLegacyConfirmation,
} from './cost-confirmation.js';

/**
 * A legacy caller must keep the bytes it has always received, whether or not
 * this connection also serves form elicitation to modern capable clients.
 *
 * The expected values below were measured, not written by hand: they are the
 * output of this exact fixture's platform objects against base main
 * (302d2ad7870352444ca0d71711622ab38a66e4ff), whose paid tools carry no
 * policy. Every field is fixed, so the strings are stable across runs.
 */
const BASE_CREATE_PROJECT_ENTRY =
  '{"name":"create_project","description":"Creates a new Supabase project. Always ask the user which organization to create the project in. The project can take a few minutes to initialize - use `get_project` to check the status.","inputSchema":{"type":"object","properties":{"name":{"description":"The name of the project","type":"string"},"region":{"description":"The region to create the project in.","type":"string","enum":["us-west-1","us-east-1","us-east-2","ca-central-1","eu-west-1","eu-west-2","eu-west-3","eu-central-1","eu-central-2","eu-north-1","ap-south-1","ap-southeast-1","ap-northeast-1","ap-northeast-2","ap-southeast-2","sa-east-1"]},"organization_id":{"type":"string"},"confirm_cost_id":{"description":"The cost confirmation ID. Call `confirm_cost` first.","type":"string"}},"required":["name","region","organization_id","confirm_cost_id"],"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false},"annotations":{"title":"Create project","readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}}';

const BASE_CREATE_BRANCH_ENTRY =
  '{"name":"create_branch","description":"Creates a development branch on a Supabase project. This will apply all migrations from the main project to a fresh branch database. Note that production data will not carry over. The branch will get its own project_id via the resulting project_ref. Use this ID to execute queries and migrations on the branch.","inputSchema":{"type":"object","properties":{"project_id":{"type":"string"},"name":{"description":"Name of the branch to create","default":"develop","type":"string"},"confirm_cost_id":{"description":"The cost confirmation ID. Call `confirm_cost` first.","type":"string"}},"required":["project_id","name","confirm_cost_id"],"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false},"annotations":{"title":"Create branch","readOnlyHint":false,"destructiveHint":false,"idempotentHint":false,"openWorldHint":false}}';

const BASE_CONFIRM_COST_ENTRY =
  '{"name":"confirm_cost","description":"Ask the user to confirm their understanding of the cost of creating a new project or branch. Call `get_cost` first. Returns a unique ID for this confirmation which should be passed to `create_project` or `create_branch`.","inputSchema":{"type":"object","properties":{"type":{"type":"string","enum":["project","branch"]},"recurrence":{"type":"string","enum":["hourly","monthly"]},"amount":{"type":"number"}},"required":["type","recurrence","amount"],"$schema":"http://json-schema.org/draft-07/schema#","additionalProperties":false},"annotations":{"title":"Confirm cost understanding","readOnlyHint":true,"destructiveHint":false,"idempotentHint":true,"openWorldHint":false}}';

const BASE_CONFIRM_COST_PROJECT_RESULT =
  '{"content":[{"type":"text","text":"{\\"confirmation_id\\":\\"BGoZHqqJd2JYMt+cWSDFH7qDeNkZZAwbTytJrHy7r+E=\\"}"}]}';

const BASE_CREATE_PROJECT_RESULT =
  '{"content":[{"type":"text","text":"{\\"id\\":\\"fixed-project-ref\\",\\"ref\\":\\"fixed-project-ref\\",\\"organization_id\\":\\"fixed-org\\",\\"organization_slug\\":\\"fixed-org\\",\\"name\\":\\"Fixture Project\\",\\"status\\":\\"UNKNOWN\\",\\"created_at\\":\\"2026-01-01T00:00:00.000Z\\",\\"region\\":\\"us-east-1\\"}"}]}';

const BASE_CREATE_BRANCH_RESULT =
  '{"content":[{"type":"text","text":"{\\"id\\":\\"fixed-branch\\",\\"name\\":\\"develop\\",\\"project_ref\\":\\"fixed-branch-ref\\",\\"parent_project_ref\\":\\"fixed-project-ref\\",\\"is_default\\":false,\\"persistent\\":false,\\"status\\":\\"CREATING_PROJECT\\",\\"created_at\\":\\"2026-01-01T00:00:00.000Z\\",\\"updated_at\\":\\"2026-01-01T00:00:00.000Z\\"}"}]}';

const PROJECT_RATE: CreationRate = {
  amount: 10,
  currency: 'USD',
  recurrence: 'monthly',
};
const BRANCH_RATE: CreationRate = {
  amount: 0.01344,
  currency: 'USD',
  recurrence: 'hourly',
};

const FIXED_PROJECT = {
  id: 'fixed-project-ref',
  ref: 'fixed-project-ref',
  organization_id: 'fixed-org',
  organization_slug: 'fixed-org',
  name: 'Fixture Project',
  status: 'UNKNOWN',
  created_at: '2026-01-01T00:00:00.000Z',
  region: 'us-east-1',
};

const FIXED_BRANCH = {
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
    return FIXED_PROJECT;
  },
  async pauseProject() {},
  async restoreProject() {},
  async getProjectCreationRate() {
    return PROJECT_RATE;
  },
};

const branching: BranchingOperations = {
  async listBranches() {
    return [];
  },
  async createBranch() {
    return FIXED_BRANCH;
  },
  async deleteBranch() {},
  async mergeBranch() {},
  async resetBranch() {},
  async rebaseBranch() {},
  async getBranchCreationRate() {
    return BRANCH_RATE;
  },
};

type CreateProjectArgs = {
  name: string;
  region: string;
  organization_id: string;
};

type CreateBranchArgs = { project_id: string; name: string };

/**
 * Serves the real paid tools with the cost policy attached, exactly as a
 * connection that also serves modern capable clients would.
 */
async function setupLegacyClient() {
  const runtime = createElicitationRuntime({
    actorId: 'actor-1',
    stateKey: 'legacy-bytes-continuation-key-long-enough',
    formDeliveryAvailable: true,
  });
  const capable = (ctx: Parameters<typeof runtime.availability>[0]) =>
    runtime.availability(ctx).formElicitation;

  const accountTools = getAccountTools({ account });
  const branchingTools = getBranchingTools({ branching });

  const tools: Record<string, Tool<any, any, any>> = {
    ...accountTools,
    ...branchingTools,
    confirm_cost: {
      ...accountTools.confirm_cost,
      policy: routeLegacyConfirmation({ capable }),
    },
    create_project: {
      ...accountTools.create_project,
      policy: routeCostConfirmation({
        capable,
        confirmed: runtime.policy(
          'create_project',
          createCostConfirmationPolicy<CreateProjectArgs>({
            action: 'create_project',
            available: capable,
            canonicalArguments: ({ name, region, organization_id }) => ({
              name,
              region,
              organization_id,
            }),
            subject: ({ name, organization_id }) => ({
              resourceName: name,
              account: { type: 'organization', id: organization_id },
            }),
            readRate: () => account.getProjectCreationRate('fixed-org'),
          })
        ),
      }),
    },
    create_branch: {
      ...branchingTools.create_branch,
      policy: routeCostConfirmation({
        capable,
        confirmed: runtime.policy(
          'create_branch',
          createCostConfirmationPolicy<CreateBranchArgs>({
            action: 'create_branch',
            available: capable,
            canonicalArguments: ({ project_id, name }) => ({
              project_id,
              name,
            }),
            subject: ({ project_id, name }) => ({
              resourceName: name,
              account: { type: 'parent_project', id: project_id },
            }),
            readRate: ({ project_id }) =>
              branching.getBranchCreationRate(project_id),
          })
        ),
      }),
    },
  };

  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();
  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const server = createMcpServer({
    name: 'supabase',
    version: '0.0.0',
    requestState: runtime.requestState,
    tools,
  });
  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    { capabilities: {} }
  );

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

async function entryOf(client: Client, name: string) {
  const { tools } = await client.listTools();
  return tools.find((entry) => entry.name === name);
}

/** Reads a confirmation id out of a legacy `confirm_cost` result. */
function confirmationIdOf(result: { content?: unknown }): string {
  const content = result.content;
  if (!Array.isArray(content)) {
    throw new Error('tool result carried no content');
  }
  const [entry] = content;
  if (
    entry === undefined ||
    typeof entry !== 'object' ||
    !('text' in entry) ||
    typeof entry.text !== 'string'
  ) {
    throw new Error('tool result content is not text');
  }
  const parsed: unknown = JSON.parse(entry.text);
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !('confirmation_id' in parsed) ||
    typeof parsed.confirmation_id !== 'string'
  ) {
    throw new Error('tool result carried no confirmation id');
  }
  return parsed.confirmation_id;
}

test('a legacy caller keeps base discovery bytes for the paid tools', async () => {
  const client = await setupLegacyClient();

  expect(JSON.stringify(await entryOf(client, 'create_project'))).toBe(
    BASE_CREATE_PROJECT_ENTRY
  );
  expect(JSON.stringify(await entryOf(client, 'create_branch'))).toBe(
    BASE_CREATE_BRANCH_ENTRY
  );
  expect(JSON.stringify(await entryOf(client, 'confirm_cost'))).toBe(
    BASE_CONFIRM_COST_ENTRY
  );
});

test('a legacy caller keeps base call bytes through the confirmation pair', async () => {
  const client = await setupLegacyClient();

  const projectConfirmation = await client.callTool({
    name: 'confirm_cost',
    arguments: { type: 'project', recurrence: 'monthly', amount: 10 },
  });
  expect(JSON.stringify(projectConfirmation)).toBe(
    BASE_CONFIRM_COST_PROJECT_RESULT
  );

  const confirmationId = confirmationIdOf(projectConfirmation);

  expect(
    JSON.stringify(
      await client.callTool({
        name: 'create_project',
        arguments: {
          name: 'Fixture Project',
          region: 'us-east-1',
          organization_id: 'fixed-org',
          confirm_cost_id: confirmationId,
        },
      })
    )
  ).toBe(BASE_CREATE_PROJECT_RESULT);

  const branchConfirmation = await client.callTool({
    name: 'confirm_cost',
    arguments: { type: 'branch', recurrence: 'hourly', amount: 0.01344 },
  });
  const branchConfirmationId = confirmationIdOf(branchConfirmation);

  expect(
    JSON.stringify(
      await client.callTool({
        name: 'create_branch',
        arguments: {
          project_id: 'fixed-project-ref',
          name: 'develop',
          confirm_cost_id: branchConfirmationId,
        },
      })
    )
  ).toBe(BASE_CREATE_BRANCH_RESULT);
});
