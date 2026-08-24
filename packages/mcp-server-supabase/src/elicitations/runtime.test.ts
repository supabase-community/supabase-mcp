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
import type { ElicitationPolicy, ElicitationPreparation } from './policy.js';
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
/** `serial` counts preparations, so a second one is visible in the result. */
type Proposal = { name: string; serial: number };
type Resolution = { serial: number | null };

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
    prepare: async ({ name }) => ({
      type: 'elicit',
      proposal: { name, serial: 1 },
    }),
    inputRequests: (proposal) => ({
      confirm: inputRequired.elicit({
        message: `Confirm ${proposal.name} #${proposal.serial}`,
        // Action-only consent: the request carries no properties, so the
        // answer is the `action`, never response content.
        requestedSchema: { type: 'object', properties: {} },
      }),
    }),
    resolve: async (proposal, responses) => {
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
      return { type: 'execute', resolution: { serial: proposal.serial } };
    },
  };
}

type SetupOptions = {
  policy?: Partial<ElicitationPolicy<Args, Proposal, Resolution>>;
  runtime?: Partial<ElicitationRuntimeOptions>;
  /**
   * Options for a second server that answers the continuation rounds, which
   * is how a mid-flow change of serving facts or kill-switch state is
   * reproduced. It shares the state key and actor, so the state it receives
   * still authenticates.
   */
  continuation?: Partial<ElicitationRuntimeOptions>;
  /** Delegates `policy.available` to the serving runtime's own resolver. */
  availableFromRuntime?: boolean;
  /** Sends each continuation round twice, as a client retry would. */
  duplicateRetry?: boolean;
  answers?: ElicitResult[];
  onElicit?: () => void;
  transformRequest?: (body: RequestBody) => void;
  toolName?: string;
};

function setupRuntime(options: SetupOptions = {}) {
  // Preparation is deliberately unstable: preparing twice would hand the
  // caller a different proposal, so a stale serial in the result would prove
  // the runtime prepared again instead of using the state it signed.
  let preparations = 0;
  const prepare = vi.fn(
    async ({
      name,
    }: Args): Promise<ElicitationPreparation<Proposal, Resolution>> => ({
      type: 'elicit',
      proposal: { name, serial: ++preparations },
    })
  );
  const execute = vi.fn(async (args: Args, resolution: Resolution) => ({
    id: `${args.name}:${resolution.serial ?? 'unprompted'}`,
  }));
  const policyCalls: PolicyCall[] = [];

  function buildHandler(runtimeOptions: Partial<ElicitationRuntimeOptions>) {
    const runtime = createElicitationRuntime({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
      formDeliveryAvailable: true,
      ...runtimeOptions,
    });
    const policy: ElicitationPolicy<Args, Proposal, Resolution> = {
      ...basePolicy(),
      prepare,
      ...options.policy,
      ...(options.availableFromRuntime === true
        ? { available: (ctx) => runtime.availability(ctx).formElicitation }
        : {}),
    };

    return createMcpHandler(
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
              // Renders text only for a normalized request; a suppressed one
              // must fall back to the default single encoding.
              formatResult: ({ id }) => `formatted:${id}`,
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
  }

  const handler = buildHandler(options.runtime ?? {});
  const continuationHandler =
    options.continuation === undefined
      ? undefined
      : buildHandler({ ...options.runtime, ...options.continuation });

  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      // The body is the JSON-RPC request this test's own client just sent.
      const body = (await new Request(url, init).json()) as RequestBody;
      options.transformRequest?.(body);
      const forwarded = new Request(url, {
        ...init,
        body: JSON.stringify(body),
      });
      const isContinuation = typeof body.params?.requestState === 'string';
      const target =
        isContinuation && continuationHandler !== undefined
          ? continuationHandler
          : handler;

      if (isContinuation && options.duplicateRetry === true) {
        await target.fetch(forwarded.clone());
      }

      return target.fetch(forwarded);
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
      () => handler.close(),
      ...(continuationHandler === undefined
        ? []
        : [() => continuationHandler.close()])
    );
    return client;
  });

  return { client: connected, execute, policyCalls, prepare };
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
  test('resolves the first signed proposal, not one a second preparation would build', async () => {
    const asked: string[] = [];
    const { client, execute, prepare } = setupRuntime({
      onElicit: () => {
        asked.push('asked');
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    // Serial 1 is the proposal the caller was shown. Preparing again on the
    // continuation round would have produced serial 2 and executed with it.
    expect(result.structuredContent).toStrictEqual({ id: 'demo:1' });
    expect(asked).toHaveLength(1);
    expect(prepare.mock.calls).toHaveLength(1);
    expect(execute.mock.calls).toHaveLength(1);

    // The fixture is what makes the assertion above load bearing: preparing
    // once more really does build a different proposal.
    expect(await prepare({ name: 'demo' })).toStrictEqual({
      type: 'elicit',
      proposal: { name: 'demo', serial: 2 },
    });
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
        message: 'Confirm demo #1',
        requestedSchema: { type: 'object', properties: {} },
      },
    ]);
    expect(result.structuredContent).toStrictEqual({ id: 'demo:1' });
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
          resolution: { serial: null },
        }),
      },
      answers: [],
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.structuredContent).toStrictEqual({ id: 'demo:unprompted' });
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

describe('continuation authority', () => {
  test('answers capability loss mid-flow instead of switching authority path', async () => {
    const { client, execute, prepare, policyCalls } = setupRuntime({
      availableFromRuntime: true,
      // The connection opts out between the two rounds.
      continuation: { optOut: true },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'This client can no longer complete the request it started. Run the tool again from a client that supports form elicitation.'
    );
    // Neither authority path ran: no execution, and no second preparation
    // that would have started a fresh flow.
    expect(execute.mock.calls).toHaveLength(0);
    expect(prepare.mock.calls).toHaveLength(1);
    expect(policyCalls.at(-1)?.telemetry).toMatchObject({
      outcome: 'rejected',
      reason: 'unsupported_continuation',
    });
  });
});

describe('gate', () => {
  test('blocks protected execution without invalidating signed state', async () => {
    let attempts = 0;
    const { client, execute, policyCalls } = setupRuntime({
      duplicateRetry: true,
      continuation: {
        gate: () =>
          attempts++ === 0
            ? { isError: true, content: [{ type: 'text', text: 'Paused.' }] }
            : null,
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    // The blocked attempt neither executed nor consumed the state: the very
    // same continuation succeeded once the gate reopened.
    expect(result.structuredContent).toStrictEqual({ id: 'demo:1' });
    expect(execute.mock.calls).toHaveLength(1);
    expect(
      policyCalls.map(({ telemetry }) => [telemetry.outcome, telemetry.reason])
    ).toStrictEqual([
      ['input_required', undefined],
      ['blocked', 'gate'],
      ['executed', undefined],
    ]);
  });

  test('leaves policy-free tools running while the gate is closed', async () => {
    const { client, policyCalls } = setupRuntime({
      runtime: {
        gate: () => ({
          isError: true,
          content: [{ type: 'text', text: 'Paused.' }],
        }),
      },
      answers: [],
    });

    const ordinary = await (await client).callTool({
      name: 'plain',
      arguments: { name: 'demo' },
    });
    const guarded = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(ordinary.content).toStrictEqual([
      { type: 'text', text: JSON.stringify({ id: 'demo' }) },
    ]);
    expect(textOf(guarded)).toBe('Paused.');
    expect(guarded.isError).toBe(true);
    // The policy-free tool never reached a policy at all.
    expect(policyCalls).toHaveLength(1);
    expect(policyCalls[0]?.telemetry).toStrictEqual({
      policyId: 'test-policy',
      policyVersion: 1,
      outcome: 'blocked',
      reason: 'gate',
    });
  });
});

describe('detection-only replay posture', () => {
  test('executes repeated valid accepted state again under one Interaction ID', async () => {
    const { client, execute, policyCalls } = setupRuntime({
      duplicateRetry: true,
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(result.structuredContent).toStrictEqual({ id: 'demo:1' });
    // Both attempts ran. Telemetry can detect the duplicate; nothing prevents
    // it, and nothing was consumed.
    expect(execute.mock.calls).toHaveLength(2);

    const outcomes = policyCalls.map(({ telemetry }) => telemetry.outcome);
    expect(outcomes).toStrictEqual(['input_required', 'executed', 'executed']);

    const interactionIds = policyCalls.map(
      ({ telemetry }) => telemetry.interactionId
    );
    expect(new Set(interactionIds).size).toBe(1);
    expect(interactionIds[0]).toStrictEqual(expect.any(String));
  });
});

describe('terminal outcomes', () => {
  test.each([
    ['decline', 'declined', 'Not created.'],
    ['cancel', 'cancelled', 'Nothing was created.'],
  ] as const)(
    'answers %s with the distinct %s variant and explicit text',
    async (action, status, text) => {
      const { client, execute } = setupRuntime({ answers: [{ action }] });

      const result = await (await client).callTool({
        name: TOOL,
        arguments: { name: 'demo' },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toStrictEqual({ status });
      expect(textOf(result)).toBe(text);
      expect(execute.mock.calls).toHaveLength(0);
    }
  );

  test('asks again for invalid input without preparing a second proposal', async () => {
    let asked = 0;
    const { client, execute, prepare } = setupRuntime({
      policy: {
        resolve: async (proposal, responses) => {
          const answer = responses.confirm;
          if (answer?.kind !== 'elicit' || answer.action !== 'accept') {
            return { type: 'cancelled', message: 'Nothing was created.' };
          }
          if (answer.content?.token !== 'ok') {
            return { type: 'reissue' };
          }
          return { type: 'execute', resolution: { serial: proposal.serial } };
        },
      },
      answers: [
        { action: 'accept', content: { token: 'wrong' } },
        { action: 'accept', content: { token: 'ok' } },
      ],
      onElicit: () => {
        asked += 1;
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(asked).toBe(2);
    // The reissued round re-signs the proposal that was already prepared.
    expect(prepare.mock.calls).toHaveLength(1);
    expect(result.structuredContent).toStrictEqual({ id: 'demo:1' });
    expect(execute.mock.calls).toHaveLength(1);
  });
});

describe('initial request availability', () => {
  test('refuses to emit a form the request cannot carry, and creates nothing', async () => {
    const asked: string[] = [];
    const { client, execute, prepare, policyCalls } = setupRuntime({
      policy: { available: () => false },
      answers: [],
      onElicit: () => {
        asked.push('asked');
      },
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    // Nothing was emitted toward a client that cannot answer, and nothing ran.
    expect(asked).toHaveLength(0);
    expect(execute.mock.calls).toHaveLength(0);
    // This request is suppressed, so the refusal also pins that a policy
    // `result` decision reaches the wire unchanged: exactly these bytes, and
    // no structured content to be stripped or added.
    expect(result.isError).toBe(true);
    expect(result.content).toStrictEqual([
      {
        type: 'text',
        text: 'This client cannot complete the confirmation this tool requires, so nothing was created. Run the tool again from a client and connection that support form elicitation.',
      },
    ]);
    expect('structuredContent' in result).toBe(false);
    expect(prepare.mock.calls).toHaveLength(1);
    expect(policyCalls).toHaveLength(1);
    expect(policyCalls[0]?.telemetry).toStrictEqual({
      policyId: 'test-policy',
      policyVersion: 1,
      outcome: 'rejected',
      reason: 'unsupported_elicitation',
    });
  });

  test('still executes a preparation that needs no confirmation', async () => {
    const { client, execute } = setupRuntime({
      policy: {
        available: () => false,
        prepare: async () => ({
          type: 'execute',
          resolution: { serial: null },
        }),
      },
      answers: [],
    });

    const result = await (await client).callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    // An incapable request is only refused where a form would be emitted.
    // The request is suppressed, so the proof it ran is the pre-normalization
    // payload rather than structured content.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toStrictEqual([
      { type: 'text', text: JSON.stringify({ id: 'demo:unprompted' }) },
    ]);
    expect(execute.mock.calls).toHaveLength(1);
  });
});

describe('contextual structured results', () => {
  test('normalizes a capable request and holds an incapable one on pre-normalization bytes', async () => {
    const capable = await setupRuntime().client;
    const incapable = await setupRuntime({
      policy: {
        available: () => false,
        prepare: async () => ({
          type: 'execute',
          resolution: { serial: null },
        }),
      },
      answers: [],
    }).client;

    const advertised = (await capable.listTools()).tools;
    const suppressed = (await incapable.listTools()).tools;
    const guardedEntry = advertised.find(({ name }) => name === TOOL);
    const suppressedEntry = suppressed.find(({ name }) => name === TOOL);
    // Measured base: the policy-free tool on the same server, which carries
    // the discovery and result bytes every tool had before structured
    // results existed.
    const baseEntry = suppressed.find(({ name }) => name === 'plain');

    expect(guardedEntry?.outputSchema).toStrictEqual(
      z.toJSONSchema(withTerminalOutput(businessOutput), { target: 'draft-7' })
    );
    expect('outputSchema' in (baseEntry ?? {})).toBe(false);
    expect('outputSchema' in (suppressedEntry ?? {})).toBe(false);

    const normalized = await capable.callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });
    // The base runs the policy-free tool on the payload the suppressed lane
    // produces, so the two results are directly comparable.
    const base = await incapable.callTool({
      name: 'plain',
      arguments: { name: 'demo:unprompted' },
    });
    const held = await incapable.callTool({
      name: TOOL,
      arguments: { name: 'demo' },
    });

    expect(normalized.structuredContent).toStrictEqual({ id: 'demo:1' });
    expect(textOf(normalized)).toBe('formatted:demo:1');

    // The base carries no structured content and single-encoded JSON text.
    expect(base.structuredContent).toBeUndefined();
    expect(base.content).toStrictEqual([
      { type: 'text', text: JSON.stringify({ id: 'demo:unprompted' }) },
    ]);

    // The suppressed lane reproduces the base exactly, down to skipping the
    // tool's own `formatResult`.
    expect(held.isError).toBe(base.isError);
    expect(held.structuredContent).toBe(base.structuredContent);
    expect(held.content).toStrictEqual(base.content);
    expect(textOf(held)).not.toBe('formatted:demo:unprompted');
  });
});
