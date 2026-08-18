import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PROJECT_COST,
  createPoc,
  legacyConfirmToken,
  type Poc,
} from '../src/server.js';
import { rawToolCall } from './harness.js';

const accept = {
  confirm_cost: { action: 'accept', content: { confirm: true } },
};

type ProjectArgs = { name: string; organization_id: string };

async function mint(
  poc: Poc,
  args: ProjectArgs,
  bearer = 'user-alice'
): Promise<string> {
  const response = await rawToolCall({
    poc,
    bearer,
    declareElicitation: true,
    args,
  });
  expect(response.status).toBe(200);
  expect(response.body.result.resultType).toBe('input_required');
  return response.body.result.requestState as string;
}

async function redeem(
  poc: Poc,
  args: ProjectArgs,
  requestState: string,
  bearer = 'user-alice'
) {
  return rawToolCall({
    poc,
    bearer,
    declareElicitation: true,
    args,
    requestState,
    inputResponses: accept,
  });
}

function expectCodecRejection(response: Awaited<ReturnType<typeof redeem>>) {
  expect(response.status).toBe(200);
  expect(response.body.error).toMatchObject({
    code: -32602,
    message: expect.stringMatching(/invalid or expired requestState/i),
  });
}

function expectHandlerRejection(
  response: Awaited<ReturnType<typeof redeem>>,
  message: RegExp
) {
  expect(response.status).toBe(200);
  expect(response.body.error).toBeUndefined();
  expect(response.body.result.isError).toBe(true);
  expect(response.body.result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'text',
        text: expect.stringMatching(message),
      }),
    ])
  );
}

async function expectFreshFlowSucceeds(
  poc: Poc,
  args: ProjectArgs,
  bearer = 'user-alice'
) {
  const freshState = await mint(poc, args, bearer);
  const response = await redeem(poc, args, freshState, bearer);
  expect(response.body.error).toBeUndefined();
  expect(response.body.result.isError).not.toBe(true);
  expect(response.body.result.structuredContent.status).toBe('created');
}

function flipMiddleCharacter(value: string): string {
  const index = Math.floor(value.length / 2);
  const replacement = value[index] === 'A' ? 'B' : 'A';
  return `${value.slice(0, index)}${replacement}${value.slice(index + 1)}`;
}

function alterEncodedPayload(state: string): string {
  const segments = state.split('.');
  expect(segments).toHaveLength(3);
  const encodedPayload = segments[1];
  if (encodedPayload === undefined) {
    throw new Error('Expected an encoded payload segment');
  }
  const payload = JSON.parse(
    Buffer.from(encodedPayload, 'base64url').toString('utf8')
  ) as Record<string, unknown>;
  payload.sub = 'user-mallory';
  segments[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return segments.join('.');
}

describe('requestState token security properties', () => {
  it.each([
    ['single-character mutation', flipMiddleCharacter],
    ['decoded payload mutation', alterEncodedPayload],
  ])('rejects tampered state: %s', async (_, mutate) => {
    const poc = createPoc();
    const args = { name: 'tamper-target', organization_id: 'org-1' };
    const state = await mint(poc, args);

    expectCodecRejection(await redeem(poc, args, mutate(state)));
    expect(poc.registry.list()).toEqual([]);

    await expectFreshFlowSucceeds(poc, args);
    expect(poc.registry.countByName(args.name)).toBe(1);
  });

  it('rejects expired state', async () => {
    const poc = createPoc({ ttlSeconds: 1 });
    const args = { name: 'expired-target', organization_id: 'org-1' };
    const state = await mint(poc, args);

    // The codec stores integer-second exp and accepts the token at the boundary.
    await new Promise((resolve) => setTimeout(resolve, 2_100));

    expectCodecRejection(await redeem(poc, args, state));
    expect(poc.registry.list()).toEqual([]);

    await expectFreshFlowSucceeds(poc, args);
    expect(poc.registry.countByName(args.name)).toBe(1);
  });

  it('rejects state redeemed by a different principal', async () => {
    const poc = createPoc();
    const args = { name: 'principal-target', organization_id: 'org-1' };
    const state = await mint(poc, args, 'user-alice');

    const rejected = await redeem(poc, args, state, 'user-mallory');
    expectHandlerRejection(rejected, /principal.*does not match/i);
    expect(poc.registry.list()).toEqual([]);

    await expectFreshFlowSucceeds(poc, args, 'user-alice');
    expect(poc.registry.countByName(args.name)).toBe(1);
  });

  it('rejects state redeemed with different arguments', async () => {
    const poc = createPoc();
    const original = { name: 'proj-a', organization_id: 'org-1' };
    const changed = { name: 'proj-evil', organization_id: 'org-1' };
    const state = await mint(poc, original);

    const rejected = await redeem(poc, changed, state);
    expectHandlerRejection(rejected, /arguments.*do not match/i);
    expect(poc.registry.countByName(original.name)).toBe(0);
    expect(poc.registry.countByName(changed.name)).toBe(0);

    await expectFreshFlowSucceeds(poc, original);
    expect(poc.registry.countByName(original.name)).toBe(1);
    expect(poc.registry.countByName(changed.name)).toBe(0);
  });

  it('rejects a client-readable payload signed with an attacker key', async () => {
    const poc = createPoc();
    const args = { name: 'forgery-target', organization_id: 'org-1' };
    const genuine = await mint(poc, args);
    const [version, encodedPayload] = genuine.split('.');
    if (version === undefined || encodedPayload === undefined) {
      throw new Error('Expected version and payload segments');
    }
    const payload = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as Record<string, any>;

    expect(payload).toMatchObject({
      p: {
        sub: 'user-alice',
        tool: 'create_project',
        cost: PROJECT_COST,
      },
    });

    payload.p.argsDigest = '0'.repeat(64);
    payload.p.jti = 'attacker-chosen-jti';
    const forgedBody = Buffer.from(JSON.stringify(payload)).toString(
      'base64url'
    );
    const forgedMac = createHmac('sha256', 'attacker-guess')
      .update(`${version}.${forgedBody}`)
      .digest('base64url');
    const forgedState = `${version}.${forgedBody}.${forgedMac}`;

    expectCodecRejection(await redeem(poc, args, forgedState));
    expect(poc.registry.list()).toEqual([]);

    await expectFreshFlowSucceeds(poc, args);
    expect(poc.registry.countByName(args.name)).toBe(1);
  });

  it('contrasts signed state with the legacy precompute path', async () => {
    const poc = createPoc();
    const args = { name: 'legacy-precomputed', organization_id: 'org-1' };
    const confirm_cost_token = legacyConfirmToken(
      args.name,
      args.organization_id
    );

    const response = await rawToolCall({
      poc,
      declareElicitation: false,
      args: { ...args, confirm_cost_token },
    });

    expect(response.body.error).toBeUndefined();
    expect(response.body.result.isError).not.toBe(true);
    expect(response.body.result.structuredContent.status).toBe('created');
    expect(poc.registry.countByName(args.name)).toBe(1);
  });
});
