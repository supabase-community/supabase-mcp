import {
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type RequestStateCodec,
  type ServerContext,
  type ServerOptions,
} from '@modelcontextprotocol/server';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from '@supabase/mcp-utils';
import { z } from 'zod/v4';

import { createElicitationToolPolicy } from './elicitation-tool-policy.js';
import { canonicalObjectDigest } from './object-digest.js';

export const APPROVED_RATE_STALE = 'approved_rate_stale';
const COST_CONFIRMATION_POLICY_ID = 'supabase.cost_confirmation';
const POLICY_VERSION = 2;
const REQUEST_STATE_VERSION = 1;
const REQUEST_STATE_TTL_SECONDS = 120;
const CONSENT_REQUEST = 'cost_confirmation';
export const LEGACY_CONFIRMATION_FIELD = 'confirm_cost_id';

const MIGRATION_GUIDANCE =
  'This client confirms costs inside the tool that creates the resource. Call create_project or create_branch directly and answer the confirmation it requests; a separate confirmation ID is not needed.';
const creationRateSchema = z
  .object({
    amount: z.number().finite().nonnegative(),
    currency: z.string().min(1),
    recurrence: z.enum(['hourly', 'monthly']),
  })
  .strict();

export type CreationRate = {
  amount: number;
  currency: string;
  recurrence: 'hourly' | 'monthly';
};

export type CostConfirmationResolution = {
  maximumCreationRate: CreationRate;
};

type CostConfirmationTool = 'create_project' | 'create_branch';

type CostConfirmationSubject = {
  resourceName: string;
  account:
    | { type: 'organization'; id: string }
    | { type: 'parent_project'; id: string };
};

const costConfirmationStateSchema = z
  .object({
    v: z.literal(REQUEST_STATE_VERSION),
    policy: z.literal(COST_CONFIRMATION_POLICY_ID),
    policyVersion: z.literal(POLICY_VERSION),
    tool: z.enum(['create_project', 'create_branch']),
    argsDigest: z.string().min(1),
    approvedRate: creationRateSchema,
    interactionId: z.string().uuid(),
  })
  .strict();

type CostConfirmationState = z.infer<typeof costConfirmationStateSchema>;

type CostConfirmationPolicyOptions<Args> = {
  tool: CostConfirmationTool;
  canonicalArguments(args: Args): Record<string, unknown>;
  subject(args: Args): CostConfirmationSubject;
  readRate(args: Args): Promise<CreationRate>;
};

export type CostConfirmationOptions = {
  key: string | Uint8Array;
  bind(ctx: ServerContext): string;
  formDeliveryAvailable?: boolean;
  optOut?: boolean;
  enabled?: (ctx: ToolRequestContext) => boolean;
};

export type CostConfirmation = {
  requestState: NonNullable<ServerOptions['requestState']>;
  capable(ctx: ToolRequestContext): boolean;
  policy<Args>(
    options: CostConfirmationPolicyOptions<Args>
  ): ToolPolicy<Args, CostConfirmationResolution | undefined>;
  legacyConfirmationPolicy: ToolPolicy<unknown, undefined>;
};

function rateStatement(rate: CreationRate): string {
  const interval = rate.recurrence === 'hourly' ? 'per hour' : 'per month';
  return `${rate.amount} ${rate.currency} ${interval}`;
}

function confirmationMessage(
  tool: CostConfirmationTool,
  subject: CostConfirmationSubject,
  rate: CreationRate
): string {
  const resource = tool === 'create_project' ? 'project' : 'branch';
  const where =
    subject.account.type === 'organization'
      ? `in organization ${subject.account.id}`
      : `on project ${subject.account.id}`;

  return [
    `Creating the ${resource} "${subject.resourceName}" ${where}`,
    `adds ${rateStatement(rate)}, and that charge recurs until the ${resource} is deleted.`,
    'Accept to create it now, or decline to leave it uncreated.',
  ].join(' ');
}

function terminalMessage(
  tool: CostConfirmationTool,
  outcome: 'declined' | 'cancelled'
): string {
  const resource = tool === 'create_project' ? 'project' : 'branch';
  const reported =
    outcome === 'declined'
      ? 'The client reported that the cost was declined'
      : 'The client dismissed the request without answering it';
  return `${reported}, so no ${resource} was created.`;
}

function terminalResult(
  status: 'declined' | 'cancelled',
  message: string
): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { status },
  };
}

function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function withTerminalOutput(schema: z.ZodObject<any>) {
  const terminal = z.enum(['declined', 'cancelled']);
  const businessStatus = (schema.shape as Record<string, z.ZodType>).status;
  const root = schema
    .partial()
    .extend({
      status:
        businessStatus === undefined
          ? terminal.optional()
          : z.union([businessStatus, terminal]).optional(),
    })
    .loose();

  return root.superRefine((value, ctx) => {
    const business = schema.safeParse(value);
    if (business.success) {
      return;
    }
    const record = value as Record<string, unknown>;
    if (terminal.safeParse(record.status).success) {
      for (const key of Object.keys(record)) {
        if (key !== 'status') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: 'Unexpected field on a terminal result.',
          });
        }
      }
      return;
    }
    for (const issue of business.error.issues) {
      ctx.addIssue({ ...issue });
    }
  });
}

function formCapable(ctx: ToolRequestContext): boolean {
  if (ctx.era !== 'modern') {
    return false;
  }
  const elicitation = ctx.clientCapabilities?.elicitation;
  if (elicitation === undefined) {
    return false;
  }
  return (
    elicitation.form !== undefined ||
    (elicitation.form === undefined && elicitation.url === undefined)
  );
}

function telemetry(
  outcome: string,
  interactionId?: string,
  reason?: string
): ToolPolicyTelemetry {
  return {
    policyId: COST_CONFIRMATION_POLICY_ID,
    policyVersion: POLICY_VERSION,
    outcome,
    interactionId,
    authorityPath: 'sdk_input_required',
    reason,
  };
}

function parseState(
  state: unknown,
  tool: CostConfirmationTool
): CostConfirmationState | undefined {
  const parsed = costConfirmationStateSchema.safeParse(state);
  return parsed.success && parsed.data.tool === tool ? parsed.data : undefined;
}

async function argumentsDigest(value: Record<string, unknown>) {
  return canonicalObjectDigest(value);
}

function createPolicy<Args>(
  codec: RequestStateCodec<unknown>,
  capable: (ctx: ToolRequestContext) => boolean,
  enabled: (ctx: ToolRequestContext) => boolean,
  options: CostConfirmationPolicyOptions<Args>
): ToolPolicy<Args, CostConfirmationResolution | undefined> {
  const owns = (ctx: ToolRequestContext) =>
    ctx.server.mcpReq.requestState<CostConfirmationState>() !== undefined ||
    capable(ctx);
  async function staleRateDecision(
    args: Args,
    approvedRate: CreationRate,
    interactionId: string
  ): Promise<ToolPolicyDecision<
    CostConfirmationResolution | undefined
  > | null> {
    const finalRate = creationRateSchema.safeParse(
      await options.readRate(args)
    );
    if (!finalRate.success) {
      return {
        type: 'result',
        result: errorResult(
          'The authoritative cost response was invalid, so nothing was created. Run the tool again.'
        ),
        telemetry: telemetry(
          'rejected',
          interactionId,
          'invalid_authoritative_rate'
        ),
      };
    }
    try {
      assertRateStillApproved(finalRate.data, approvedRate);
      return null;
    } catch (error) {
      return {
        type: 'result',
        result: errorResult(
          error instanceof Error
            ? error.message
            : `The authoritative cost changed (${APPROVED_RATE_STALE}), so nothing was created. Run the tool again.`
        ),
        telemetry: telemetry('rejected', interactionId, APPROVED_RATE_STALE),
      };
    }
  }

  return createElicitationToolPolicy<
    Args,
    unknown,
    CostConfirmationResolution | undefined
  >({
    inputSchema(schema, ctx) {
      return owns(ctx)
        ? schema.omit({ [LEGACY_CONFIRMATION_FIELD]: true })
        : schema;
    },

    outputSchema(schema, ctx) {
      return owns(ctx) ? withTerminalOutput(schema) : undefined;
    },

    normalizeArguments(raw, ctx) {
      if (!owns(ctx) || raw === null || typeof raw !== 'object') {
        return raw;
      }
      const { [LEGACY_CONFIRMATION_FIELD]: _ignored, ...business } =
        raw as Record<string, unknown>;
      return business;
    },

    async resolve(args, ctx, round) {
      if (!owns(ctx)) {
        return {
          type: 'execute',
          resolution: undefined,
          telemetry: {
            ...telemetry('executed'),
            authorityPath: 'legacy_confirmation',
          },
        };
      }

      if (round.requestState === undefined) {
        const parsedRate = creationRateSchema.safeParse(
          await options.readRate(args)
        );
        if (!parsedRate.success) {
          return {
            type: 'result',
            result: errorResult(
              'The authoritative cost response was invalid, so nothing was created. Run the tool again.'
            ),
            telemetry: telemetry(
              'rejected',
              undefined,
              'invalid_authoritative_rate'
            ),
          };
        }
        const rate = parsedRate.data;
        const interactionId = crypto.randomUUID();
        if (rate.amount === 0) {
          const stale = await staleRateDecision(args, rate, interactionId);
          if (stale !== null) {
            return stale;
          }
          return {
            type: 'execute',
            resolution: { maximumCreationRate: rate },
            telemetry: telemetry('executed', interactionId, 'zero_rate'),
          };
        }

        const state: CostConfirmationState = {
          v: REQUEST_STATE_VERSION,
          policy: COST_CONFIRMATION_POLICY_ID,
          policyVersion: POLICY_VERSION,
          tool: options.tool,
          argsDigest: await argumentsDigest(options.canonicalArguments(args)),
          approvedRate: rate,
          interactionId,
        };
        return {
          type: 'inputRequired',
          inputRequests: {
            [CONSENT_REQUEST]: inputRequired.elicit({
              message: confirmationMessage(
                options.tool,
                options.subject(args),
                rate
              ),
              requestedSchema: { type: 'object', properties: {} },
            }),
          },
          requestState: await codec.mint(state, ctx.server),
          telemetry: telemetry('input_required', interactionId),
        };
      }

      const state = parseState(round.requestState, options.tool);
      if (state === undefined) {
        return {
          type: 'result',
          result: errorResult(
            'This cost confirmation was issued by an incompatible policy version, so nothing was created. Run the tool again.'
          ),
          telemetry: telemetry('rejected', undefined, 'invalid_state_payload'),
        };
      }

      if (
        state.argsDigest !==
        (await argumentsDigest(options.canonicalArguments(args)))
      ) {
        return {
          type: 'result',
          result: errorResult(
            'The tool arguments changed after cost confirmation started, so nothing was created. Run the tool again.'
          ),
          telemetry: telemetry(
            'rejected',
            state.interactionId,
            'arguments_changed'
          ),
        };
      }

      if (!enabled(ctx)) {
        return {
          type: 'result',
          result: errorResult(
            'Cost confirmation is currently unavailable, so nothing was created. Run the tool again later.'
          ),
          telemetry: telemetry('rejected', state.interactionId, 'kill_switch'),
        };
      }

      const answer = inputResponse(round.inputResponses, CONSENT_REQUEST);
      if (answer.kind !== 'elicit') {
        return {
          type: 'result',
          result: errorResult(
            'The client returned no answer to the cost confirmation, so nothing was created. Run the tool again.'
          ),
          telemetry: telemetry(
            'rejected',
            state.interactionId,
            'missing_response'
          ),
        };
      }

      switch (answer.action) {
        case 'accept': {
          const stale = await staleRateDecision(
            args,
            state.approvedRate,
            state.interactionId
          );
          if (stale !== null) {
            return stale;
          }
          return {
            type: 'execute',
            resolution: { maximumCreationRate: state.approvedRate },
            telemetry: telemetry('accepted', state.interactionId),
          };
        }
        case 'decline':
          return {
            type: 'result',
            result: terminalResult(
              'declined',
              terminalMessage(options.tool, 'declined')
            ),
            telemetry: telemetry('declined', state.interactionId),
          };
        case 'cancel':
          return {
            type: 'result',
            result: terminalResult(
              'cancelled',
              terminalMessage(options.tool, 'cancelled')
            ),
            telemetry: telemetry('cancelled', state.interactionId),
          };
      }
    },
  });
}

export function createCostConfirmation(
  options: CostConfirmationOptions
): CostConfirmation {
  const codec = createRequestStateCodec<unknown>({
    key: options.key,
    ttlSeconds: REQUEST_STATE_TTL_SECONDS,
    bind: options.bind,
  });
  const enabled = options.enabled ?? (() => true);
  const capable = (ctx: ToolRequestContext) =>
    options.formDeliveryAvailable === true &&
    options.optOut !== true &&
    enabled(ctx) &&
    formCapable(ctx);

  return {
    requestState: { verify: codec.verify },
    capable,
    policy: (policyOptions) =>
      createPolicy(codec, capable, enabled, policyOptions),
    legacyConfirmationPolicy: {
      outputSchema: (schema, ctx) => (capable(ctx) ? schema : undefined),
      async resolve(_args, ctx): Promise<ToolPolicyDecision<undefined>> {
        if (capable(ctx)) {
          return {
            type: 'result',
            result: errorResult(MIGRATION_GUIDANCE),
            telemetry: {
              ...telemetry(
                'rejected',
                undefined,
                'legacy_confirmation_retired'
              ),
              authorityPath: 'legacy_confirmation',
            },
          };
        }
        return {
          type: 'execute',
          resolution: undefined,
          telemetry: {
            ...telemetry('executed'),
            authorityPath: 'legacy_confirmation',
          },
        };
      },
    },
  };
}

export function assertRateStillApproved(
  rate: CreationRate,
  approved: CreationRate
): void {
  if (
    rate.currency === approved.currency &&
    rate.recurrence === approved.recurrence &&
    rate.amount <= approved.amount
  ) {
    return;
  }
  throw new Error(
    `The authoritative cost changed after it was approved (${APPROVED_RATE_STALE}), so nothing was created. Run the tool again to review the current cost.`
  );
}

export function creationOutcomeMessage(
  tool: CostConfirmationTool,
  resourceName: string,
  approved: CreationRate
): string {
  const resource = tool === 'create_project' ? 'project' : 'branch';
  if (approved.amount === 0) {
    return `The authoritative rate for this ${resource} is ${rateStatement(approved)}, so no confirmation was requested. The ${resource} "${resourceName}" was created.`;
  }
  return `The client reported that ${rateStatement(approved)} was accepted. The ${resource} "${resourceName}" was created.`;
}

export function createCreationOutcomeText<Result extends object>(
  tool: CostConfirmationTool,
  identity: (result: Result) => string
) {
  const approved = new Map<string, CreationRate>();
  return {
    record(result: Result, resolution: CostConfirmationResolution | undefined) {
      if (resolution !== undefined) {
        approved.set(identity(result), resolution.maximumCreationRate);
      }
    },
    render(result: Result, resourceName: string) {
      const key = identity(result);
      const rate = approved.get(key);
      approved.delete(key);
      return rate === undefined
        ? JSON.stringify(result)
        : creationOutcomeMessage(tool, resourceName, rate);
    },
  };
}
