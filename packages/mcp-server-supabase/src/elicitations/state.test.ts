import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import {
  createMcpHandler,
  inputRequired,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { createMcpServer, tool, type ToolPolicy } from '@supabase/mcp-utils';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { createContinuationState } from './state.js';

const MODERN_PROTOCOL_VERSION = '2026-07-28';
const MCP_ENDPOINT = new URL('https://mcp.test');
const STATE_KEY = 'continuation-state-key-that-is-long-enough';
const ACTOR_ID = 'actor-1';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

const claims = {
  policy: 'test-policy',
  policyVersion: 1,
  tool: 'guarded',
  argsDigest: 'digest-1',
  proposal: { detail: 'proposed' },
};

/**
 * The codec reads only the MCP method from the SDK context, so the rows that
 * exercise binding supply exactly that.
 */
function context(method = 'tools/call'): ServerContext {
  return { mcpReq: { method } } as unknown as ServerContext;
}

function readPayload(wire: string): Record<string, unknown> {
  const body = wire.slice('v1.'.length, wire.lastIndexOf('.'));
  const json = atob(body.replaceAll('-', '+').replaceAll('_', '/'));
  return JSON.parse(json) as Record<string, unknown>;
}

function reseal(wire: string, envelope: unknown): string {
  const body = btoa(JSON.stringify(envelope))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `v1.${body}.${wire.slice(wire.lastIndexOf('.') + 1)}`;
}

/**
 * Edits the MAC at its first character. The tag is 32 bytes in 43 base64url
 * characters, so the final character carries bits a decoder discards: editing
 * there can leave the decoded tag identical and still verify.
 */
function breakMac(wire: string): string {
  const separator = wire.lastIndexOf('.');
  const mac = wire.slice(separator + 1);
  const flipped = mac.startsWith('A') ? 'B' : 'A';
  return `${wire.slice(0, separator + 1)}${flipped}${mac.slice(1)}`;
}

describe('continuation lifetime', () => {
  test('refuses a lifetime beyond the 120 second maximum', () => {
    expect(() =>
      createContinuationState({
        actorId: ACTOR_ID,
        stateKey: STATE_KEY,
        lifetimeSeconds: 121,
      })
    ).toThrow(RangeError);
    expect(() =>
      createContinuationState({
        actorId: ACTOR_ID,
        stateKey: STATE_KEY,
        lifetimeSeconds: 0,
      })
    ).toThrow(RangeError);
  });
});

describe('continuation state', () => {
  test('mints a readable payload that carries no signing secret', async () => {
    const state = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
      clock: () => 1_700_000_000_000,
    });

    const { requestState } = await state.mint(claims, context());
    const envelope = readPayload(requestState);

    expect(envelope.p).toStrictEqual({
      v: 1,
      policyVersion: 1,
      policy: 'test-policy',
      tool: 'guarded',
      argsDigest: 'digest-1',
      proposal: { detail: 'proposed' },
      jti: expect.any(String),
      iat: 1_700_000_000,
      exp: 1_700_000_120,
    });
    expect(requestState).not.toContain(STATE_KEY);
    expect(JSON.stringify(envelope)).not.toContain(STATE_KEY);
    expect(JSON.stringify(envelope)).not.toContain(ACTOR_ID);
  });

  test('round-trips its own state without exposing the correlation id', async () => {
    const state = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
    });

    const minted = await state.mint(claims, context());
    const verified = await state.verify(minted.requestState, context());

    expect(verified.kind).toBe('valid');
    expect(verified.interactionId).toBe(minted.interactionId);
    if (verified.kind !== 'valid') {
      throw new Error('expected valid state');
    }
    expect(verified.state).toMatchObject({
      v: 1,
      policy: 'test-policy',
      tool: 'guarded',
      argsDigest: 'digest-1',
      proposal: { detail: 'proposed' },
    });
    expect('jti' in verified.state).toBe(false);
    expect(verified.interactionId).not.toContain(
      String(readPayload(minted.requestState).jti)
    );
  });

  test('refuses malformed state, payload mutation, and a broken MAC', async () => {
    const state = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
    });
    const { requestState } = await state.mint(claims, context());
    const envelope = readPayload(requestState) as {
      p: Record<string, unknown>;
    };

    await expect(state.verify('not-request-state', context())).rejects.toThrow(
      'malformed'
    );
    await expect(
      state.verify(
        reseal(requestState, {
          ...envelope,
          p: { ...envelope.p, tool: 'other_tool' },
        }),
        context()
      )
    ).rejects.toThrow('mac');
    await expect(
      state.verify(breakMac(requestState), context())
    ).rejects.toThrow('mac');
  });

  test('refuses another actor and another MCP method', async () => {
    const minter = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
    });
    const otherActor = createContinuationState({
      actorId: 'actor-2',
      stateKey: STATE_KEY,
    });
    const { requestState } = await minter.mint(claims, context());

    await expect(otherActor.verify(requestState, context())).rejects.toThrow(
      'bind'
    );
    await expect(
      minter.verify(requestState, context('prompts/get'))
    ).rejects.toThrow('bind');
  });

  test('expires at the fixed 120 second maximum between whole-second boundaries', async () => {
    let now = 1_700_000_000_500;
    const state = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
      clock: () => now,
    });

    const minted = await state.mint(claims, context());
    now += 120_000;
    const verified = await state.verify(minted.requestState, context());

    expect(verified).toStrictEqual({
      kind: 'expired',
      interactionId: minted.interactionId,
    });
  });
});

describe('served request-state seam', () => {
  test('answers refused state with the SDK-owned invalid params error', async () => {
    const state = createContinuationState({
      actorId: ACTOR_ID,
      stateKey: STATE_KEY,
    });
    const mintOnFirstRound: ToolPolicy<
      { value: string },
      undefined
    >['resolve'] = async (_params, ctx) => {
      const minted = await state.mint(claims, ctx.server);
      return {
        type: 'result',
        result: inputRequired({ requestState: minted.requestState }),
        telemetry: {
          policyId: 'state-test-policy',
          policyVersion: 1,
          outcome: 'input_required',
        },
      };
    };
    const resolve = vi.fn(mintOnFirstRound);

    const handler = createMcpHandler(
      () =>
        createMcpServer({
          name: 'state-test-server',
          version: '0.0.0',
          requestState: { verify: state.verify },
          tools: {
            guarded: tool({
              description: 'Guarded',
              parameters: z.object({ value: z.string() }),
              outputSchema: z.object({ value: z.string() }),
              policy: { resolve },
              execute: async ({ value }) => ({ value }),
            }),
          },
        }),
      { legacy: 'reject' }
    );
    const transport = new StreamableHTTPClientTransport(MCP_ENDPOINT, {
      fetch: async (url, init) => {
        // The body is the JSON-RPC request this same test just sent.
        const body = (await new Request(url, init).json()) as {
          params?: { requestState?: string };
        };
        // Edit the echoed value, the cheapest stand-in for any
        // attacker-controlled change to state the client holds.
        if (typeof body.params?.requestState === 'string') {
          body.params.requestState = breakMac(body.params.requestState);
        }
        return handler.fetch(
          new Request(url, { ...init, body: JSON.stringify(body) })
        );
      },
    });
    const client = new Client(
      { name: 'state-test-client', version: '1.2.3' },
      {
        capabilities: { elicitation: {} },
        versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
      }
    );

    await client.connect(transport);
    cleanups.push(
      () => client.close(),
      () => handler.close()
    );

    const call = client.callTool({
      name: 'guarded',
      arguments: { value: 'hi' },
    });

    await expect(call).rejects.toMatchObject({
      code: -32602,
      message: 'Invalid or expired requestState',
      data: { reason: 'invalid_request_state' },
    });
    // The second round never reached the policy.
    expect(resolve.mock.calls).toHaveLength(1);
  });
});
