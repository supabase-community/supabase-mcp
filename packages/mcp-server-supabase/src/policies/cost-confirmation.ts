import { inputRequired } from '@modelcontextprotocol/server';
import {
  type ElicitationPolicy,
  type ElicitationRuntime,
  type ToolPolicy,
  type ToolPolicyDecision,
  type ToolRequestContext,
  withPolicyOutput,
} from '@supabase/mcp-utils';
import { z } from 'zod/v4';

import {
  approvedCostRateSchema,
  type ApprovedCostRate,
  type Cost,
  type CostConfirmationResolution,
} from '../pricing.js';
import { hashObject } from '../util.js';

export const BILLING_HOURS_PER_MONTH = 720;
const BILLING_MONTHS_PER_YEAR = 12;
const POLICY_ID = 'supabase-cost-confirmation';
const POLICY_VERSION = 1;
const INPUT_KEY = 'cost_confirmation';
const KILL_SWITCH_MESSAGE = 'Human Confirmation is temporarily unavailable.';

type CostTool = 'create_project' | 'create_branch';

type CostConfirmationProposal = {
  action: CostTool;
  resourceName: string;
  maximumCreationRate: ApprovedCostRate;
};

type ElicitationResponse = {
  kind?: string;
  action?: string;
  content?: Record<string, unknown>;
};

export type CostConfirmationPolicyOptions<Args> = {
  tool: CostTool;
  getCost(args: Args): Cost | Promise<Cost>;
  runtime?: ElicitationRuntime;
};

function maximumCreationRate(cost: Cost): ApprovedCostRate {
  return approvedCostRateSchema.parse({
    amount: cost.amount,
    recurrence: cost.recurrence,
  });
}

function formatMoney(amount: number): string {
  return amount
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function confirmationMessage(proposal: CostConfirmationProposal): string {
  const { amount, recurrence } = proposal.maximumCreationRate;
  const interval = recurrence === 'hourly' ? 'hour' : 'month';
  const projectionIntervals =
    recurrence === 'hourly' ? BILLING_HOURS_PER_MONTH : BILLING_MONTHS_PER_YEAR;
  const projectedAmount = formatMoney(amount * projectionIntervals);
  const projectionUnit = recurrence === 'hourly' ? 'hours' : 'months';

  return [
    `The live maximum rate for ${proposal.resourceName} is $${amount} per ${interval}.`,
    `It costs roughly $${projectedAmount} if it runs continuously for ${projectionIntervals} ${projectionUnit}.`,
    'This projection assumes continuous operation; delete it sooner and you pay less.',
  ].join(' ');
}

function canonicalArguments<Args>(tool: CostTool, args: Args): unknown {
  const values = args as Record<string, unknown>;
  if (tool === 'create_project') {
    return {
      name: values.name,
      region: values.region,
      organization_id: values.organization_id,
    };
  }
  return { name: values.name, project_id: values.project_id };
}

function resourceName<Args>(tool: CostTool, args: Args): string {
  const name = (args as Record<string, unknown>).name;
  if (typeof name === 'string') {
    return name;
  }
  return tool === 'create_project' ? 'this project' : 'this branch';
}

function humanConfirmationPolicy<Args>(
  options: CostConfirmationPolicyOptions<Args>
): ElicitationPolicy<
  Args,
  CostConfirmationProposal,
  CostConfirmationResolution
> {
  return {
    id: POLICY_ID,
    version: POLICY_VERSION,
    available: (ctx) =>
      ctx.formElicitation || ctx.formSupportReason === 'opt_out',
    canonicalArguments: (args) => canonicalArguments(options.tool, args),
    prepare: async (args) => {
      const rate = maximumCreationRate(await options.getCost(args));
      const resolution = { maximumCreationRate: rate };
      if (rate.amount === 0) {
        return { type: 'execute', resolution };
      }
      return {
        type: 'elicit',
        proposal: {
          action: options.tool,
          resourceName: resourceName(options.tool, args),
          maximumCreationRate: rate,
        },
      };
    },
    inputRequests: (proposal) => ({
      [INPUT_KEY]: inputRequired.elicit({
        message: confirmationMessage(proposal),
        requestedSchema: {
          type: 'object',
          properties: {
            confirm: {
              type: 'boolean',
              description: 'Confirm creation at the displayed maximum rate.',
            },
          },
          required: ['confirm'],
        },
      }),
    }),
    resolve: async (proposal, responses) => {
      const response = (responses as Record<string, ElicitationResponse>)[
        INPUT_KEY
      ];
      if (response?.action === 'cancel') {
        return { type: 'cancelled', message: 'Creation cancelled.' };
      }
      if (
        response?.action === 'decline' ||
        (response?.action === 'accept' && response.content?.confirm === false)
      ) {
        return { type: 'declined', message: 'Creation declined.' };
      }
      if (response?.action === 'accept' && response.content?.confirm === true) {
        return {
          type: 'execute',
          resolution: {
            maximumCreationRate: proposal.maximumCreationRate,
          },
        };
      }
      return { type: 'reissue' };
    },
  };
}

function missingConfirmationMessage(tool: CostTool): string {
  return tool === 'create_project'
    ? 'Cost confirmation ID does not match the expected cost of creating a project.'
    : 'Cost confirmation ID does not match the expected cost of creating a branch.';
}

function legacyResolution<Args>(
  options: CostConfirmationPolicyOptions<Args>,
  args: Args
): Promise<ToolPolicyDecision<CostConfirmationResolution>> {
  return Promise.resolve(options.getCost(args)).then(async (cost) => {
    const confirmationId = (args as Record<string, unknown>).confirm_cost_id;
    if ((await hashObject(cost)) !== confirmationId) {
      throw new Error(missingConfirmationMessage(options.tool));
    }
    return {
      type: 'execute' as const,
      resolution: { maximumCreationRate: maximumCreationRate(cost) },
      telemetry: {
        authorityPath: 'legacy',
        outcome: 'execute',
        policyId: POLICY_ID,
        policyVersion: POLICY_VERSION,
      },
    };
  });
}

function withHumanTelemetry<Resolution>(
  decision: ToolPolicyDecision<Resolution>,
  ctx: ToolRequestContext
): ToolPolicyDecision<Resolution> {
  const content =
    decision.type === 'result' ? decision.result.content : undefined;
  const killSwitch =
    decision.type === 'result' &&
    decision.result.isError === true &&
    Array.isArray(content) &&
    content.some((item: unknown) => {
      if (item === null || typeof item !== 'object') {
        return false;
      }
      const candidate = item as Record<string, unknown>;
      return (
        candidate.type === 'text' && candidate.text === KILL_SWITCH_MESSAGE
      );
    });
  return {
    ...decision,
    telemetry: {
      ...decision.telemetry,
      authorityPath: 'human_confirmation',
      policyId: POLICY_ID,
      policyVersion: POLICY_VERSION,
      formSupportReason: ctx.formSupportReason,
      ...(killSwitch ? { outcome: 'blocked', reason: 'kill_switch' } : {}),
    },
  };
}

function removeLegacyToken(schema: z.ZodObject<any>): z.ZodObject<any> {
  if (!('confirm_cost_id' in schema.shape)) {
    return schema;
  }
  return schema.omit({ confirm_cost_id: true }) as z.ZodObject<any>;
}
function requireLegacyToken(
  schema: z.ZodObject<any>,
  tool: CostTool
): z.ZodObject<any> {
  if (
    !('confirm_cost_id' in schema.shape) ||
    !schema.shape.confirm_cost_id.safeParse(undefined).success
  ) {
    return schema;
  }
  return schema.extend({
    confirm_cost_id: z.string({
      error: (issue) =>
        issue.input === undefined
          ? tool === 'create_project'
            ? 'User must confirm understanding of costs before creating a project.'
            : 'User must confirm understanding of costs before creating a branch.'
          : undefined,
    }),
  }) as z.ZodObject<any>;
}

/**
 * Selects Human Confirmation for form-capable calls and continuation state,
 * while retaining the deterministic confirmation-ID contract for legacy calls.
 */
export function createCostConfirmationPolicy<Args>(
  options: CostConfirmationPolicyOptions<Args>
): ToolPolicy<Args, CostConfirmationResolution> {
  const human =
    options.runtime === undefined
      ? undefined
      : options.runtime.policy(options.tool, humanConfirmationPolicy(options));

  const useHuman = (ctx: ToolRequestContext): boolean =>
    human !== undefined &&
    (ctx.server.mcpReq.requestState() !== undefined || ctx.formElicitation);

  return {
    inputSchema: (schema, ctx) =>
      useHuman(ctx)
        ? removeLegacyToken(schema)
        : requireLegacyToken(schema, options.tool),
    outputSchema: (schema, ctx) =>
      useHuman(ctx) ? withPolicyOutput(schema) : schema,
    normalizeArguments: (raw, ctx) => {
      if (!useHuman(ctx) || raw === null || typeof raw !== 'object') {
        return raw;
      }
      const { confirm_cost_id: _ignored, ...argumentsWithoutLegacyToken } =
        raw as Record<string, unknown>;
      return argumentsWithoutLegacyToken;
    },
    resolve: async (args, ctx) => {
      if (!useHuman(ctx) || human === undefined) {
        return legacyResolution(options, args);
      }
      return withHumanTelemetry(await human.resolve(args, ctx), ctx);
    },
  };
}
