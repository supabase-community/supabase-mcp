import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  createRequestStateCodec,
  type ClientCapabilities,
  type ElicitResult,
  type Server,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { StreamTransport } from '@supabase/mcp-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  BRANCH_RATE,
  createCostPlatform,
  FIXED_BRANCH,
  FIXED_PROJECT,
  PROJECT_RATE,
} from '../test/cost-platform.js';
import {
  type CostConfirmationResolution,
  createCreationOutcomeText,
  type CreationRate,
} from './cost-confirmation.js';
import {
  createSupabaseMcpServer,
  type SupabaseMcpServerOptions,
} from './server.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const STATE_KEY = 'sdk-cost-confirmation-key-long-enough';
const PROJECT_ARGS = {
  name: 'Fixture Project',
  region: 'us-east-1',
  organization_id: 'fixed-org',
};
const BRANCH_ARGS = { project_id: 'fixed-project-ref', name: 'develop' };

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

type RequestBody = {
  method?: string;
  params?: {
    arguments?: Record<string, unknown>;
    inputResponses?: Record<string, unknown>;
    requestState?: string;
  };
};

type SetupOptions = {
  answers?: ElicitResult[];
  capabilities?: ClientCapabilities;
  optOut?: boolean;
  formDeliveryAvailable?: boolean;
  actor?: { value: string };
  methodBinding?: { value?: string };
  projectId?: string;
  readOnly?: boolean;
  enabled?: () => boolean;
  onContinuation?: (body: RequestBody) => void;
};

async function setupModern(options: SetupOptions = {}) {
  const cost = createCostPlatform();
  const actor = options.actor ?? { value: 'actor-1' };
  const bindMethods: string[] = [];
  const policyCalls: Array<{
    decision: string;
    telemetry: {
      interactionId?: string;
      outcome?: string;
      reason?: string;
    };
  }> = [];
  const serverOptions: SupabaseMcpServerOptions = {
    platform: cost.platform,
    features: ['account', 'branching'],
    projectId: options.projectId,
    readOnly: options.readOnly,
  };
  const handler = createMcpHandler(
    () =>
      createSupabaseMcpServer({
        ...serverOptions,
        elicitation: {
          key: STATE_KEY,
          bind(ctx) {
            bindMethods.push(ctx.mcpReq.method);
            return `${actor.value}\0${
              options.methodBinding?.value ?? ctx.mcpReq.method
            }`;
          },
          readProjectCreationRate: cost.readProjectCreationRate,
          readBranchCreationRate: cost.readBranchCreationRate,
          formDeliveryAvailable: options.formDeliveryAvailable ?? true,
          optOut: options.optOut,
          enabled: options.enabled ?? (() => true),
          onToolPolicyCall: (details) => {
            policyCalls.push(details);
          },
        },
      }),
    { legacy: 'reject' }
  );
  const requestStates: string[] = [];
  const forcedRequestState: { value?: string } = {};
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      const body = (await new Request(url, init).json()) as RequestBody;
      if (
        body.method === 'tools/call' &&
        body.params !== undefined &&
        body.params.requestState === undefined &&
        forcedRequestState.value !== undefined
      ) {
        body.params.requestState = forcedRequestState.value;
      }
      if (typeof body.params?.requestState === 'string') {
        requestStates.push(body.params.requestState);
        options.onContinuation?.(body);
      }
      return handler.fetch(
        new Request(url, { ...init, body: JSON.stringify(body) })
      );
    },
  });
  const client = new Client(
    { name: 'cost-policy-client', version: '1.0.0' },
    {
      capabilities: options.capabilities ?? { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );
  const elicitationRequests: unknown[] = [];
  const answers = options.answers ?? [{ action: 'accept' }];
  if ((options.capabilities ?? { elicitation: {} }).elicitation !== undefined) {
    client.setRequestHandler('elicitation/create', async (request) => {
      elicitationRequests.push(request.params);
      const answer = answers.shift();
      if (answer === undefined) {
        throw new Error('no elicitation answer left');
      }
      return answer;
    });
  }

  await client.connect(transport);
  cleanups.push(
    () => client.close(),
    () => handler.close()
  );
  return {
    client,
    elicitationRequests,
    requestStates,
    policyCalls,
    bindMethods,
    forcedRequestState,
    ...cost,
  };
}

function textOf(result: { content?: unknown }): string {
  if (!Array.isArray(result.content)) {
    return '';
  }
  return result.content
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

function decodeState(state: string): Record<string, unknown> {
  const body = state.split('.')[1];
  if (body === undefined) {
    throw new Error('request state has no body');
  }
  const decoded = JSON.parse(
    Buffer.from(body, 'base64url').toString('utf8')
  ) as { p?: Record<string, unknown> };
  if (decoded.p === undefined) {
    throw new Error('request state has no payload');
  }
  return decoded.p;
}
async function sealState(payload: Record<string, unknown>) {
  const codec = createRequestStateCodec<unknown>({
    key: STATE_KEY,
    ttlSeconds: 120,
    bind: (ctx) => `actor-1\0${ctx.mcpReq.method}`,
  });
  return codec.mint(payload, {
    mcpReq: { method: 'tools/call' },
  } as unknown as ServerContext);
}

describe('direct SDK cost confirmation', () => {
  test('accepts an action-only project confirmation with sealed policy state', async () => {
    const setup = await setupModern();
    await setup.client.listTools();

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(setup.elicitationRequests).toStrictEqual([
      expect.objectContaining({
        mode: 'form',
        requestedSchema: { type: 'object', properties: {} },
      }),
    ]);
    expect(JSON.stringify(setup.elicitationRequests[0])).toContain(
      '10 USD per month'
    );
    expect(result.structuredContent).toStrictEqual(FIXED_PROJECT);
    expect(textOf(result)).toContain('The client reported');
    expect(setup.calls).toStrictEqual([
      'read_project_rate',
      'read_project_rate',
      'create_project',
    ]);

    const state = decodeState(setup.requestStates[0]!);
    expect(state).toMatchObject({
      policy: 'supabase.cost_confirmation',
      tool: 'create_project',
      approvedRate: PROJECT_RATE,
      policyVersion: 2,
    });
    expect(state.argsDigest).toEqual(expect.any(String));
    expect(state.interactionId).toEqual(expect.any(String));
  });
  test('validates an accepted branch against the advertised modern output schema', async () => {
    const setup = await setupModern();
    await setup.client.listTools();

    const result = await setup.client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });
    expect(result.isError, textOf(result)).not.toBe(true);

    expect(result.structuredContent).toStrictEqual(FIXED_BRANCH);
  });
  test('accept action ignores irrelevant response content', async () => {
    const setup = await setupModern({
      answers: [
        {
          action: 'accept',
          content: { confirm: false, approved: 'no' },
        },
      ],
    });

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.structuredContent).toStrictEqual(FIXED_PROJECT);
    expect(setup.calls).toContain('create_project');
  });

  test('accepts a branch at the authoritative hourly rate', async () => {
    const setup = await setupModern();

    const result = await setup.client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(textOf(result)).toContain('0.01344 USD per hour');
    expect(setup.calls).toStrictEqual([
      'read_branch_rate',
      'read_branch_rate',
      'create_branch',
    ]);
  });
  test('accepts a projectId-injected branch and binds the injected project', async () => {
    const setup = await setupModern({ projectId: 'fixed-project-ref' });
    const { tools } = await setup.client.listTools();
    const createBranch = tools.find((tool) => tool.name === 'create_branch');

    const result = await setup.client.callTool({
      name: 'create_branch',
      arguments: { name: 'develop' },
    });

    expect(createBranch?.inputSchema.properties).not.toHaveProperty(
      'project_id'
    );
    expect(result.isError).not.toBe(true);
    expect(setup.calls).toStrictEqual([
      'read_branch_rate',
      'read_branch_rate',
      'create_branch',
    ]);
  });

  test('rejects injected branch argument drift', async () => {
    const setup = await setupModern({
      projectId: 'fixed-project-ref',
      onContinuation(body) {
        if (body.params?.arguments !== undefined) {
          body.params.arguments.name = 'changed-after-prompt';
        }
      },
    });

    const result = await setup.client.callTool({
      name: 'create_branch',
      arguments: { name: 'develop' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('arguments changed');
    expect(setup.calls).not.toContain('create_branch');
  });

  test('keeps decline and cancel distinct and creates nothing', async () => {
    for (const action of ['decline', 'cancel'] as const) {
      const setup = await setupModern({ answers: [{ action }] });
      await setup.client.listTools();
      const result = await setup.client.callTool({
        name: 'create_project',
        arguments: PROJECT_ARGS,
      });

      expect(result.structuredContent).toStrictEqual({
        status: action === 'decline' ? 'declined' : 'cancelled',
      });
      expect(textOf(result)).toContain(
        action === 'decline' ? 'declined' : 'dismissed'
      );
      expect(setup.calls).not.toContain('create_project');
    }
  });
  test.each([
    [
      'missing',
      (body: RequestBody) => {
        if (body.params !== undefined) {
          delete body.params.inputResponses;
        }
      },
    ],
    [
      'malformed',
      (body: RequestBody) => {
        if (body.params !== undefined) {
          body.params.inputResponses = {
            cost_confirmation: { malformed: true },
          };
        }
      },
    ],
    [
      'raw boolean',
      (body: RequestBody) => {
        if (body.params !== undefined) {
          body.params.inputResponses = { cost_confirmation: true };
        }
      },
    ],
  ])(
    'fails closed with rerun guidance for a %s response',
    async (_case, mutate) => {
      const setup = await setupModern({ onContinuation: mutate });

      const result = await setup.client.callTool({
        name: 'create_project',
        arguments: PROJECT_ARGS,
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('no answer');
      expect(textOf(result)).toContain('Run the tool again');
      expect(setup.calls).not.toContain('create_project');
    }
  );

  test('executes a zero authoritative rate without asking and still rechecks', async () => {
    const setup = await setupModern();
    const free: CreationRate = { ...PROJECT_RATE, amount: 0 };
    setup.projectRates.push(free, free);

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(setup.elicitationRequests).toHaveLength(0);
    expect(textOf(result)).toContain('no confirmation was requested');
    expect(setup.calls).toStrictEqual([
      'read_project_rate',
      'read_project_rate',
      'create_project',
    ]);
  });

  test('rejects a stale final authoritative rate before creation', async () => {
    const setup = await setupModern();
    setup.projectRates.push(PROJECT_RATE, { ...PROJECT_RATE, amount: 11 });

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('approved_rate_stale');
    expect(setup.calls).not.toContain('create_project');
  });

  test('rejects request-state tampering before policy re-entry', async () => {
    const setup = await setupModern({
      onContinuation(body) {
        const state = body.params?.requestState;
        if (state !== undefined) {
          const signatureStart = state.lastIndexOf('.') + 1;
          expect(signatureStart).toBeGreaterThan(0);
          const signatureChar = state[signatureStart];
          expect(signatureChar).toEqual(expect.any(String));
          const replacement = signatureChar === 'A' ? 'B' : 'A';
          const tampered = `${state.slice(0, signatureStart)}${replacement}${state.slice(signatureStart + 1)}`;
          expect(tampered).not.toBe(state);
          body.params!.requestState = tampered;
        }
      },
    });

    await expect(
      setup.client.callTool({ name: 'create_project', arguments: PROJECT_ARGS })
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
    });
    expect(setup.calls).not.toContain('create_project');
  });
  test('rejects valid state when redeemed by another tool', async () => {
    const setup = await setupModern();
    await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });
    setup.forcedRequestState.value = setup.requestStates[0];

    const result = await setup.client.callTool({
      name: 'create_branch',
      arguments: BRANCH_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('incompatible policy version');
    expect(setup.calls).not.toContain('create_branch');
    expect(setup.calls).not.toContain('read_branch_rate');
  });

  test.each([
    [
      'wrong policy identity',
      (payload: Record<string, unknown>) => {
        payload.policy = 'another.policy';
      },
    ],
    [
      'malformed approved rate',
      (payload: Record<string, unknown>) => {
        payload.approvedRate = {
          amount: '10',
          currency: 'USD',
          recurrence: 'monthly',
        };
      },
    ],
    [
      'missing current field',
      (payload: Record<string, unknown>) => {
        delete payload.argsDigest;
      },
    ],
  ])('rejects a signed payload with %s', async (_case, mutate) => {
    const setup = await setupModern();
    await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });
    const payload = decodeState(setup.requestStates[0]!);
    mutate(payload);
    setup.forcedRequestState.value = await sealState(payload);
    const callCount = setup.calls.length;

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('incompatible policy version');
    expect(setup.calls).toHaveLength(callCount);
  });

  test('rejects request state after the explicit 120 second TTL', async () => {
    // Pre-merge security delta: the SDK compares integer Unix seconds, so the
    // effective expiry boundary is floor-second based. Keep the configured TTL
    // at exactly 120 seconds and review that SDK boundary as the security delta.
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const setup = await setupModern({
      onContinuation() {
        now += 121_000;
      },
    });

    await expect(
      setup.client.callTool({ name: 'create_project', arguments: PROJECT_ARGS })
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
    });
  });

  test('binds state to the actor and tools/call method', async () => {
    const actor = { value: 'actor-1' };
    const setup = await setupModern({
      actor,
      onContinuation() {
        actor.value = 'actor-2';
      },
    });

    await expect(
      setup.client.callTool({ name: 'create_project', arguments: PROJECT_ARGS })
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
    });
    expect(setup.bindMethods).toStrictEqual(['tools/call', 'tools/call']);
  });
  test('rejects state under a different method binding', async () => {
    const methodBinding: { value?: string } = {};
    const setup = await setupModern({
      methodBinding,
      onContinuation() {
        methodBinding.value = 'prompts/get';
      },
    });

    await expect(
      setup.client.callTool({ name: 'create_project', arguments: PROJECT_ARGS })
    ).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
    });
    expect(setup.bindMethods).toStrictEqual(['tools/call', 'tools/call']);
  });

  test('rejects argument drift without creating', async () => {
    const setup = await setupModern({
      onContinuation(body) {
        if (body.params?.arguments !== undefined) {
          body.params.arguments.name = 'changed-after-prompt';
        }
      },
    });

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('arguments changed');
    expect(setup.calls).not.toContain('create_project');
  });
  test('honors the direct kill switch again on redemption', async () => {
    let enabled = true;
    const setup = await setupModern({
      enabled: () => enabled,
      onContinuation() {
        enabled = false;
      },
    });

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('currently unavailable');
    expect(setup.calls).not.toContain('create_project');
  });

  test('reports one interactionId across both policy rounds', async () => {
    const setup = await setupModern();

    await setup.client.callTool({
      name: 'create_project',
      arguments: PROJECT_ARGS,
    });

    await vi.waitFor(() => expect(setup.policyCalls).toHaveLength(2));
    const ids = setup.policyCalls.map((call) => call.telemetry.interactionId);
    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toBe(ids[0]);
  });
  test('hosted readOnly performs no rate read or elicitation', async () => {
    const setup = await setupModern({ readOnly: true });

    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: { ...PROJECT_ARGS, confirm_cost_id: 'unused' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('read-only mode');
    expect(setup.calls).toStrictEqual([]);
    expect(setup.elicitationRequests).toStrictEqual([]);
  });
  test('correlates success text by stable resource identity', () => {
    const outcome = createCreationOutcomeText<{ ref: string }>(
      'create_project',
      (project) => project.ref
    );
    const resolution = (amount: number): CostConfirmationResolution => ({
      maximumCreationRate: { ...PROJECT_RATE, amount },
    });
    outcome.record({ ref: 'project-a' }, resolution(10));
    outcome.record({ ref: 'project-b' }, resolution(5));

    expect(outcome.render({ ref: 'project-b' }, 'second')).toContain('5 USD');
    expect(outcome.render({ ref: 'project-a' }, 'first')).toContain('10 USD');
  });
});

describe('hosted elicitation construction', () => {
  test.each([
    'bind',
    'readProjectCreationRate',
    'readBranchCreationRate',
    'enabled',
    'formDeliveryAvailable',
  ])('rejects a missing %s dependency', (field) => {
    const cost = createCostPlatform();
    const elicitation: Record<string, unknown> = {
      key: STATE_KEY,
      bind: (ctx: ServerContext) => `actor-1\0${ctx.mcpReq.method}`,
      readProjectCreationRate: cost.readProjectCreationRate,
      readBranchCreationRate: cost.readBranchCreationRate,
      formDeliveryAvailable: true,
      enabled: () => true,
    };
    delete elicitation[field];

    expect(() =>
      createSupabaseMcpServer({
        platform: cost.platform,
        elicitation,
      } as unknown as SupabaseMcpServerOptions)
    ).toThrow(field);
  });

  test('keeps SDK key validation fail-closed', () => {
    const cost = createCostPlatform();
    expect(() =>
      createSupabaseMcpServer({
        platform: cost.platform,
        elicitation: {
          key: undefined,
          bind: (ctx: ServerContext) => `actor-1\0${ctx.mcpReq.method}`,
          readProjectCreationRate: cost.readProjectCreationRate,
          readBranchCreationRate: cost.readBranchCreationRate,
          formDeliveryAvailable: true,
          enabled: () => true,
        },
      } as unknown as SupabaseMcpServerOptions)
    ).toThrow();
  });
});

describe('legacy cost compatibility', () => {
  test('keeps the token schema, suppresses output, and executes the confirmation pair', async () => {
    const setup = await setupModern({ capabilities: {} });
    const { tools } = await setup.client.listTools();
    const createProject = tools.find((tool) => tool.name === 'create_project');

    expect(tools.map((tool) => tool.name)).toContain('confirm_cost');
    expect(createProject?.inputSchema.required).toContain('confirm_cost_id');
    expect(createProject?.outputSchema).toBeUndefined();

    const cost = await setup.client.callTool({
      name: 'get_cost',
      arguments: { type: 'project', organization_id: 'fixed-org' },
    });
    const confirmation = await setup.client.callTool({
      name: 'confirm_cost',
      arguments: JSON.parse(textOf(cost)),
    });
    const confirmationId = JSON.parse(textOf(confirmation)).confirmation_id;
    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: { ...PROJECT_ARGS, confirm_cost_id: confirmationId },
    });

    expect(result.structuredContent).toBeUndefined();
    expect(JSON.parse(textOf(result))).toStrictEqual(FIXED_PROJECT);
  });

  test('drops a supplied legacy token on the form lane', async () => {
    const setup = await setupModern({ answers: [{ action: 'decline' }] });
    const result = await setup.client.callTool({
      name: 'create_project',
      arguments: { ...PROJECT_ARGS, confirm_cost_id: 'ignored-token' },
    });

    expect(result.structuredContent).toStrictEqual({ status: 'declined' });
    expect(setup.elicitationRequests).toHaveLength(1);
  });

  test('returns migration guidance for direct confirm_cost calls', async () => {
    const setup = await setupModern();
    const result = await setup.client.callTool({
      name: 'confirm_cost',
      arguments: { type: 'project', recurrence: 'monthly', amount: 10 },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('create_project');
    expect(textOf(result)).not.toContain('confirmation_id');
  });

  test.each<[string, SetupOptions]>([
    ['no form capability', { capabilities: {} }],
    ['URL-only capability', { capabilities: { elicitation: { url: {} } } }],
    ['connection opt-out', { optOut: true }],
    ['unavailable form delivery', { formDeliveryAvailable: false }],
    ['disabled product switch', { enabled: () => false }],
  ])('%s keeps the classic contract', async (_case, options) => {
    const setup = await setupModern(options);
    const { tools } = await setup.client.listTools();
    const createProject = tools.find((tool) => tool.name === 'create_project');

    expect(tools.map((tool) => tool.name)).toContain('confirm_cost');
    expect(createProject?.inputSchema.required).toContain('confirm_cost_id');
    expect(createProject?.outputSchema).toBeUndefined();
  });

  test('hosted options on a classic client preserve project and branch bytes', async () => {
    async function connectClassic(server: Server) {
      const clientTransport = new StreamTransport();
      const serverTransport = new StreamTransport();
      clientTransport.readable.pipeTo(serverTransport.writable);
      serverTransport.readable.pipeTo(clientTransport.writable);
      const client = new Client(
        { name: 'classic-client', version: '1.0.0' },
        { capabilities: { elicitation: { form: {} } } }
      );
      const elicit = vi.fn(async () => ({ action: 'accept' as const }));
      client.setRequestHandler('elicitation/create', elicit);
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      return { client, elicit };
    }

    async function legacyExchange(client: Client) {
      const projectCost = await client.callTool({
        name: 'get_cost',
        arguments: { type: 'project', organization_id: 'fixed-org' },
      });
      const projectConfirmation = await client.callTool({
        name: 'confirm_cost',
        arguments: JSON.parse(textOf(projectCost)),
      });
      const projectConfirmationId = JSON.parse(
        textOf(projectConfirmation)
      ).confirmation_id;
      const projectCreation = await client.callTool({
        name: 'create_project',
        arguments: {
          ...PROJECT_ARGS,
          confirm_cost_id: projectConfirmationId,
        },
      });

      const branchCost = await client.callTool({
        name: 'get_cost',
        arguments: { type: 'branch', organization_id: 'fixed-org' },
      });
      const branchConfirmation = await client.callTool({
        name: 'confirm_cost',
        arguments: JSON.parse(textOf(branchCost)),
      });
      const branchConfirmationId = JSON.parse(
        textOf(branchConfirmation)
      ).confirmation_id;
      const branchCreation = await client.callTool({
        name: 'create_branch',
        arguments: {
          ...BRANCH_ARGS,
          confirm_cost_id: branchConfirmationId,
        },
      });

      return {
        project: {
          cost: projectCost,
          confirmation: projectConfirmation,
          creation: projectCreation,
        },
        branch: {
          cost: branchCost,
          confirmation: branchConfirmation,
          creation: branchCreation,
        },
      };
    }

    const baselineCost = createCostPlatform();
    const baseline = await connectClassic(
      createSupabaseMcpServer({
        platform: baselineCost.platform,
        features: ['account', 'branching'],
      })
    );
    const policyCost = createCostPlatform();
    const policy = await connectClassic(
      createSupabaseMcpServer({
        platform: policyCost.platform,
        features: ['account', 'branching'],
        elicitation: {
          key: STATE_KEY,
          bind: (ctx) => `actor-1\0${ctx.mcpReq.method}`,
          readProjectCreationRate: policyCost.readProjectCreationRate,
          readBranchCreationRate: policyCost.readBranchCreationRate,
          formDeliveryAvailable: true,
          enabled: () => true,
        },
      })
    );

    const baselineTools = await baseline.client.listTools();
    const policyTools = await policy.client.listTools();
    for (const name of [
      'get_cost',
      'confirm_cost',
      'create_project',
      'create_branch',
    ]) {
      expect(
        JSON.stringify(policyTools.tools.find((tool) => tool.name === name))
      ).toBe(
        JSON.stringify(baselineTools.tools.find((tool) => tool.name === name))
      );
    }
    expect(JSON.stringify(await legacyExchange(policy.client))).toBe(
      JSON.stringify(await legacyExchange(baseline.client))
    );
    expect(policy.elicit).not.toHaveBeenCalled();
  });
});
