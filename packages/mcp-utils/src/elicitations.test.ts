import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  type CallToolResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import {
  ElicitationRuntime,
  type ElicitationPolicy,
  type ElicitationState,
  InMemoryReplayStore,
  withPolicyOutput,
} from './elicitations.js';
import { createMcpServer, tool } from './server.js';
import type { ToolPolicyTelemetry, ToolRequestContext } from './tool-policy.js';

const STATE_KEY = new Uint8Array(32).fill(7);
const NOW = 1_800_000_000_000;
const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
  vi.restoreAllMocks();
});

function serverContext(method: string): ServerContext {
  return {
    mcpReq: { method },
  } as unknown as ServerContext;
}

function testState(
  overrides: Partial<ElicitationState> = {}
): ElicitationState {
  return {
    v: 1,
    policyVersion: 3,
    policy: 'confirmation',
    tool: 'create_project',
    argsDigest: 'digest',
    proposal: { display: 'safe' },
    jti: 'fixed-jti',
    iat: NOW / 1_000,
    exp: NOW / 1_000 + 120,
    ...overrides,
  };
}

async function derivedStateKey(): Promise<Uint8Array> {
  const derivationKey = await crypto.subtle.importKey(
    'raw',
    STATE_KEY,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign(
      'HMAC',
      derivationKey,
      new TextEncoder().encode('mcp-request-state:v1')
    )
  );
}

describe('InMemoryReplayStore', () => {
  test('rejects same-process jti reuse', () => {
    const store = new InMemoryReplayStore({ clock: () => 1_000 });

    expect(store.consume('same-jti', 2_000)).toBe(true);
    expect(store.consume('same-jti', 2_000)).toBe(false);
  });

  test('evicts entries exactly when the codec rejects their state', () => {
    let now = 2_000;
    const store = new InMemoryReplayStore({ capacity: 1, clock: () => now });

    expect(store.consume('expired', 2_001)).toBe(true);
    now = 2_001;
    expect(store.consume('replacement', 3_000)).toBe(true);
  });

  test('does not evict a state during the final valid second', () => {
    let now = 2_000;
    const store = new InMemoryReplayStore({ capacity: 1, clock: () => now });

    expect(store.consume('live', 3_000)).toBe(true);
    now = 2_500;
    expect(() => store.consume('other', 4_000)).toThrow(
      'Replay store capacity reached'
    );
  });

  test('fails closed at capacity when every entry is live', () => {
    const store = new InMemoryReplayStore({ capacity: 1, clock: () => 1_000 });

    expect(store.consume('live', 2_000)).toBe(true);
    expect(() => store.consume('other', 2_000)).toThrow(
      'Replay store capacity reached'
    );
  });
});

describe('ElicitationRuntime request state', () => {
  test('rejects a continuation state TTL above 120 seconds', () => {
    expect(
      () =>
        new ElicitationRuntime({
          approverId: 'approver-1',
          stateKey: STATE_KEY,
          ttlSeconds: 121,
        })
    ).toThrow('ttlSeconds must be at most 120');
  });
});

test('uses the derived request-state key instead of the injected raw key', async () => {
  const derivedKey = await derivedStateKey();
  expect(
    Array.from(derivedKey, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  ).toBe('8140e337889e5f2334bbbcd69cb80a18eef7e28b0d39b94e4423a10949e16571');
  const ctx = serverContext('tools/call');
  const runtime = new ElicitationRuntime({
    approverId: 'approver-1',
    stateKey: STATE_KEY,
    clock: () => NOW,
  });
  const rawKeyCodec = createRequestStateCodec<ElicitationState>({
    key: STATE_KEY,
    ttlSeconds: 120,
    bind: () => 'approver-1\u0000tools/call',
  });

  const state = await runtime.requestState.mint(testState(), ctx);

  await expect(rawKeyCodec.verify(state, ctx)).rejects.toThrow('mac');
});

test('matches the SDK wire format and unpadded base64url alphabet', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const approverId = 'José 🚀';
  const ctx = serverContext('tools/call');
  const runtime = new ElicitationRuntime({
    approverId,
    stateKey: STATE_KEY,
    clock: Date.now,
  });
  const sdk = createRequestStateCodec<ElicitationState>({
    key: await derivedStateKey(),
    ttlSeconds: 120,
    bind: () => `${approverId}\u0000tools/call`,
  });
  const payload = testState();

  const runtimeMinted = await runtime.requestState.mint(payload, ctx);
  const sdkMinted = await sdk.mint(payload, ctx);

  expect(runtimeMinted).toBe(sdkMinted);
  expect(runtimeMinted).toBe(
    'v1.eyJwIjp7InYiOjEsInBvbGljeVZlcnNpb24iOjMsInBvbGljeSI6ImNvbmZpcm1hdGlvbiIsInRvb2wiOiJjcmVhdGVfcHJvamVjdCIsImFyZ3NEaWdlc3QiOiJkaWdlc3QiLCJwcm9wb3NhbCI6eyJkaXNwbGF5Ijoic2FmZSJ9LCJqdGkiOiJmaXhlZC1qdGkiLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDAwMDEyMH0sImV4cCI6MTgwMDAwMDEyMCwiYiI6InJUQnR3by0zd0FNQjJDTVc4bUNtOGcifQ.DE-WnAAD940T5tezWsmownYO7agJwqAHYFXJk_nlKTo'
  );
  expect(runtimeMinted.split('.')).toHaveLength(3);
  for (const segment of runtimeMinted.split('.')) {
    expect(segment).toMatch(/^[A-Za-z0-9_-]+$/);
  }
  await expect(sdk.verify(runtimeMinted, ctx)).resolves.toEqual(payload);
  await expect(runtime.requestState.verify(sdkMinted, ctx)).resolves.toEqual({
    kind: 'valid',
    state: payload,
  });
});

test('rejects bind presence asymmetry in both directions', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  const ctx = serverContext('tools/call');
  const runtime = new ElicitationRuntime({
    approverId: 'approver-1',
    stateKey: STATE_KEY,
    clock: Date.now,
  });
  const bindlessSdk = createRequestStateCodec<ElicitationState>({
    key: await derivedStateKey(),
    ttlSeconds: 120,
  });
  const payload = testState();

  const runtimeBound = await runtime.requestState.mint(payload, ctx);
  const sdkBindless = await bindlessSdk.mint(payload);

  await expect(bindlessSdk.verify(runtimeBound, ctx)).rejects.toThrow('bind');
  await expect(runtime.requestState.verify(sdkBindless, ctx)).rejects.toThrow(
    'bind'
  );
});

test.each([
  {
    name: 'tampered',
    alter: (state: string) =>
      `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`,
    ctx: serverContext('tools/call'),
  },
  {
    name: 'wrong actor',
    alter: (state: string) => state,
    ctx: serverContext('tools/call'),
    approverId: 'approver-2',
  },
  {
    name: 'wrong method',
    alter: (state: string) => state,
    ctx: serverContext('resources/read'),
  },
])(
  'matches SDK rejection for $name state',
  async ({ alter, ctx, approverId }) => {
    const mintContext = serverContext('tools/call');
    const runtime = new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
      clock: Date.now,
    });
    const verifyingRuntime = new ElicitationRuntime({
      approverId: approverId ?? 'approver-1',
      stateKey: STATE_KEY,
      clock: Date.now,
    });
    const derivationKey = await crypto.subtle.importKey(
      'raw',
      STATE_KEY,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const derivedKey = new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        derivationKey,
        new TextEncoder().encode('mcp-request-state:v1')
      )
    );
    const sdk = createRequestStateCodec<ElicitationState>({
      key: derivedKey,
      ttlSeconds: 120,
      bind: () => `${approverId ?? 'approver-1'}\u0000${ctx.mcpReq.method}`,
    });
    const state = alter(
      await runtime.requestState.mint(
        testState({
          iat: Math.floor(Date.now() / 1_000),
          exp: Math.floor(Date.now() / 1_000) + 120,
        }),
        mintContext
      )
    );

    await expect(
      verifyingRuntime.requestState.verify(state, ctx)
    ).rejects.toThrow();
    await expect(sdk.verify(state, ctx)).rejects.toThrow();
  }
);

test('distinguishes authenticated expiry from an edited exp', async () => {
  let now = NOW;
  const ctx = serverContext('tools/call');
  const runtime = new ElicitationRuntime({
    approverId: 'approver-1',
    stateKey: STATE_KEY,
    clock: () => now,
  });
  const state = await runtime.requestState.mint(testState(), ctx);
  now += 121_000;

  await expect(runtime.requestState.verify(state, ctx)).resolves.toEqual({
    kind: 'expired',
    authenticatedExp: NOW / 1_000 + 120,
    authenticatedJti: 'fixed-jti',
  });

  const [prefix, encodedBody, mac] = state.split('.');
  if (encodedBody === undefined) {
    throw new Error('Expected an encoded state envelope');
  }
  const envelope = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(
        atob(encodedBody.replaceAll('-', '+').replaceAll('_', '/')),
        (character) => character.codePointAt(0) ?? 0
      )
    )
  );
  envelope.exp += 60;
  const editedBody = btoa(JSON.stringify(envelope))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');

  await expect(
    runtime.requestState.verify(`${prefix}.${editedBody}.${mac}`, ctx)
  ).rejects.toThrow('mac');
});

type TestResolution = { approved: true };
type TestProposal = { label: string };
type TestResponse = {
  kind: 'elicit';
  action: 'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>;
};
type LifecyclePolicy = ElicitationPolicy<
  { value: string },
  TestProposal,
  TestResolution
>;

function lifecyclePolicy({
  version = 1,
  available = () => true,
  prepare = vi.fn(async () => ({
    type: 'elicit' as const,
    proposal: { label: 'original proposal' },
  })),
}: {
  version?: number;
  available?: ElicitationPolicy<
    { value: string },
    TestProposal,
    TestResolution
  >['available'];
  prepare?: ElicitationPolicy<
    { value: string },
    TestProposal,
    TestResolution
  >['prepare'];
} = {}): ElicitationPolicy<{ value: string }, TestProposal, TestResolution> {
  return {
    id: 'test-confirmation',
    version,
    available,
    canonicalArguments: ({ value }) => ({ value }),
    prepare,
    inputRequests: (proposal) => ({
      confirmation: inputRequired.elicit({
        message: `Confirm ${proposal.label}`,
        requestedSchema: {
          type: 'object',
          properties: {
            decision: { type: 'string' },
          },
          required: ['decision'],
        },
      }),
    }),
    resolve: async (_proposal, responses) => {
      const response = (responses as { confirmation: TestResponse })
        .confirmation;
      if (response.action === 'decline') {
        return { type: 'declined', message: 'Request declined.' };
      }
      if (response.action === 'cancel') {
        return { type: 'cancelled', message: 'Request cancelled.' };
      }
      if (response.content?.decision === 'reissue') {
        return { type: 'reissue' };
      }
      return { type: 'execute', resolution: { approved: true } };
    },
  };
}

async function setupLifecycleFixture({
  runtime,
  policy = lifecyclePolicy(),
  responses,
  formDeliveryAvailable = true,
  onToolPolicyCall,
  onElicit,
  transformRequest,
  requestBodies,
  duplicateRetry = false,
  onDuplicateRetry,
  continuation,
}: {
  runtime: ElicitationRuntime;
  policy?: LifecyclePolicy;
  responses: Array<{
    action: 'accept' | 'decline' | 'cancel';
    content?: Record<string, string | number | boolean | string[]>;
  }>;
  formDeliveryAvailable?: boolean;
  onToolPolicyCall?: Parameters<typeof createMcpServer>[0]['onToolPolicyCall'];
  onElicit?: () => void;
  transformRequest?: (body: Record<string, any>) => void;
  requestBodies?: Array<Record<string, any>>;
  duplicateRetry?: boolean;
  onDuplicateRetry?: () => void;
  continuation?: {
    runtime: ElicitationRuntime;
    policy?: LifecyclePolicy;
    formDeliveryAvailable?: boolean;
    onToolPolicyCall?: Parameters<
      typeof createMcpServer
    >[0]['onToolPolicyCall'];
    mirror?: boolean;
  };
}) {
  const execute = vi.fn(async ({ value }: { value: string }) => ({ value }));
  const continuationExecute = vi.fn(async ({ value }: { value: string }) => ({
    value,
  }));
  const makeHandler = ({
    selectedRuntime,
    selectedPolicy,
    delivery,
    callback,
    selectedExecute,
  }: {
    selectedRuntime: ElicitationRuntime;
    selectedPolicy: LifecyclePolicy;
    delivery: boolean;
    callback?: Parameters<typeof createMcpServer>[0]['onToolPolicyCall'];
    selectedExecute: typeof execute;
  }) =>
    createMcpHandler(
      () =>
        createMcpServer({
          name: 'elicitation-test-server',
          version: '0.0.0',
          toolRequestInputs: { formDeliveryAvailable: delivery },
          requestState: { verify: selectedRuntime.requestState.verify },
          onToolPolicyCall: callback,
          tools: {
            guarded: tool({
              description: 'Guarded tool',
              parameters: z.object({ value: z.string() }),
              outputSchema: z.object({ value: z.string() }),
              policy: selectedRuntime.policy('guarded', selectedPolicy),
              execute: selectedExecute,
            }),
          },
        }),
      { legacy: 'reject' }
    );
  const handler = makeHandler({
    selectedRuntime: runtime,
    selectedPolicy: policy,
    delivery: formDeliveryAvailable,
    callback: onToolPolicyCall,
    selectedExecute: execute,
  });
  const continuationHandler =
    continuation === undefined
      ? undefined
      : makeHandler({
          selectedRuntime: continuation.runtime,
          selectedPolicy: continuation.policy ?? policy,
          delivery: continuation.formDeliveryAvailable ?? formDeliveryAvailable,
          callback: continuation.onToolPolicyCall,
          selectedExecute: continuationExecute,
        });
  const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      const body = (await request.clone().json()) as Record<string, any>;
      requestBodies?.push(structuredClone(body));
      transformRequest?.(body);
      const forwarded = new Request(url, {
        ...init,
        body: JSON.stringify(body),
      });
      const isRetry =
        body.method === 'tools/call' &&
        typeof body.params?.requestState === 'string';
      if (duplicateRetry && isRetry) {
        await handler.fetch(forwarded.clone());
        onDuplicateRetry?.();
      }
      if (continuationHandler !== undefined && isRetry) {
        if (continuation?.mirror) {
          await continuationHandler.fetch(forwarded.clone());
        } else {
          return continuationHandler.fetch(forwarded);
        }
      }
      return handler.fetch(forwarded);
    },
  });
  const client = new Client(
    { name: 'elicitation-test-client', version: '1.2.3' },
    {
      capabilities: { elicitation: { form: {} } },
      versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
    }
  );
  client.setRequestHandler('elicitation/create', async () => {
    onElicit?.();
    const response = responses.shift();
    if (response === undefined) {
      throw new Error('No elicitation response configured');
    }
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

  return { client, execute, continuationExecute, handler };
}

describe('ElicitationRuntime lifecycle', () => {
  test('gates an initial leg before preparing or minting state', async () => {
    const prepare = vi.fn(async () => ({
      type: 'elicit' as const,
      proposal: { label: 'must not be prepared' },
    }));
    const runtime = new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
      gate: () => ({
        content: [{ type: 'text', text: 'Temporarily unavailable.' }],
        isError: true,
      }),
    });
    const policy = runtime.policy('guarded', lifecyclePolicy({ prepare }));
    const ctx = {
      server: {
        mcpReq: {
          method: 'tools/call',
          requestState: () => undefined,
        },
      },
      era: 'modern',
      formElicitation: true,
      formSupportReason: 'available',
    } as ToolRequestContext;

    const decision = await policy.resolve({ value: 'original' }, ctx);

    expect(decision).toEqual({
      type: 'result',
      result: {
        content: [{ type: 'text', text: 'Temporarily unavailable.' }],
        isError: true,
      },
      telemetry: {},
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  test('validates continuation state before an active gate', async () => {
    const gate = vi.fn((): CallToolResult | null => ({
      content: [{ type: 'text', text: 'Temporarily unavailable.' }],
      isError: true,
    }));
    const runtime = new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
      clock: () => NOW,
      createJti: () => 'gate-validation-jti',
      gate,
    });
    const policy = runtime.policy('guarded', lifecyclePolicy());
    const initialContext = {
      server: {
        mcpReq: {
          method: 'tools/call',
          requestState: () => undefined,
        },
      },
      era: 'modern',
      formElicitation: true,
      formSupportReason: 'available',
    } as ToolRequestContext;

    gate.mockReturnValueOnce(null);
    const initial = await policy.resolve({ value: 'original' }, initialContext);
    if (
      initial.type !== 'result' ||
      !('requestState' in initial.result) ||
      typeof initial.result.requestState !== 'string'
    ) {
      throw new Error('Expected input_required result');
    }
    const tamperedState = `${initial.result.requestState.slice(0, -1)}x`;
    await expect(
      runtime.requestState.verify(tamperedState, initialContext.server)
    ).rejects.toThrow('mac');

    const verified = await runtime.requestState.verify(
      initial.result.requestState,
      initialContext.server
    );
    const mismatch = await policy.resolve(
      { value: 'changed' },
      {
        ...initialContext,
        server: {
          mcpReq: {
            method: 'tools/call',
            requestState: () => verified,
          },
        } as unknown as ToolRequestContext['server'],
      }
    );

    expect(mismatch).toMatchObject({
      type: 'result',
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('arguments changed') }],
      },
    });
    expect(gate).toHaveBeenCalledTimes(1);
  });

  test('does not consume a continuation while gated', async () => {
    let blocked = false;
    const runtime = new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
      clock: () => NOW,
      createJti: () => 'gate-retry-jti',
      gate: () =>
        blocked
          ? {
              content: [{ type: 'text', text: 'Temporarily unavailable.' }],
              isError: true,
            }
          : null,
    });
    const policy = runtime.policy('guarded', lifecyclePolicy());
    const initialContext = {
      server: {
        mcpReq: {
          method: 'tools/call',
          requestState: () => undefined,
        },
      },
      era: 'modern',
      formElicitation: true,
      formSupportReason: 'available',
    } as ToolRequestContext;
    const initial = await policy.resolve({ value: 'original' }, initialContext);
    if (
      initial.type !== 'result' ||
      !('requestState' in initial.result) ||
      typeof initial.result.requestState !== 'string'
    ) {
      throw new Error('Expected input_required result');
    }
    const verified = await runtime.requestState.verify(
      initial.result.requestState,
      initialContext.server
    );
    const retryContext = {
      ...initialContext,
      server: {
        mcpReq: {
          method: 'tools/call',
          requestState: () => verified,
          inputResponses: {
            confirmation: {
              action: 'accept',
              content: { decision: 'execute' },
            },
          },
        },
      } as unknown as ToolRequestContext['server'],
    };

    blocked = true;
    const gated = await policy.resolve({ value: 'original' }, retryContext);
    expect(gated).toMatchObject({
      type: 'result',
      result: {
        isError: true,
        content: [{ text: 'Temporarily unavailable.' }],
      },
    });

    blocked = false;
    const resumed = await policy.resolve({ value: 'original' }, retryContext);
    expect(resumed).toMatchObject({
      type: 'execute',
      resolution: { approved: true },
    });
  });

  test('elicits before executing and accepts exactly once', async () => {
    const prepare = vi.fn(async () => ({
      type: 'elicit' as const,
      proposal: { label: 'original proposal' },
    }));
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      policy: lifecyclePolicy({ prepare }),
      responses: [{ action: 'accept', content: { decision: 'execute' } }],
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.execute).toHaveBeenCalledWith(
      { value: 'original' },
      { approved: true }
    );
    expect(result.structuredContent).toEqual({ value: 'original' });
  });

  test.each([
    {
      action: 'decline' as const,
      status: 'declined',
      message: 'Request declined.',
    },
    {
      action: 'cancel' as const,
      status: 'cancelled',
      message: 'Request cancelled.',
    },
  ])('returns a non-error $status terminal result', async (example) => {
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      responses: [{ action: example.action }],
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ status: example.status });
    expect(result.content).toEqual([{ type: 'text', text: example.message }]);
  });

  test('reissues the original proposal with fresh state and Interaction ID', async () => {
    const telemetry: ToolPolicyTelemetry[] = [];
    const prepare = vi.fn(async () => ({
      type: 'elicit' as const,
      proposal: { label: 'original proposal' },
    }));
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
        createJti: (() => {
          const values = ['jti-one', 'jti-two'];
          return () => values.shift() ?? 'unexpected-jti';
        })(),
      }),
      policy: lifecyclePolicy({ prepare }),
      responses: [
        { action: 'accept', content: { decision: 'reissue' } },
        { action: 'accept', content: { decision: 'execute' } },
      ],
      onToolPolicyCall: ({ telemetry: event }) => {
        telemetry.push(event);
      },
    });

    await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveLength(3);
    const firstEvent = telemetry[0];
    const secondEvent = telemetry[1];
    expect(firstEvent).toBeDefined();
    expect(secondEvent).toBeDefined();
    expect(firstEvent?.interactionId).not.toBe(secondEvent?.interactionId);
    expect(firstEvent).not.toContain('jti-one');
    expect(secondEvent).not.toContain('jti-two');
  });

  test('returns recovery text for true expiry without executing', async () => {
    let now = NOW;
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
        clock: () => now,
      }),
      responses: [{ action: 'accept', content: { decision: 'execute' } }],
      onElicit: () => {
        now = (testState().exp + 1) * 1_000;
      },
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: 'text',
        text: 'This confirmation expired. Run the tool again to request a new confirmation.',
      },
    ]);
  });

  test('rejects argument mutation without executing', async () => {
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      responses: [{ action: 'accept', content: { decision: 'execute' } }],
      transformRequest: (body) => {
        if (
          body.method === 'tools/call' &&
          typeof body.params?.requestState === 'string'
        ) {
          body.params.arguments.value = 'mutated';
        }
      },
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(fixture.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('arguments changed'),
    });
  });

  test('rejects same-process replay without a second execution', async () => {
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      responses: [{ action: 'accept', content: { decision: 'execute' } }],
      duplicateRetry: true,
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('already used'),
    });
  });

  test('rejects replay during the final valid second without another execution', async () => {
    let now = NOW;
    const fixture = await setupLifecycleFixture({
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
        clock: () => now,
      }),
      responses: [{ action: 'accept', content: { decision: 'execute' } }],
      duplicateRetry: true,
      onDuplicateRetry: () => {
        now = testState().exp * 1_000 + 500;
      },
    });

    const result = await fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    });

    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('already used'),
    });
  });

  test('emits only safe runtime telemetry across every policy leg', async () => {
    const approverId = 'sensitive-approver';
    const rawJti = 'sensitive-raw-jti';
    const proposalFact = 'sensitive-proposal-fact';
    const formResponse = 'sensitive-form-response';
    const events: Array<{
      leg: string;
      telemetry: ToolPolicyTelemetry;
    }> = [];
    const requestStates: string[] = [];
    const makeRuntime = (clock?: () => number) =>
      new ElicitationRuntime({
        approverId,
        stateKey: STATE_KEY,
        createJti: () => rawJti,
        clock,
      });
    const policy = lifecyclePolicy({
      prepare: vi.fn(async () => ({
        type: 'elicit' as const,
        proposal: { label: proposalFact },
      })),
    });
    const observe = (leg: string) => {
      let invocation = 0;
      return ({ telemetry }: { telemetry: ToolPolicyTelemetry }) => {
        const eventLeg =
          leg === 'prepare' ? leg : invocation === 0 ? 'input_required' : leg;
        events.push({ leg: eventLeg, telemetry });
        invocation += 1;
      };
    };
    const captureStates = (bodies: Array<Record<string, any>>) => {
      for (const body of bodies) {
        const requestState = body.params?.requestState;
        if (typeof requestState === 'string') {
          requestStates.push(requestState);
        }
      }
    };
    const call = async (
      leg: string,
      options: Omit<
        Parameters<typeof setupLifecycleFixture>[0],
        'runtime' | 'policy'
      > & {
        runtime?: ElicitationRuntime;
        selectedPolicy?: LifecyclePolicy;
      }
    ) => {
      const requestBodies: Array<Record<string, any>> = [];
      const fixture = await setupLifecycleFixture({
        ...options,
        runtime: options.runtime ?? makeRuntime(),
        policy: options.selectedPolicy ?? policy,
        onToolPolicyCall: observe(leg),
        requestBodies,
      });
      await fixture.client.callTool({
        name: 'guarded',
        arguments: { value: 'original' },
      });
      captureStates(requestBodies);
    };

    await call('prepare', {
      selectedPolicy: lifecyclePolicy({
        prepare: vi.fn(async () => ({
          type: 'execute' as const,
          resolution: { approved: true as const },
        })),
      }),
      responses: [],
    });
    for (const action of ['accept', 'decline', 'cancel'] as const) {
      await call(action, {
        responses: [
          {
            action,
            content: { decision: 'execute', private: formResponse },
          },
        ],
      });
    }
    await call('reissue', {
      responses: [
        {
          action: 'accept',
          content: { decision: 'reissue', private: formResponse },
        },
        {
          action: 'accept',
          content: { decision: 'execute', private: formResponse },
        },
      ],
    });
    let expiryNow = NOW;
    await call('expiry', {
      runtime: makeRuntime(() => expiryNow),
      responses: [
        {
          action: 'accept',
          content: { decision: 'execute', private: formResponse },
        },
      ],
      onElicit: () => {
        expiryNow = (testState().exp + 1) * 1_000;
      },
    });
    await call('mismatch', {
      responses: [
        {
          action: 'accept',
          content: { decision: 'execute', private: formResponse },
        },
      ],
      transformRequest: (body) => {
        if (
          body.method === 'tools/call' &&
          typeof body.params?.requestState === 'string'
        ) {
          body.params.arguments.value = 'changed';
        }
      },
    });

    expect(requestStates).not.toHaveLength(0);
    expect([...new Set(events.map(({ leg }) => leg))].sort()).toEqual([
      'accept',
      'cancel',
      'decline',
      'expiry',
      'input_required',
      'mismatch',
      'prepare',
      'reissue',
    ]);
    for (const event of events) {
      expect(Object.keys(event.telemetry)).toEqual(
        event.leg === 'prepare'
          ? ['formSupportReason']
          : ['interactionId', 'formSupportReason']
      );
      expect(event.telemetry.formSupportReason).toBe('available');
      if (event.leg !== 'prepare') {
        expect(event.telemetry.interactionId).toEqual(expect.any(String));
      }
    }
    const emitted = JSON.stringify(events);
    for (const sensitiveValue of [
      ...requestStates,
      formResponse,
      proposalFact,
      rawJti,
      approverId,
    ]) {
      expect(emitted).not.toContain(sensitiveValue);
    }
  });
});

test('rejects capability loss on continuation without another authority path', async () => {
  const policy = lifecyclePolicy({
    available: (ctx) => ctx.formElicitation,
  });
  const fixture = await setupLifecycleFixture({
    runtime: new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
    }),
    policy,
    responses: [{ action: 'accept', content: { decision: 'execute' } }],
    continuation: {
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      formDeliveryAvailable: false,
    },
  });

  const result = await fixture.client.callTool({
    name: 'guarded',
    arguments: { value: 'original' },
  });

  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.continuationExecute).not.toHaveBeenCalled();
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('can no longer continue'),
  });
});

test('rejects state minted under an older policy version', async () => {
  const fixture = await setupLifecycleFixture({
    runtime: new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
    }),
    policy: lifecyclePolicy({ version: 1 }),
    responses: [{ action: 'accept', content: { decision: 'execute' } }],
    continuation: {
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      policy: lifecyclePolicy({ version: 2 }),
    },
  });

  const result = await fixture.client.callTool({
    name: 'guarded',
    arguments: { value: 'original' },
  });

  expect(fixture.execute).not.toHaveBeenCalled();
  expect(fixture.continuationExecute).not.toHaveBeenCalled();
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toBeUndefined();
  expect(result.content[0]).toMatchObject({
    type: 'text',
    text: expect.stringContaining('policy version'),
  });
});

test('separate runtimes redeem once with the same safe Interaction ID', async () => {
  const firstTelemetry: ToolPolicyTelemetry[] = [];
  const secondTelemetry: ToolPolicyTelemetry[] = [];
  const fixture = await setupLifecycleFixture({
    runtime: new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
      createJti: () => 'raw-jti-must-not-be-telemetry',
    }),
    responses: [{ action: 'accept', content: { decision: 'execute' } }],
    onToolPolicyCall: ({ telemetry }) => {
      firstTelemetry.push(telemetry);
    },
    continuation: {
      runtime: new ElicitationRuntime({
        approverId: 'approver-1',
        stateKey: STATE_KEY,
      }),
      onToolPolicyCall: ({ telemetry }) => {
        secondTelemetry.push(telemetry);
      },
      mirror: true,
    },
  });

  const result = await fixture.client.callTool({
    name: 'guarded',
    arguments: { value: 'original' },
  });

  expect(result.isError).not.toBe(true);
  expect(fixture.execute).toHaveBeenCalledTimes(1);
  expect(fixture.continuationExecute).toHaveBeenCalledTimes(1);
  expect(firstTelemetry).toHaveLength(2);
  expect(secondTelemetry).toHaveLength(1);
  const interactionId = firstTelemetry[0]?.interactionId;
  expect(interactionId).toEqual(expect.any(String));
  expect(firstTelemetry[1]?.interactionId).toBe(interactionId);
  expect(secondTelemetry[0]?.interactionId).toBe(interactionId);
  expect(JSON.stringify([...firstTelemetry, ...secondTelemetry])).not.toContain(
    'raw-jti-must-not-be-telemetry'
  );
});

test('edited readable expiry fails at the request-state seam with -32602', async () => {
  let edited = false;
  const fixture = await setupLifecycleFixture({
    runtime: new ElicitationRuntime({
      approverId: 'approver-1',
      stateKey: STATE_KEY,
    }),
    responses: [{ action: 'accept', content: { decision: 'execute' } }],
    transformRequest: (body) => {
      if (
        edited ||
        body.method !== 'tools/call' ||
        typeof body.params?.requestState !== 'string'
      ) {
        return;
      }
      edited = true;
      const [prefix, encodedEnvelope, mac] =
        body.params.requestState.split('.');
      const envelope = JSON.parse(
        new TextDecoder().decode(
          Uint8Array.from(
            atob(encodedEnvelope.replaceAll('-', '+').replaceAll('_', '/')),
            (character) => character.codePointAt(0) ?? 0
          )
        )
      );
      envelope.exp += 60;
      const changedEnvelope = btoa(JSON.stringify(envelope))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/, '');
      body.params.requestState = `${prefix}.${changedEnvelope}.${mac}`;
    },
  });

  await expect(
    fixture.client.callTool({
      name: 'guarded',
      arguments: { value: 'original' },
    })
  ).rejects.toMatchObject({ code: -32602 });
  expect(fixture.execute).not.toHaveBeenCalled();
});

test('policy output accepts business and terminal variants', () => {
  const schema = withPolicyOutput(z.object({ value: z.string() }));

  expect(schema.parse({ value: 'business' })).toEqual({ value: 'business' });
  expect(schema.parse({ status: 'declined' })).toEqual({
    status: 'declined',
  });
  expect(schema.parse({ status: 'cancelled' })).toEqual({
    status: 'cancelled',
  });
});
