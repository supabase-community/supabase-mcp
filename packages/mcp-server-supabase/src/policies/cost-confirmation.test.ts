import {
  ElicitationRuntime,
  type ToolPolicyDecision,
  type ToolRequestContext,
} from '@supabase/mcp-utils';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { createCostConfirmationPolicy } from './cost-confirmation.js';

const STATE_KEY = new Uint8Array(32).fill(4);
const NOW = 1_800_000_000_000;
const PROJECT_COST_HASH =
  'BGoZHqqJd2JYMt+cWSDFH7qDeNkZZAwbTytJrHy7r+E=';

type ProjectArguments = {
  name: string;
  region: string;
  organization_id: string;
  confirm_cost_id?: string;
  protocol_metadata?: string;
};

type BranchArguments = {
  name: string;
  project_id: string;
  confirm_cost_id?: string;
};

function context({
  formElicitation,
  requestState,
  inputResponses,
}: {
  formElicitation: boolean;
  requestState?: unknown;
  inputResponses?: unknown;
}): ToolRequestContext {
  return {
    era: formElicitation ? 'modern' : 'legacy',
    formElicitation,
    formSupportReason: formElicitation ? 'available' : 'capability',
    server: {
      mcpReq: {
        method: 'tools/call',
        requestState: () => requestState,
        inputResponses,
      },
    } as ToolRequestContext['server'],
  };
}

function humanRuntime(
  gate?: ConstructorParameters<typeof ElicitationRuntime>[0]['gate']
) {
  return new ElicitationRuntime({
    approverId: 'approver-1',
    stateKey: STATE_KEY,
    clock: () => NOW,
    createJti: () => 'fixed-jti',
    gate,
  });
}

async function verifyDecisionState(
  runtime: ElicitationRuntime,
  decision: ToolPolicyDecision<unknown>
) {
  if (
    decision.type !== 'result' ||
    !('requestState' in decision.result) ||
    typeof decision.result.requestState !== 'string'
  ) {
    throw new Error('Expected input_required result');
  }
  return runtime.requestState.verify(
    decision.result.requestState,
    context({ formElicitation: true }).server
  );
}

function inputMessage(decision: ToolPolicyDecision<unknown>): string {
  if (decision.type !== 'result' || !('inputRequests' in decision.result)) {
    throw new Error('Expected input_required result');
  }
  return JSON.stringify(decision.result.inputRequests);
}

describe('Human Confirmation cost policy', () => {
  test('executes a zero-rate project without requesting input', async () => {
    const getCost = vi.fn(async () => ({
      type: 'project' as const,
      amount: 0,
      recurrence: 'monthly' as const,
    }));
    const policy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost,
      runtime: humanRuntime(),
    });

    const decision = await policy.resolve(
      {
        name: 'free-project',
        region: 'us-east-1',
        organization_id: 'org-1',
      },
      context({ formElicitation: true })
    );

    expect(decision).toMatchObject({
      type: 'execute',
      resolution: {
        maximumCreationRate: { amount: 0, recurrence: 'monthly' },
      },
    });
    expect(getCost).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      response: { action: 'accept', content: { confirm: true } },
      expected: 'execute',
    },
    {
      response: { action: 'accept', content: { confirm: false } },
      expected: 'declined',
    },
    { response: { action: 'decline' }, expected: 'declined' },
    { response: { action: 'cancel' }, expected: 'cancelled' },
  ] as const)('resolves $expected for $response.action', async ({ response, expected }) => {
    const runtime = humanRuntime();
    const policy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost: async () => ({
        type: 'branch',
        amount: 0.01344,
        recurrence: 'hourly',
      }),
      runtime,
    });
    const args = { name: 'preview', project_id: 'project-1' };
    const first = await policy.resolve(args, context({ formElicitation: true }));
    const verified = await verifyDecisionState(runtime, first);

    const decision = await policy.resolve(
      args,
      context({
        formElicitation: true,
        requestState: verified,
        inputResponses: { cost_confirmation: response },
      })
    );

    if (expected === 'execute') {
      expect(decision).toMatchObject({
        type: 'execute',
        resolution: {
          maximumCreationRate: { amount: 0.01344, recurrence: 'hourly' },
        },
      });
    } else {
      expect(decision).toMatchObject({
        type: 'result',
        result: { structuredContent: { status: expected } },
      });
    }
  });

  test('reissues from the signed proposal without reading a fresh rate', async () => {
    const getCost = vi
      .fn()
      .mockResolvedValueOnce({
        type: 'branch',
        amount: 0.01344,
        recurrence: 'hourly',
      })
      .mockResolvedValue({
        type: 'branch',
        amount: 99,
        recurrence: 'hourly',
      });
    const runtime = humanRuntime();
    const policy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost,
      runtime,
    });
    const args = { name: 'preview', project_id: 'project-1' };
    const first = await policy.resolve(args, context({ formElicitation: true }));
    const verified = await verifyDecisionState(runtime, first);

    const reissued = await policy.resolve(
      args,
      context({
        formElicitation: true,
        requestState: verified,
        inputResponses: {
          cost_confirmation: { action: 'accept', content: {} },
        },
      })
    );

    expect(getCost).toHaveBeenCalledTimes(1);
    expect(inputMessage(reissued)).toContain('0.01344');
    expect(inputMessage(reissued)).not.toContain('99');
  });

  test('states the live rate, continuous-run projection, and assumption', async () => {
    const policy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost: async () => ({
        type: 'branch',
        amount: 0.01344,
        recurrence: 'hourly',
      }),
      runtime: humanRuntime(),
    });

    const decision = await policy.resolve(
      { name: 'preview', project_id: 'project-1' },
      context({ formElicitation: true })
    );
    const message = inputMessage(decision);
    expect(decision).toMatchObject({
      type: 'result',
      result: {
        inputRequests: {
          cost_confirmation: {
            params: {
              requestedSchema: {
                type: 'object',
                properties: { confirm: { type: 'boolean' } },
                required: ['confirm'],
              },
            },
          },
        },
      },
    });

    expect(message).toContain('0.01344');
    expect(message).toContain('9.68');
    expect(message).toContain('720');
    expect(message).toMatch(/continuous/i);
    expect(message).toMatch(/delete/i);
  });

  test('binds continuation state only to effective business arguments', async () => {
    const runtime = humanRuntime();
    const policy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost: async () => ({
        type: 'project',
        amount: 10,
        recurrence: 'monthly',
      }),
      runtime,
    });
    const firstArgs = {
      name: 'database',
      region: 'us-east-1',
      organization_id: 'org-1',
      confirm_cost_id: 'ignored-first',
      protocol_metadata: 'ignored-first',
    };
    const first = await policy.resolve(
      firstArgs,
      context({ formElicitation: true })
    );
    const verified = await verifyDecisionState(runtime, first);

    const decision = await policy.resolve(
      {
        ...firstArgs,
        confirm_cost_id: 'ignored-second',
        protocol_metadata: 'ignored-second',
      },
      context({
        formElicitation: true,
        requestState: verified,
        inputResponses: {
          cost_confirmation: {
            action: 'accept',
            content: { confirm: true },
          },
        },
      })
    );

    expect(decision.type).toBe('execute');
  });
});

describe('cost policy authority selection and schemas', () => {
  test('uses the deterministic legacy hash and missing-ID message without form support', async () => {
    const policy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost: async () => ({
        type: 'project',
        recurrence: 'monthly',
        amount: 10,
      }),
      runtime: humanRuntime(),
    });

    await expect(
      policy.resolve(
        {
          name: 'database',
          region: 'us-east-1',
          organization_id: 'org-1',
        },
        context({ formElicitation: false })
      )
    ).rejects.toThrow(
      'Cost confirmation ID does not match the expected cost of creating a project.'
    );

    const decision = await policy.resolve(
      {
        name: 'database',
        region: 'us-east-1',
        organization_id: 'org-1',
        confirm_cost_id: PROJECT_COST_HASH,
      },
      context({ formElicitation: false })
    );
    expect(decision).toMatchObject({
      type: 'execute',
      resolution: {
        maximumCreationRate: { amount: 10, recurrence: 'monthly' },
      },
    });
  });

  test('resumes Human Confirmation state before consulting current capability', async () => {
    const runtime = humanRuntime();
    const policy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost: async () => ({
        type: 'branch',
        amount: 0.01344,
        recurrence: 'hourly',
      }),
      runtime,
    });
    const args = { name: 'preview', project_id: 'project-1' };
    const first = await policy.resolve(args, context({ formElicitation: true }));
    const verified = await verifyDecisionState(runtime, first);

    const decision = await policy.resolve(
      args,
      context({
        formElicitation: false,
        requestState: verified,
        inputResponses: {
          cost_confirmation: {
            action: 'accept',
            content: { confirm: true },
          },
        },
      })
    );

    expect(decision).toMatchObject({
      type: 'result',
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('can no longer continue') }],
      },
    });
  });

  test('omits the legacy token from capable input and adds terminal outputs', () => {
    const policy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost: async () => ({
        type: 'project',
        amount: 10,
        recurrence: 'monthly',
      }),
      runtime: humanRuntime(),
    });
    const input = z.object({
      name: z.string(),
      region: z.string(),
      organization_id: z.string(),
      confirm_cost_id: z.string(),
    });
    const output = z.object({ id: z.string() });
    const capable = context({ formElicitation: true });
    const incapable = context({ formElicitation: false });

    expect(
      policy.inputSchema
        ? policy.inputSchema(input, capable).safeParse({
            name: 'database',
            region: 'us-east-1',
            organization_id: 'org-1',
          }).success
        : false
    ).toBe(true);
    expect(policy.inputSchema?.(input, incapable)).toBe(input);
    expect(
      policy.normalizeArguments?.(
        {
          name: 'database',
          region: 'us-east-1',
          organization_id: 'org-1',
          confirm_cost_id: 'ignored',
        },
        capable
      )
    ).toEqual({
      name: 'database',
      region: 'us-east-1',
      organization_id: 'org-1',
    });
    const outputSchema = policy.outputSchema?.(output, capable);
    expect(outputSchema?.safeParse({ id: 'project-1' }).success).toBe(true);
    expect(outputSchema?.safeParse({ status: 'declined' }).success).toBe(true);
    expect(outputSchema?.safeParse({ status: 'cancelled' }).success).toBe(true);
    expect(policy.outputSchema?.(output, incapable)).toBe(output);
  });

  test('kill switch blocks protected modern policy before a rate read', async () => {
    const getCost = vi.fn(async () => ({
      type: 'branch' as const,
      amount: 0.01344,
      recurrence: 'hourly' as const,
    }));
    const policy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost,
      runtime: humanRuntime(() => ({
        content: [
          {
            type: 'text',
            text: 'Human Confirmation is temporarily unavailable.',
          },
        ],
        isError: true,
      })),
    });

    const blocked = await policy.resolve(
      { name: 'preview', project_id: 'project-1' },
      context({ formElicitation: true })
    );

    expect(blocked).toMatchObject({
      type: 'result',
      result: {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Human Confirmation is temporarily unavailable.',
          },
        ],
      },
      telemetry: {
        authorityPath: 'human_confirmation',
        outcome: 'blocked',
        reason: 'kill_switch',
        policyId: 'supabase-cost-confirmation',
        policyVersion: 1,
      },
    });
    expect(getCost).not.toHaveBeenCalled();
  });
});
