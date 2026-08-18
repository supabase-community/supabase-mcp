import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPoc, legacyConfirmToken } from '../src/server.js';
import { createTestClient, rawToolCall, type WireFrame } from './harness.js';

const clients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

function structuredContent(result: unknown): Record<string, any> {
  return (result as { structuredContent: Record<string, any> })
    .structuredContent;
}

function intermediateResults(wire: WireFrame[]): Array<Record<string, any>> {
  return wire
    .filter((frame) => frame.direction === 'response')
    .map((frame) => frame.body?.result)
    .filter((result) => result?.inputRequests !== undefined);
}

describe('risk 4: capability gating', () => {
  it('uses the legacy confirmation token without sending input requests to a non-declaring client', async () => {
    const poc = createPoc();
    const connection = await createTestClient({
      poc,
      elicitation: false,
    });
    clients.push(connection);

    const first = await connection.client.callTool({
      name: 'create_project',
      arguments: {
        name: 'legacy-project',
        organization_id: 'org-1',
      },
    });
    const firstContent = structuredContent(first);

    expect(firstContent.status).toBe('confirmation_required');
    expect(firstContent.confirm_cost_token).toEqual(expect.any(String));

    for (const frame of connection.wire.filter(
      ({ direction }) => direction === 'response'
    )) {
      const body = JSON.stringify(frame.body);
      expect(body).not.toContain('inputRequests');
      expect(body).not.toContain('input_required');
    }

    const retry = await connection.client.callTool({
      name: 'create_project',
      arguments: {
        name: 'legacy-project',
        organization_id: 'org-1',
        confirm_cost_token: firstContent.confirm_cost_token,
      },
    });

    expect(structuredContent(retry).status).toBe('created');
    expect(poc.registry.list()).toHaveLength(1);
  });

  it('elicits exactly once from a declaring client and exposes the form on the wire', async () => {
    const poc = createPoc();
    const responder = vi.fn((_request: { message: string }) => ({
      action: 'accept' as const,
      content: { confirm: true },
    }));
    const connection = await createTestClient({
      poc,
      elicitation: responder,
    });
    clients.push(connection);

    const result = await connection.client.callTool({
      name: 'create_project',
      arguments: {
        name: 'elicited-project',
        organization_id: 'org-1',
      },
    });

    expect(responder).toHaveBeenCalledOnce();
    expect(responder.mock.calls[0]?.[0].message).toContain('$10/month');
    expect(structuredContent(result).status).toBe('created');
    expect(poc.registry.list()).toHaveLength(1);

    const intermediate = intermediateResults(connection.wire);
    expect(intermediate).toHaveLength(1);
    const intermediateResult = intermediate[0];
    if (intermediateResult === undefined) {
      throw new Error('Expected one intermediate result');
    }
    expect(Object.keys(intermediateResult.inputRequests)).toEqual([
      'confirm_cost',
    ]);
    expect(intermediateResult.inputRequests.confirm_cost).toMatchObject({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        requestedSchema: {
          properties: {
            confirm: { type: 'boolean' },
          },
        },
      },
    });
  });

  it("pins the SDK's observed intermediate result discriminator", async () => {
    const poc = createPoc();
    const connection = await createTestClient({
      poc,
      elicitation: () => ({
        action: 'accept',
        content: { confirm: true },
      }),
    });
    clients.push(connection);

    await connection.client.callTool({
      name: 'create_project',
      arguments: {
        name: 'discriminator-project',
        organization_id: 'org-1',
      },
    });

    const intermediate = intermediateResults(connection.wire);
    expect(intermediate).toHaveLength(1);
    const intermediateResult = intermediate[0];
    if (intermediateResult === undefined) {
      throw new Error('Expected one intermediate result');
    }
    expect(intermediateResult.resultType).toBe('input_required');
  });

  it('does not let a precomputed legacy token bypass elicitation for a capable client', async () => {
    const poc = createPoc();
    const name = 'capable-token-project';
    const organizationId = 'org-1';
    const responder = vi.fn(() => {
      expect(poc.registry.list()).toHaveLength(0);
      return {
        action: 'accept' as const,
        content: { confirm: true },
      };
    });
    const connection = await createTestClient({
      poc,
      elicitation: responder,
    });
    clients.push(connection);

    const result = await connection.client.callTool({
      name: 'create_project',
      arguments: {
        name,
        organization_id: organizationId,
        confirm_cost_token: legacyConfirmToken(name, organizationId),
      },
    });

    expect(responder).toHaveBeenCalledOnce();
    expect(intermediateResults(connection.wire)).toHaveLength(1);
    expect(structuredContent(result).status).toBe('created');
    expect(poc.registry.list()).toHaveLength(1);
  });

  it('does not redeem declaring-client state and responses on a non-declaring request', async () => {
    const poc = createPoc();
    const args = {
      name: 'cross-capability-project',
      organization_id: 'org-1',
    };
    const initial = await rawToolCall({
      poc,
      declareElicitation: true,
      args,
    });
    const requestState = initial.body?.result?.requestState;

    expect(initial.status).toBe(200);
    expect(initial.body?.result?.resultType).toBe('input_required');
    expect(requestState).toEqual(expect.any(String));

    const redemption = await rawToolCall({
      poc,
      declareElicitation: false,
      args,
      requestState,
      inputResponses: {
        confirm_cost: {
          action: 'accept',
          content: { confirm: true },
        },
      },
    });

    expect(redemption.status).toBe(200);
    expect(redemption.body?.result?.structuredContent).toMatchObject({
      status: 'confirmation_required',
      confirm_cost_token: expect.any(String),
    });
    expect(poc.registry.list()).toHaveLength(0);
  });
});
