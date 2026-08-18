import { describe, expect, it } from 'vitest';

import { createPoc, InMemoryJtiStore } from '../src/server.js';
import { rawToolCall } from './harness.js';

const args = {
  name: 'replay-test-project',
  organization_id: 'org-1',
};
const inputResponses = {
  confirm_cost: {
    action: 'accept',
    content: { confirm: true },
  },
};

async function obtainState(poc: ReturnType<typeof createPoc>): Promise<string> {
  const response = await rawToolCall({
    poc,
    declareElicitation: true,
    args,
  });

  expect(response.status).toBe(200);
  expect(response.body.result.resultType).toBe('input_required');
  return response.body.result.requestState as string;
}

async function redeem(poc: ReturnType<typeof createPoc>, requestState: string) {
  return rawToolCall({
    poc,
    declareElicitation: true,
    args,
    inputResponses,
    requestState,
  });
}

function expectCreated(response: Awaited<ReturnType<typeof redeem>>): void {
  expect(response.status).toBe(200);
  expect(response.body.error).toBeUndefined();
  expect(response.body.result.structuredContent.status).toBe('created');
}

function expectReplayRejected(
  response: Awaited<ReturnType<typeof redeem>>
): void {
  expect(response.status).toBe(200);
  expect(response.body.error).toBeUndefined();
  expect(response.body.result.isError).toBe(true);
  expect(response.body.result.structuredContent.status).toBe('error');
  expect(response.body.result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: expect.stringMatching(/replay|consumed/i),
      }),
    ])
  );
}

describe('requestState replay and jti dedupe', () => {
  it('allows a replay within the TTL when no jti store is configured', async () => {
    const poc = createPoc({ jtiStore: null });
    const requestState = await obtainState(poc);

    expectCreated(await redeem(poc, requestState));
    expectCreated(await redeem(poc, requestState));

    expect(poc.registry.countByName(args.name)).toBe(2);
  });

  it('rejects a consumed jti with an in-memory store', async () => {
    const poc = createPoc({ jtiStore: new InMemoryJtiStore() });
    const requestState = await obtainState(poc);

    expectCreated(await redeem(poc, requestState));
    expectReplayRejected(await redeem(poc, requestState));

    expect(poc.registry.countByName(args.name)).toBe(1);
  });

  it('allows replay across instances with separate in-memory stores', async () => {
    const stateKey = 'risk-3-multi-instance-state-key-2026-07-31';
    const instanceA = createPoc({
      stateKey,
      jtiStore: new InMemoryJtiStore(),
    });
    const instanceB = createPoc({
      stateKey,
      jtiStore: new InMemoryJtiStore(),
    });
    const requestState = await obtainState(instanceA);

    expectCreated(await redeem(instanceA, requestState));
    expectCreated(await redeem(instanceB, requestState));

    expect(instanceA.registry.countByName(args.name)).toBe(1);
    expect(instanceB.registry.countByName(args.name)).toBe(1);
  });

  it('rejects replay across instances that share a jti store', async () => {
    const stateKey = 'risk-3-shared-store-state-key-2026-07-31';
    const jtiStore = new InMemoryJtiStore();
    const instanceA = createPoc({ stateKey, jtiStore });
    const instanceB = createPoc({ stateKey, jtiStore });
    const requestState = await obtainState(instanceA);

    expectCreated(await redeem(instanceA, requestState));
    expectReplayRejected(await redeem(instanceB, requestState));

    expect(instanceA.registry.countByName(args.name)).toBe(1);
    expect(instanceB.registry.countByName(args.name)).toBe(0);
  });

  it('allows completion with a fresh state after missing inputResponses', async () => {
    const poc = createPoc({ jtiStore: new InMemoryJtiStore() });
    const originalState = await obtainState(poc);
    const reissue = await rawToolCall({
      poc,
      declareElicitation: true,
      args,
      requestState: originalState,
    });

    expect(reissue.status).toBe(200);
    expect(reissue.body.error).toBeUndefined();
    expect(reissue.body.result.resultType).toBe('input_required');
    expect(reissue.body.result.requestState).not.toBe(originalState);

    expectCreated(await redeem(poc, reissue.body.result.requestState));
    expect(poc.registry.countByName(args.name)).toBe(1);
  });
});
