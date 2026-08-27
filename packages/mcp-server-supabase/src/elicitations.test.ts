import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import type {
  ClientCapabilities,
  ElicitResult,
  ServerContext,
} from '@modelcontextprotocol/server';
import { StreamTransport } from '@supabase/mcp-utils';
import { describe, expect, test } from 'vitest';

import {
  BRANCH_RATE,
  createCostPlatform,
  FIXED_PROJECT,
  PROJECT_RATE,
} from '../test/cost-platform.js';
import {
  canonicalArgumentsDigest,
  createSignedStateCodec,
  createStateSigner,
} from './elicitations/codec.js';
import type { ContinuationState } from './elicitations/state.js';
import type { CreationRate } from './platform/types.js';
import { COST_CONFIRMATION_POLICY_ID } from './policies/cost-confirmation.js';
import { createSupabaseMcpServer } from './server.js';
import { createSupabaseMcpHandler } from './transports/http.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const STATE_KEY = 'cost-policy-continuation-key-long-enough';
const ACTOR_ID = 'approver-1';

type SetupOptions = {
  /** Client capabilities. `{}` is a client that declares nothing. */
  capabilities?: ClientCapabilities;
  clientName?: string;
  optOut?: boolean;
  readOnly?: boolean;
  answers?: ElicitResult[];
  /** Continuation state to attach to every tool call this client makes. */
  requestState?: string;
};

/** A modern hosted connection whose serving path can deliver a form. */
async function setupModern(options: SetupOptions = {}) {
  const cost = createCostPlatform();
  const elicited: string[] = [];
  const handler = createSupabaseMcpHandler({
    platform: cost.platform,
    features: ['account', 'branching'],
    readOnly: options.readOnly,
    elicitation: {
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
      formDeliveryAvailable: true,
      optOut: options.optOut,
    },
  });

  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      if (options.requestState === undefined) {
        return handler.fetch(new Request(url, init));
      }

      // Stands in for a client redeeming state a previous deployment issued.
      const body = await new Request(url, init).json();
      if (body?.method === 'tools/call') {
        body.params.requestState = options.requestState;
      }
      return handler.fetch(
        new Request(url, { ...init, body: JSON.stringify(body) })
      );
    },
  });
  const capabilities = options.capabilities ?? { elicitation: {} };
  const client = new Client(
    { name: options.clientName ?? 'cost-policy-test-client', version: '1.0.0' },
    {
      capabilities,
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );

  const answers = options.answers ?? [{ action: 'accept' }];
  // A client that declares no elicitation cannot register a handler for one,
  // which is the same reason it must never be sent a form.
  if (capabilities.elicitation !== undefined) {
    client.setRequestHandler('elicitation/create', async (request) => {
      const { message } = request.params;
      elicited.push(typeof message === 'string' ? message : '');
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error('no elicitation answer left');
      }
      return answer;
    });
  }

  await client.connect(transport);

  return { client, elicited, ...cost };
}

/**
 * A classic hosted connection: the same server options, over a transport that
 * carries no per-request envelope.
 */
async function setupClassic(capabilities: ClientCapabilities) {
  const cost = createCostPlatform();
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();
  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const server = createSupabaseMcpServer({
    platform: cost.platform,
    features: ['account', 'branching'],
    elicitation: {
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
      formDeliveryAvailable: true,
    },
  });
  const client = new Client(
    { name: 'classic-client', version: '1.0.0' },
    { capabilities }
  );
  let elicits = 0;
  client.setRequestHandler('elicitation/create', async () => {
    elicits += 1;
    return { action: 'accept' };
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, elicitCount: () => elicits, ...cost };
}

function textOf(result: { content?: unknown }): string {
  const content = result.content;
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      'text' in entry &&
      typeof entry.text === 'string'
        ? entry.text
        : ''
    )
    .join('');
}

function expectFinalRateReadImmediatelyBeforeCreation(
  calls: string[],
  rateRead: string,
  creation: string
) {
  const creationIndex = calls.indexOf(creation);
  expect(creationIndex).toBeGreaterThan(0);
  expect(calls.lastIndexOf(rateRead)).toBe(creationIndex - 1);
}

const PROJECT_ARGS = {
  name: 'Fixture Project',
  region: 'us-east-1',
  organization_id: 'fixed-org',
};

const BRANCH_ARGS = { project_id: 'fixed-project-ref', name: 'develop' };

/**
 * State a previous deployment issued: same key, same actor, version 1 of this
 * policy, and the Boolean the old contract read consent from.
 */
async function version1State(args: Record<string, unknown>) {
  const codec = createSignedStateCodec<ContinuationState & { jti: string }>({
    signer: createStateSigner(STATE_KEY),
    bind: (ctx) => `${ACTOR_ID}\u0000${ctx.mcpReq.method}`,
    clock: Date.now,
  });
  const issuedAt = Math.floor(Date.now() / 1_000);

  return codec.mint(
    {
      v: 1,
      policy: COST_CONFIRMATION_POLICY_ID,
      policyVersion: 1,
      tool: 'create_project',
      argsDigest: await canonicalArgumentsDigest(args),
      proposal: { confirm: false },
      jti: 'version-1-state',
      iat: issuedAt,
      exp: issuedAt + 120,
    },
    { mcpReq: { method: 'tools/call' } } as unknown as ServerContext
  );
}

describe('modern capable creation', () => {
  test('an accepted project is created with its business output unchanged', async () => {
    const { client, elicited } = await setupModern();

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(elicited).toHaveLength(1);
    expect(elicited[0]).toContain(
      `${PROJECT_RATE.amount} ${PROJECT_RATE.currency}`
    );
    expect(result.structuredContent).toStrictEqual(FIXED_PROJECT);
    // Explicit text beside the unchanged business output: what the client
    // reported, and what the server did about it.
    expect(textOf(result)).toContain('The client reported');
    expect(textOf(result)).toContain('10 USD per month');
    expect(textOf(result)).toContain('"Fixture Project" was created');
  });

  test('an accepted branch is created', async () => {
    const { client, elicited, calls } = await setupModern();

    const result = await client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(elicited[0]).toContain(
      `${BRANCH_RATE.amount} ${BRANCH_RATE.currency}`
    );
    expect(elicited[0]).toContain('per hour');
    expect(calls).toContain('create_branch');
    expect(textOf(result)).toContain('The client reported');
    expect(textOf(result)).toContain('0.01344 USD per hour');
    expect(textOf(result)).toContain('"develop" was created');
    expect(result.structuredContent).toMatchObject({ name: 'develop' });
  });

  test('a declined branch reports the client outcome and creates nothing', async () => {
    const { client, calls } = await setupModern({
      answers: [{ action: 'decline' }],
    });

    const result = await client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(result.structuredContent).toStrictEqual({ status: 'declined' });
    expect(textOf(result)).toContain('The client reported');
    expect(textOf(result)).toContain('no branch was created');
    expect(calls).not.toContain('create_branch');
  });

  test('a cancelled branch stays distinct from a declined one', async () => {
    const { client, calls } = await setupModern({
      answers: [{ action: 'cancel' }],
    });

    const result = await client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(result.structuredContent).toStrictEqual({ status: 'cancelled' });
    expect(textOf(result)).toContain('dismissed');
    expect(calls).not.toContain('create_branch');
  });

  test('a declined project reports the client outcome and creates nothing', async () => {
    const { client, calls } = await setupModern({
      answers: [{ action: 'decline' }],
    });

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.structuredContent).toStrictEqual({ status: 'declined' });
    expect(textOf(result)).toContain('The client reported');
    expect(textOf(result)).toContain('no project was created');
    expect(calls).not.toContain('create_project');
  });

  test('a cancelled project stays distinct from a declined one', async () => {
    const { client, calls } = await setupModern({
      answers: [{ action: 'cancel' }],
    });

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.structuredContent).toStrictEqual({ status: 'cancelled' });
    expect(textOf(result)).toContain('dismissed');
    expect(calls).not.toContain('create_project');
  });

  test('a zero authoritative rate creates without asking, and is still guarded', async () => {
    const { client, calls, elicited, projectRates } = await setupModern();
    const free: CreationRate = { ...PROJECT_RATE, amount: 0 };
    projectRates.push(free, free);

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(elicited).toHaveLength(0);
    expect(result.structuredContent).toStrictEqual(FIXED_PROJECT);
    // Nothing was asked, so nothing is reported as accepted.
    expect(textOf(result)).toContain('no confirmation was requested');
    expect(textOf(result)).not.toContain('client reported');
    expect(textOf(result)).toContain('was created');
    expectFinalRateReadImmediatelyBeforeCreation(
      calls,
      'read_project_rate',
      'create_project'
    );
  });
});

describe('the final authoritative check', () => {
  test('the rate is read immediately before the creation call', async () => {
    const { client, calls } = await setupModern();

    await client.callTool({ name: 'create_project', arguments: PROJECT_ARGS });

    // The production rate read and create call are source-adjacent. That static
    // invariant does not prove closure of every awaited scheduling gap; this
    // trace only checks platform-operation ordering.
    expectFinalRateReadImmediatelyBeforeCreation(
      calls,
      'read_project_rate',
      'create_project'
    );
  });

  test('an equal or lower final rate proceeds', async () => {
    const { client, calls, projectRates } = await setupModern();
    projectRates.push(PROJECT_RATE, { ...PROJECT_RATE, amount: 4 });

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).not.toBe(true);
    expect(calls).toContain('create_project');
  });

  test.each<[string, CreationRate]>([
    ['a higher amount', { ...PROJECT_RATE, amount: 11 }],
    [
      'a changed recurrence',
      { ...PROJECT_RATE, amount: 1, recurrence: 'hourly' },
    ],
    ['a changed currency', { ...PROJECT_RATE, amount: 1, currency: 'EUR' }],
  ])(
    '%s creates nothing and reports a stale approval',
    async (_case, final) => {
      const { client, calls, projectRates } = await setupModern();
      projectRates.push(PROJECT_RATE, final);

      const result = await client.callTool({
        name: 'create_project',
        arguments: PROJECT_ARGS,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('approved_rate_stale');
      expect(calls).not.toContain('create_project');
    }
  );

  test('a branch approval is guarded by the branch rate', async () => {
    const { client, calls, branchRates } = await setupModern();
    branchRates.push(BRANCH_RATE, { ...BRANCH_RATE, amount: 0.02 });

    const result = await client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('approved_rate_stale');
    expect(calls).not.toContain('create_branch');
  });
});

describe('capable discovery and the retired token', () => {
  test('discovery omits confirm_cost and the legacy token', async () => {
    const { client } = await setupModern();

    const { tools } = await client.listTools();
    const createProject = tools.find(
      (entry) => entry.name === 'create_project'
    );

    expect(tools.map((entry) => entry.name)).not.toContain('confirm_cost');
    expect(
      Object.keys(createProject?.inputSchema.properties ?? {})
    ).toStrictEqual(['name', 'region', 'organization_id']);
    expect(createProject?.outputSchema).toBeDefined();
  });

  test('a direct call to confirm_cost answers with migration guidance', async () => {
    const { client } = await setupModern();

    const result = await client.callTool({
      name: 'confirm_cost',
      arguments: { type: 'project', recurrence: 'monthly', amount: 10 },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('create_project');
    expect(textOf(result)).not.toContain('confirmation_id');
  });

  test('a supplied legacy token is ignored and cannot bypass the confirmation', async () => {
    const { client, elicited, calls } = await setupModern({
      answers: [{ action: 'decline' }],
    });

    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        ...PROJECT_ARGS,
        confirm_cost_id: 'a-token-from-the-other-lane',
      },
    });

    // The token neither bypasses the question nor fails the call: it is
    // dropped before anything binds to it.
    expect(elicited).toHaveLength(1);
    expect(result.structuredContent).toStrictEqual({ status: 'declined' });
    expect(calls).not.toContain('create_project');
  });

  test('the flow does not read the client label', async () => {
    // One contract instead of a compatibility table: a client whose name
    // matches nothing this package knows still gets the form lane, because the
    // decision reads capabilities and the serving path only.
    const { client, elicited } = await setupModern({
      clientName: 'some-client-nobody-listed',
    });

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(elicited).toHaveLength(1);
    expect(result.structuredContent).toStrictEqual(FIXED_PROJECT);
  });
});

describe('read-only servers', () => {
  test('a call fails read-only without reading a rate or asking', async () => {
    const { client, elicited, calls } = await setupModern({ readOnly: true });

    // The tool is policy-free here, so it takes the legacy shape it has
    // always had in read-only mode, token included.
    const result = await client.callTool({
      name: 'create_project',
      arguments: { ...PROJECT_ARGS, confirm_cost_id: 'any-token' },
    });

    // Policy resolution runs before a tool's own checks, so a policy here
    // would price and prompt for a creation that cannot happen.
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('read-only mode');
    expect(elicited).toHaveLength(0);
    expect(calls).toStrictEqual([]);
  });
});

describe('rolling deployment', () => {
  test('state issued by policy version 1 creates nothing and says so', async () => {
    // The one case kept from the Boolean contract, and it is kept as a
    // version rejection rather than a Boolean one: the old payload carried
    // `confirm: false`, and this policy refuses it without ever looking at
    // that content. Version binding itself belongs to the runtime; what is
    // proved here is the product consequence.
    const { client, calls } = await setupModern({
      requestState: await version1State(PROJECT_ARGS),
    });

    const result = await client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Run the tool again');
    expect(textOf(result)).toContain('nothing was created');
    expect(calls).not.toContain('create_project');
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('surfaces that stay on the legacy contract', () => {
  test('a modern client that declares no elicitation keeps confirm_cost', async () => {
    const { client } = await setupModern({ capabilities: {} });

    const { tools } = await client.listTools();
    const createProject = tools.find(
      (entry) => entry.name === 'create_project'
    );

    expect(tools.map((entry) => entry.name)).toContain('confirm_cost');
    expect(createProject?.inputSchema.required).toContain('confirm_cost_id');
    expect(createProject?.outputSchema).toBeUndefined();
  });

  test('a URL-only elicitation declaration is not form support', async () => {
    const { client } = await setupModern({
      capabilities: { elicitation: { url: {} } },
    });

    const { tools } = await client.listTools();
    expect(tools.map((entry) => entry.name)).toContain('confirm_cost');
  });

  test('an opted-out connection keeps confirm_cost for a capable client', async () => {
    const { client } = await setupModern({ optOut: true });

    const { tools } = await client.listTools();
    const createProject = tools.find(
      (entry) => entry.name === 'create_project'
    );

    expect(tools.map((entry) => entry.name)).toContain('confirm_cost');
    expect(createProject?.inputSchema.required).toContain('confirm_cost_id');
    expect(createProject?.outputSchema).toBeUndefined();
  });

  test('a classic client declaring form still gets confirm_cost and no form', async () => {
    const { client, elicitCount } = await setupClassic({
      elicitation: { form: {} },
    });

    const { tools } = await client.listTools();
    const createProject = tools.find(
      (entry) => entry.name === 'create_project'
    );

    expect(tools.map((entry) => entry.name)).toContain('confirm_cost');
    expect(createProject?.inputSchema.required).toContain('confirm_cost_id');
    expect(elicitCount()).toBe(0);
  });

  test('the legacy lane still creates through the confirmation pair', async () => {
    const { client, calls } = await setupModern({ capabilities: {} });

    const cost = await client.callTool({
      name: 'get_cost',
      arguments: { type: 'project', organization_id: 'fixed-org' },
    });
    const confirmation = await client.callTool({
      name: 'confirm_cost',
      arguments: JSON.parse(textOf(cost)),
    });
    const result = await client.callTool({
      name: 'create_project',
      arguments: {
        ...PROJECT_ARGS,
        confirm_cost_id: JSON.parse(textOf(confirmation)).confirmation_id,
      },
    });

    expect(result.isError).not.toBe(true);
    expect(JSON.parse(textOf(result))).toStrictEqual(FIXED_PROJECT);
    expect(result.structuredContent).toBeUndefined();
    expect(calls).toContain('create_project');
  });
});
