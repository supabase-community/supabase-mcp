import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  inputRequired,
  type ElicitResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import {
  createMcpServer,
  tool,
  type McpServerOptions,
} from '@supabase/mcp-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import {
  canonicalArgumentsDigest,
  createSignedStateCodec,
  createStateSigner,
} from './codec.js';
import type { ElicitationPolicy } from './policy.js';
import type { ContinuationState } from './state.js';
import {
  createElicitationRuntime,
  type ElicitationRuntimeOptions,
} from './runtime.js';
import { withTerminalOutput } from './terminal.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const STATE_KEY = 'runtime-continuation-key-long-enough';
const ACTOR_ID = 'actor-1';
const TOOL = 'guarded';

type Args = { name: string };
type Proposal = { name: string };
type Resolution = { approved: boolean };

type PolicyCall = Parameters<
  NonNullable<McpServerOptions['onToolPolicyCall']>
>[0];

type RequestBody = {
  method?: string;
  params?: { requestState?: string; arguments?: Record<string, unknown> };
};

const businessOutput = z.object({ id: z.string() });

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

function basePolicy(): ElicitationPolicy<Args, Proposal, Resolution> {
  return {
    id: 'test-policy',
    version: 1,
    available: () => true,
    canonicalArguments: ({ name }) => ({ name }),
    prepare: async ({ name }) => ({ type: 'elicit', proposal: { name } }),
    inputRequests: (proposal) => ({
      confirm: inputRequired.elicit({
        message: `Confirm ${proposal.name}`,
        // Action-only consent: the request carries no properties, so the
        // answer is the `action`, never response content.
        requestedSchema: { type: 'object', properties: {} },
      }),
    }),
    resolve: async (_proposal, responses) => {
      const answer = responses.confirm;
      if (answer === undefined || answer.kind !== 'elicit') {
        return { type: 'reissue' };
      }
      if (answer.action === 'decline') {
        return { type: 'declined', message: 'Not created.' };
      }
      if (answer.action === 'cancel') {
        return { type: 'cancelled', message: 'Nothing was created.' };
      }
      return { type: 'execute', resolution: { approved: true } };
    },
  };
}

type SetupOptions = {
  policy?: Partial<ElicitationPolicy<Args, Proposal, Resolution>>;
  runtime?: Partial<ElicitationRuntimeOptions>;
  answers?: ElicitResult[];
  onElicit?: () => void;
  transformRequest?: (body: RequestBody) => void;
  toolName?: string;
};

function setupRuntime(options: SetupOptions = {}) {
  const prepare = vi.fn(basePolicy().prepare);
  const execute = vi.fn(async (args: Args, resolution: Resolution) => ({
    id: `${args.name}:${resolution.approved}`,
  }));
  const policy = { ...basePolicy(), prepare, ...options.policy };
  const policyCalls: PolicyCall[] = [];
  const runtime = createElicitationRuntime({
    actorId: ACTOR_ID,
    stateKey: STATE_KEY,
    formDeliveryAvailable: true,
    ...options.runtime,
  });

  const handler = createMcpHandler(
    () =>
      createMcpServer({
        name: 'runtime-test-server',
        version: '0.0.0',
        requestState: runtime.requestState,
        onToolPolicyCall: (details) => {
          policyCalls.push(details);
        },
        tools: {
          [TOOL]: tool({
            description: 'Guarded',
            parameters: z.object({ name: z.string() }),
            outputSchema: businessOutput,
            policy: runtime.policy(options.toolName ?? TOOL, policy),
            execute,
          }),
          plain: tool({
            description: 'Plain',
            parameters: z.object({ name: z.string() }),
            outputSchema: businessOutput,
            execute: async ({ name }) => ({ id: name }),
          }),
        },
      }),
    { legacy: 'reject' }
  );

  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      // The body is the JSON-RPC request this test's own client just sent.
      const body = (await new Request(url, init).json()) as RequestBody;
      options.transformRequest?.(body);
      return handler.fetch(
        new Request(url, { ...init, body: JSON.stringify(body) })
      );
    },
  });

  const client = new Client(
    { name: 'runtime-test-client', version: '1.2.3' },
    {
      capabilities: { elicitation: {} },
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );
  const answers = options.answers ?? [{ action: 'accept' }];
  client.setRequestHandler('elicitation/create', async () => {
    options.onElicit?.();
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error('no elicitation answer left');
    }
    return answer;
  });

  const connected = client.connect(transport).then(() => {
    cleanups.push(
      () => client.close(),
      () => handler.close()
    );
    return client;
  });

  return { client: connected, execute, policyCalls, prepare, runtime };
}

/**
 * Mints state that authenticates against this server's key and binding but
 * disagrees with it semantically, standing in for state a different server
 * build issued. It is the only way to reach the payload-version, policy, and
 * tool mismatch rows: the live minter always agrees with itself.
 */
async function foreignState(
  overrides: Partial<{
    v: number;
    policy: string;
    policyVersion: number;
    tool: string;
  }> = {}
) {
  const codec = createSignedStateCodec<ContinuationState & { jti: string }>({
    signer: createStateSigner(STATE_KEY),
    bind: (ctx) => `${ACTOR_ID}\u0000${ctx.mcpReq.method}`,
    clock: Date.now,
  });
  const issuedAt = Math.floor(Date.now() / 1_000);

  return codec.mint(
    {
      v: 1,
      policyVersion: 1,
      policy: 'test-policy',
      tool: TOOL,
      argsDigest: await canonicalArgumentsDigest({ name: 'demo' }),
      proposal: { name: 'demo' },
      jti: 'foreign-jti',
      iat: issuedAt,
      exp: issuedAt + 120,
      ...overrides,
    },
    { mcpReq: { method: 'tools/call' } } as unknown as ServerContext
  );
}

function textOf(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((entry) => entry.text ?? '').join('');
}

describe('elicitation runtime composition', () => {
  test('carries one prepared proposal across both rounds and executes once', async () => {
    const { client, execute, prepare } = setupRuntime();

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.structuredContent).toStrictEqual({ id: 'demo:true' });
    // Preparation runs on the first round only: the proposal the caller
    // approved is the one carried by the signed state.
    expect(prepare.mock.calls).toHaveLength(1);
    expect(execute.mock.calls).toHaveLength(1);
  });

  test('asks with a property-less schema and takes the action as the answer', async () => {
    const requests: unknown[] = [];
    const { client, execute } = setupRuntime();
    (await client).setRequestHandler('elicitation/create', async (request) => {
      requests.push(request.params);
      return { action: 'accept' };
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(requests).toStrictEqual([
      {
        mode: 'form',
        message: 'Confirm demo',
        requestedSchema: { type: 'object', properties: {} },
      },
    ]);
    expect(result.structuredContent).toStrictEqual({ id: 'demo:true' });
    expect(execute.mock.calls).toHaveLength(1);
  });

  test('advertises the widened terminal output through tool discovery', async () => {
    const { client } = setupRuntime();

    const { tools } = await (await client).listTools();
    const guarded = tools.find(({ name }) => name === TOOL);
    const plain = tools.find(({ name }) => name === 'plain');

    expect(guarded?.outputSchema).toStrictEqual(
      z.toJSONSchema(withTerminalOutput(businessOutput), { target: 'draft-7' })
    );
    // A policy-free tool keeps the discovery bytes it had before.
    expect(plain?.outputSchema).toBeUndefined();
  });

  test('reports allowlisted telemetry for both rounds of one interaction', async () => {
    const { client, policyCalls } = setupRuntime();

    await (await client).callTool({ name: TOOL, arguments: { name: 'demo' } });

    expect(policyCalls.map(({ telemetry }) => telemetry)).toStrictEqual([
      {
        interactionId: expect.any(String),
        policyId: 'test-policy',
        policyVersion: 1,
        authorityPath: 'form_elicitation',
        outcome: 'input_required',
      },
      {
        interactionId: expect.any(String),
        policyId: 'test-policy',
        policyVersion: 1,
        authorityPath: 'form_elicitation',
        outcome: 'executed',
      },
    ]);
    const [first, second] = policyCalls;
    expect(first?.telemetry.interactionId).toBe(
      second?.telemetry.interactionId
    );
  });

  test('executes without asking when preparation needs no confirmation', async () => {
    const { client, execute, policyCalls } = setupRuntime({
      policy: {
        prepare: async () => ({
          type: 'execute',
          resolution: { approved: false },
        }),
      },
      answers: [],
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.structuredContent).toStrictEqual({ id: 'demo:false' });
    expect(execute.mock.calls).toHaveLength(1);
    expect(policyCalls).toHaveLength(1);
    expect(policyCalls[0]?.telemetry).toStrictEqual({
      policyId: 'test-policy',
      policyVersion: 1,
      authorityPath: 'not_required',
      outcome: 'executed',
    });
  });
});

describe('authenticated failures', () => {
  test('answers an elapsed lifetime with recovery text and creates nothing', async () => {
    let now = 1_700_000_000_000;
    const { client, execute, policyCalls } = setupRuntime({
      runtime: { clock: () => now },
      transformRequest: (body) => {
        if (typeof body.params?.requestState === 'string') {
          now += 121_000;
        }
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'This request expired before it was answered. Run the tool again to start a new one.'
    );
    expect(result.structuredContent).toBeUndefined();
    expect(execute.mock.calls).toHaveLength(0);
    expect(policyCalls.at(-1)?.telemetry).toStrictEqual({
      interactionId: expect.any(String),
      policyId: 'test-policy',
      policyVersion: 1,
      outcome: 'expired',
      reason: 'state_expired',
    });
  });

  test.each([
    ['payload_version', { v: 2 }],
    ['policy_id', { policy: 'other-policy' }],
    ['policy_version', { policyVersion: 2 }],
    ['tool', { tool: 'other_tool' }],
  ] as const)(
    'answers a %s mismatch with recovery text and creates nothing',
    async (reason, overrides) => {
      const replacement = await foreignState(overrides);
      const { client, execute, policyCalls } = setupRuntime({
        transformRequest: (body) => {
          if (typeof body.params?.requestState === 'string') {
            body.params.requestState = replacement;
          }
        },
      });

      const result = await (await client).callTool({
        name: TOOL,
        arguments: { name: 'demo' },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('Run the tool again');
      expect(result.structuredContent).toBeUndefined();
      expect(execute.mock.calls).toHaveLength(0);
      expect(policyCalls.at(-1)?.telemetry).toMatchObject({
        outcome: 'rejected',
        reason,
      });
    }
  );

  test('answers changed arguments with recovery text and creates nothing', async () => {
    const { client, execute, policyCalls } = setupRuntime({
      transformRequest: (body) => {
        if (
          typeof body.params?.requestState === 'string' &&
          body.params.arguments
        ) {
          body.params.arguments.name = 'something-else';
        }
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'The tool arguments changed after this request was issued. Run the tool again with the arguments you want.'
    );
    expect(execute.mock.calls).toHaveLength(0);
    expect(policyCalls.at(-1)?.telemetry).toMatchObject({
      outcome: 'rejected',
      reason: 'arguments',
    });
  });
});
