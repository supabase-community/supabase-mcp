import type { InputResponseView } from '@modelcontextprotocol/server';
import { describe, expect, test, vi } from 'vitest';

import type { CreationRate } from '../platform/types.js';
import {
  APPROVED_RATE_STALE,
  assertRateStillApproved,
  costConfirmationMessage,
  createCostConfirmationPolicy,
  creationOutcomeMessage,
  POLICY_VERSION,
  type CostConfirmationProposal,
  type CostConfirmationPolicyOptions,
} from './cost-confirmation.js';

type Args = { name: string; organization_id: string };

const BILLABLE: CreationRate = {
  amount: 10,
  currency: 'USD',
  recurrence: 'monthly',
};

const PROPOSAL: CostConfirmationProposal = {
  action: 'create_project',
  resourceName: 'demo',
  account: { type: 'organization', id: 'acme' },
  rate: BILLABLE,
};

function policyFor(rate: CreationRate) {
  const readRate = vi.fn(async () => rate);
  const options: CostConfirmationPolicyOptions<Args> = {
    action: 'create_project',
    canonicalArguments: ({ name, organization_id }) => ({
      name,
      organization_id,
    }),
    subject: ({ name, organization_id }) => ({
      resourceName: name,
      account: { type: 'organization', id: organization_id },
    }),
    readRate,
  };

  return { policy: createCostConfirmationPolicy(options), readRate };
}

/** One embedded request, so its key is whatever the policy asked under. */
function onlyRequest(proposal: CostConfirmationProposal) {
  const requests = createCostConfirmationPolicy<Args>({
    action: proposal.action,
    canonicalArguments: (args) => args,
    subject: () => ({
      resourceName: proposal.resourceName,
      account: proposal.account,
    }),
    readRate: async () => proposal.rate,
  }).inputRequests(proposal);

  const entries = Object.entries(requests);
  expect(entries).toHaveLength(1);
  return entries[0]!;
}

async function answerWith(
  proposal: CostConfirmationProposal,
  answer: InputResponseView
) {
  const [key] = onlyRequest(proposal);
  const { policy } = policyFor(proposal.rate);
  return policy.resolve(proposal, { [key]: answer });
}

/** Narrows one embedded request down to the schema it asked with. */
function requestedSchemaOf(request: unknown): {
  properties: Record<string, unknown>;
  required?: unknown;
} {
  if (
    request === null ||
    typeof request !== 'object' ||
    !('params' in request) ||
    request.params === null ||
    typeof request.params !== 'object' ||
    !('requestedSchema' in request.params)
  ) {
    throw new Error('embedded request carried no requested schema');
  }

  const schema = request.params.requestedSchema;
  if (
    schema === null ||
    typeof schema !== 'object' ||
    !('properties' in schema) ||
    schema.properties === null ||
    typeof schema.properties !== 'object'
  ) {
    throw new Error('requested schema carried no properties object');
  }

  return {
    properties: schema.properties as Record<string, unknown>,
    required: 'required' in schema ? schema.required : undefined,
  };
}

describe('authoritative rates', () => {
  test('an authoritative rate reaches the proposal with its currency and recurrence', async () => {
    const hourly: CreationRate = {
      amount: 0.01344,
      currency: 'USD',
      recurrence: 'hourly',
    };
    const { policy, readRate } = policyFor(hourly);

    const preparation = await policy.prepare({
      name: 'demo',
      organization_id: 'acme',
    });

    expect(readRate).toHaveBeenCalledTimes(1);
    expect(preparation).toStrictEqual({
      type: 'elicit',
      proposal: {
        action: 'create_project',
        resourceName: 'demo',
        account: { type: 'organization', id: 'acme' },
        rate: hourly,
      },
    });
  });

  test('a zero authoritative rate executes without asking, and still carries the ceiling', async () => {
    const free: CreationRate = {
      amount: 0,
      currency: 'USD',
      recurrence: 'monthly',
    };
    const { policy } = policyFor(free);

    // The ceiling travels into execution even though nothing was asked, which
    // is what keeps the check before creation meaningful on this lane.
    expect(
      await policy.prepare({ name: 'demo', organization_id: 'acme' })
    ).toStrictEqual({
      type: 'execute',
      resolution: { maximumCreationRate: free },
    });
  });
});

describe('action-only consent', () => {
  test('the confirmation asks for no properties', () => {
    const [, request] = onlyRequest(PROPOSAL);

    // A property-less schema is the whole mechanism: with no field to fill in,
    // no response content can stand in for the caller's answer.
    expect(request).toMatchObject({
      method: 'elicitation/create',
      params: {
        mode: 'form',
        requestedSchema: { type: 'object', properties: {} },
      },
    });

    const schema = requestedSchemaOf(request);
    expect(Object.keys(schema.properties)).toEqual([]);
    expect(schema.required).toBeUndefined();
  });

  test('accept grants consent even when the response body says otherwise', async () => {
    expect(
      await answerWith(PROPOSAL, {
        kind: 'elicit',
        action: 'accept',
        content: { confirm: false, approved: 'no' },
      })
    ).toStrictEqual({
      type: 'execute',
      resolution: { maximumCreationRate: BILLABLE },
    });
  });

  test('decline and cancel never grant consent, and stay distinct', async () => {
    const declined = await answerWith(PROPOSAL, {
      kind: 'elicit',
      action: 'decline',
      content: { confirm: true },
    });
    const cancelled = await answerWith(PROPOSAL, {
      kind: 'elicit',
      action: 'cancel',
      content: { confirm: true },
    });

    expect(declined.type).toBe('declined');
    expect(cancelled.type).toBe('cancelled');
  });

  test('an unanswered confirmation asks again instead of assuming', async () => {
    expect(await answerWith(PROPOSAL, { kind: 'missing' })).toStrictEqual({
      type: 'reissue',
    });
  });

  test('the policy version is 2, bound into every proposal it signs', () => {
    const { policy } = policyFor(BILLABLE);

    // Version 1 read consent out of the response body. The runtime rejects a
    // version it does not own before interpreting any response, so this number
    // is what keeps a v1 answer from authorizing a v2 execution and back.
    expect(POLICY_VERSION).toBe(2);
    expect(policy.version).toBe(POLICY_VERSION);
  });
});

describe('draft copy', () => {
  // Swap this test for one approved-copy contract when Design and PM sign off
  // (root gate M1). It pins the facts, never the wording around them.
  test('the confirmation states the facts a caller decides on', () => {
    const message = costConfirmationMessage(PROPOSAL);

    expect(message).toContain('project');
    expect(message).toContain('"demo"');
    expect(message).toContain('acme');
    expect(message).toContain('10 USD');
    expect(message).toContain('per month');
    expect(message).toContain('recurs until');
    expect(message).toContain('Accept');
    expect(message).toContain('decline');
  });

  test('the projection slot stays empty until Billing approves a convention', () => {
    // Root gate M2. A total over time needs an hours-per-month convention this
    // package must not invent, so the message says the rate and its interval
    // and stops there. No hours constant appears anywhere in it.
    const hourly = costConfirmationMessage({
      ...PROPOSAL,
      action: 'create_branch',
      account: { type: 'parent_project', id: 'parent-ref' },
      rate: { amount: 0.01344, currency: 'USD', recurrence: 'hourly' },
    });

    expect(hourly).toContain('0.01344 USD per hour');
    expect(hourly).not.toMatch(/\b(720|730|744)\b/);
    expect(hourly).not.toMatch(/per month/);
  });

  test('a creation reports what the client said, or that nothing was asked', () => {
    const accepted = creationOutcomeMessage('create_project', 'demo', BILLABLE);
    const unprompted = creationOutcomeMessage('create_branch', 'develop', {
      amount: 0,
      currency: 'USD',
      recurrence: 'hourly',
    });

    // Client-reported, never a claim that a person saw the prompt.
    expect(accepted).toContain('The client reported');
    expect(accepted).toContain('was created');
    // Nothing was asked on a zero rate, so nothing may be reported as accepted.
    expect(unprompted).not.toContain('client reported');
    expect(unprompted).toContain('no confirmation was requested');
    expect(unprompted).toContain('was created');
  });
});

describe('approved ceiling', () => {
  const approved: CreationRate = {
    amount: 10,
    currency: 'USD',
    recurrence: 'monthly',
  };

  test('an equal or lower rate proceeds', () => {
    expect(() => assertRateStillApproved(approved, approved)).not.toThrow();
    expect(() =>
      assertRateStillApproved({ ...approved, amount: 4 }, approved)
    ).not.toThrow();
  });

  test('a higher rate, a changed recurrence, or a changed currency does not', () => {
    // A smaller number under a different interval or currency is not a lower
    // price, so neither may spend an approval.
    for (const stale of [
      { ...approved, amount: 11 },
      { ...approved, amount: 1, recurrence: 'hourly' as const },
      { ...approved, amount: 1, currency: 'EUR' },
    ]) {
      expect(() => assertRateStillApproved(stale, approved)).toThrowError(
        new RegExp(APPROVED_RATE_STALE)
      );
    }
  });

  test('the refusal states that nothing was created', () => {
    expect(() =>
      assertRateStillApproved({ ...approved, amount: 11 }, approved)
    ).toThrowError(/nothing was created/);
  });
});
