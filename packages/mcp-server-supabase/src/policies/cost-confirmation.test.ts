import {
  ElicitationRuntime,
  type ToolPolicyDecision,
  type ToolRequestContext,
} from '@supabase/mcp-utils';
import { describe, expect, test, vi } from 'vitest';
import { z } from 'zod/v4';

import { AWS_REGION_CODES } from '../regions.js';
import { createCostConfirmationPolicy } from './cost-confirmation.js';

const STATE_KEY = new Uint8Array(32).fill(4);
const NOW = 1_800_000_000_000;
const PROJECT_COST_HASH = 'BGoZHqqJd2JYMt+cWSDFH7qDeNkZZAwbTytJrHy7r+E=';

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
  formDeliveryAvailable = true,
  formSupportReason = formElicitation ? 'available' : 'capability',
  requestState,
  inputResponses,
}: {
  formElicitation: boolean;
  formDeliveryAvailable?: boolean;
  formSupportReason?: ToolRequestContext['formSupportReason'];
  requestState?: unknown;
  inputResponses?: unknown;
}): ToolRequestContext {
  return {
    era: formElicitation ? 'modern' : 'legacy',
    formElicitation,
    formDeliveryAvailable,
    formSupportReason,
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
  ] as const)(
    'resolves $expected for $response.action',
    async ({ response, expected }) => {
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
      const first = await policy.resolve(
        args,
        context({ formElicitation: true })
      );
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
    }
  );

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
    const first = await policy.resolve(
      args,
      context({ formElicitation: true })
    );
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

  test('routes an opted-out initial leg through legacy confirmation', async () => {
    const policy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost: async () => ({
        type: 'project',
        recurrence: 'monthly',
        amount: 10,
      }),
      runtime: humanRuntime(),
    });

    const decision = await policy.resolve(
      {
        name: 'database',
        region: 'us-east-1',
        organization_id: 'org-1',
        confirm_cost_id: PROJECT_COST_HASH,
      },
      context({
        formElicitation: false,
        formSupportReason: 'opt_out',
      })
    );

    expect(decision).toMatchObject({
      type: 'execute',
      resolution: {
        maximumCreationRate: { amount: 10, recurrence: 'monthly' },
      },
    });
  });

  test('resumes and consumes valid state when the connection opts out mid-flow', async () => {
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
    const first = await policy.resolve(
      args,
      context({ formElicitation: true })
    );
    const verified = await verifyDecisionState(runtime, first);
    const retry = context({
      formElicitation: false,
      formSupportReason: 'opt_out',
      requestState: verified,
      inputResponses: {
        cost_confirmation: {
          action: 'accept',
          content: { confirm: true },
        },
      },
    });

    const completed = await policy.resolve(args, retry);
    expect(completed).toMatchObject({
      type: 'execute',
      resolution: {
        maximumCreationRate: { amount: 0.01344, recurrence: 'hourly' },
      },
    });

    const replay = await policy.resolve(args, retry);
    expect(replay).toMatchObject({
      type: 'result',
      result: {
        isError: true,
        content: [{ text: expect.stringContaining('already used') }],
      },
    });
  });

  test('rejects continuation after genuine capability loss', async () => {
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
    const first = await policy.resolve(
      args,
      context({ formElicitation: true })
    );
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

  test('preserves complete legacy creation input schemas byte for byte', () => {
    const projectPolicy = createCostConfirmationPolicy<ProjectArguments>({
      tool: 'create_project',
      getCost: async () => ({
        type: 'project',
        amount: 10,
        recurrence: 'monthly',
      }),
      runtime: humanRuntime(),
    });
    const branchPolicy = createCostConfirmationPolicy<BranchArguments>({
      tool: 'create_branch',
      getCost: async () => ({
        type: 'branch',
        amount: 0.01344,
        recurrence: 'hourly',
      }),
      runtime: humanRuntime(),
    });
    const projectInput = z.object({
      name: z.string().describe('The name of the project'),
      region: z
        .enum(AWS_REGION_CODES)
        .describe('The region to create the project in.'),
      organization_id: z.string(),
      confirm_cost_id: z
        .string()
        .optional()
        .describe('The cost confirmation ID. Call `confirm_cost` first.'),
    });
    const branchInput = z.object({
      project_id: z.string(),
      name: z
        .string()
        .default('develop')
        .describe('Name of the branch to create'),
      confirm_cost_id: z
        .string()
        .optional()
        .describe('The cost confirmation ID. Call `confirm_cost` first.'),
    });
    const legacy = context({ formElicitation: false });
    const projectSchema = projectPolicy.inputSchema?.(projectInput, legacy);
    const branchSchema = branchPolicy.inputSchema?.(branchInput, legacy);

    expect(z.toJSONSchema(projectSchema!)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        name: { description: 'The name of the project', type: 'string' },
        region: {
          description: 'The region to create the project in.',
          type: 'string',
          enum: [
            'us-west-1',
            'us-east-1',
            'us-east-2',
            'ca-central-1',
            'eu-west-1',
            'eu-west-2',
            'eu-west-3',
            'eu-central-1',
            'eu-central-2',
            'eu-north-1',
            'ap-south-1',
            'ap-southeast-1',
            'ap-northeast-1',
            'ap-northeast-2',
            'ap-southeast-2',
            'sa-east-1',
          ],
        },
        organization_id: { type: 'string' },
        confirm_cost_id: {
          description: 'The cost confirmation ID. Call `confirm_cost` first.',
          type: 'string',
        },
      },
      required: ['name', 'region', 'organization_id', 'confirm_cost_id'],
      additionalProperties: false,
    });
    expect(z.toJSONSchema(branchSchema!)).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        project_id: { type: 'string' },
        name: {
          description: 'Name of the branch to create',
          type: 'string',
          default: 'develop',
        },
        confirm_cost_id: {
          description: 'The cost confirmation ID. Call `confirm_cost` first.',
          type: 'string',
        },
      },
      required: ['project_id', 'name', 'confirm_cost_id'],
      additionalProperties: false,
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

  test('runtime gate blocks protected modern policy before a rate read', async () => {
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
            text: 'Blocked by the runtime gate.',
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
            text: 'Blocked by the runtime gate.',
          },
        ],
      },
      telemetry: {
        authorityPath: 'human_confirmation',
        outcome: 'blocked',
        reason: 'gate',
        policyId: 'supabase-cost-confirmation',
        policyVersion: 1,
      },
    });
    expect(getCost).not.toHaveBeenCalled();
  });
});
