import { inputRequired } from '@modelcontextprotocol/server';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolRequestContext,
} from '@supabase/mcp-utils';

import type {
  ElicitationPolicy,
  ElicitationPreparation,
} from '../elicitations/policy.js';
import type { VerifiedContinuation } from '../elicitations/state.js';
import { recoveryResult } from '../elicitations/terminal.js';
import type { CreationRate } from '../platform/types.js';
import { isRateWithinApproved } from '../pricing.js';

/**
 * Stable identifier for a creation refused because the authoritative rate
 * moved past what was approved. It travels inside the caller-facing text so
 * one string serves both a reader and a log search.
 */
export const APPROVED_RATE_STALE = 'approved_rate_stale';

/**
 * Refuses a creation the approved ceiling no longer covers.
 *
 * Both paid tools call this immediately before their creation call, with a
 * rate read at that moment. Nothing runs between the read and the side effect,
 * so an approval cannot be spent at a price the caller never saw.
 */
export function assertRateStillApproved(
  rate: CreationRate,
  approved: ApprovedCreationRate
): void {
  if (isRateWithinApproved(rate, approved)) {
    return;
  }

  throw new Error(
    `The authoritative cost changed after it was approved (${APPROVED_RATE_STALE}), so nothing was created. Run the tool again to review the current cost.`
  );
}

/**
 * Version of the cost confirmation contract.
 *
 * Version 1 read consent from a Boolean field in the response body. Version 2
 * reads it from the wire action alone, so the two cannot interpret each
 * other's state: the runtime rejects a version it does not own before it looks
 * at any response, which is what makes a rolling deployment safe in both
 * directions.
 */
export const POLICY_VERSION = 2;

/** Stable policy identity bound into continuation state. */
export const COST_CONFIRMATION_POLICY_ID = 'supabase.cost_confirmation';

/**
 * The single embedded request key. One request means one answer, so there is
 * never a question about which response carried the consent.
 */
const CONSENT_REQUEST = 'cost_confirmation';

/** The rate ceiling a caller approved, and the currency and interval it holds for. */
export type ApprovedCreationRate = CreationRate;

/**
 * All a guarded tool learns from the policy: the maximum rate it may create at.
 *
 * No protocol fact, client label, or response content reaches business
 * execution through this type.
 */
export type CostConfirmationResolution = {
  maximumCreationRate: ApprovedCreationRate;
};

/** What is being created, in the caller's own terms. */
export type CostConfirmationSubject = {
  action: 'create_project' | 'create_branch';
  /** Name the resource will be created under. */
  resourceName: string;
  /** Where the charge lands. */
  account:
    | { type: 'organization'; id: string }
    | { type: 'parent_project'; id: string };
};

/**
 * The facts a caller consents to, signed into continuation state so the answer
 * resolves against the proposal that was shown rather than a fresh one.
 */
export type CostConfirmationProposal = CostConfirmationSubject & {
  rate: CreationRate;
};

/**
 * States the authoritative rate exactly as the Management API reports it:
 * amount, currency, and the interval it recurs at.
 *
 * This is a rate, not a projection over time. Extrapolating it into a total
 * needs an hours-per-month convention that Billing has not approved, and this
 * package must not invent one.
 */
export function rateStatement(rate: CreationRate): string {
  const interval = rate.recurrence === 'hourly' ? 'per hour' : 'per month';
  return `${rate.amount} ${rate.currency} ${interval}`;
}

/**
 * The Billing-approved projection, which does not exist yet (root gate M2).
 *
 * The slot is deliberately empty rather than filled with something plausible:
 * a projected total Billing has not approved would be this package asserting a
 * price of its own. When the convention is approved, this function returns the
 * approved sentence, the message picks it up with no other change, and the one
 * owning copy test swaps with it.
 */
function projectionStatement(_rate: CreationRate): string | undefined {
  return undefined;
}

/**
 * Draft confirmation copy, pending Design and PM approval.
 *
 * The facts are load bearing and are pinned by one test: the action, the
 * resource, where the charge lands, the Management API rate with its
 * recurrence, that the charge recurs until the resource is deleted, and what
 * accepting and declining do. The wording around them is a placeholder. It
 * never depends on how a client labels its buttons, because a caller reading
 * only this message still knows what accepting means.
 */
export function costConfirmationMessage(
  proposal: CostConfirmationProposal
): string {
  const resource = proposal.action === 'create_project' ? 'project' : 'branch';
  const where =
    proposal.account.type === 'organization'
      ? `in organization ${proposal.account.id}`
      : `on project ${proposal.account.id}`;
  const projection = projectionStatement(proposal.rate);

  return [
    `Creating the ${resource} "${proposal.resourceName}" ${where}`,
    `adds ${rateStatement(proposal.rate)}, and that charge recurs until the ${resource} is deleted.`,
    ...(projection === undefined ? [] : [projection]),
    'Accept to create it now, or decline to leave it uncreated.',
  ].join(' ');
}

/**
 * Draft terminal copy, pending the same approval.
 *
 * It reports what the client said and what the server did, and claims nothing
 * about a person: a client can answer without ever showing a human the prompt.
 */
function terminalMessage(
  proposal: CostConfirmationProposal,
  outcome: 'declined' | 'cancelled'
): string {
  const resource = proposal.action === 'create_project' ? 'project' : 'branch';
  const reported =
    outcome === 'declined'
      ? 'The client reported that the cost was declined'
      : 'The client dismissed the request without answering it';

  return `${reported}, so no ${resource} was created.`;
}

/**
 * Explicit text for a creation that went ahead, stating what the client
 * reported and what the server did.
 *
 * The two lanes get different sentences because only one of them asked
 * anything: a zero authoritative rate is created without a prompt, so claiming
 * an acceptance there would be a claim about an exchange that never happened.
 * Neither sentence claims a person saw the prompt, because a client can answer
 * on its own.
 *
 * Draft copy, pending the same Design and PM approval as the rest.
 */
export function creationOutcomeMessage(
  action: CostConfirmationSubject['action'],
  resourceName: string,
  approved: ApprovedCreationRate
): string {
  const resource = action === 'create_project' ? 'project' : 'branch';

  if (approved.amount === 0) {
    return `The authoritative rate for this ${resource} is ${rateStatement(approved)}, so no confirmation was requested. The ${resource} "${resourceName}" was created.`;
  }

  return `The client reported that ${rateStatement(approved)} was accepted. The ${resource} "${resourceName}" was created.`;
}

export type CostConfirmationPolicyOptions<Args> = {
  action: CostConfirmationSubject['action'];
  /** Whether this request can carry the confirmation at all. */
  available(ctx: ToolRequestContext): boolean;
  /** Business arguments the approval binds to, without the legacy token. */
  canonicalArguments(args: Args): unknown;
  /** What the caller is being asked about. */
  subject(args: Args): Omit<CostConfirmationSubject, 'action'>;
  /** The authoritative rate for this creation, read from the Management API. */
  readRate(args: Args): Promise<CreationRate>;
};

/**
 * The Supabase cost policy: one authoritative rate, one action-only question,
 * one approved ceiling handed to the tool.
 *
 * State integrity, lifetime, correlation and terminal composition belong to
 * the runtime this policy is handed to. What lives here is the product half:
 * which rate applies, whether anything needs asking, and what an answer means.
 */
export function createCostConfirmationPolicy<Args>(
  options: CostConfirmationPolicyOptions<Args>
): ElicitationPolicy<
  Args,
  CostConfirmationProposal,
  CostConfirmationResolution
> {
  return {
    id: COST_CONFIRMATION_POLICY_ID,
    version: POLICY_VERSION,
    available: options.available,
    canonicalArguments: options.canonicalArguments,

    async prepare(
      args
    ): Promise<
      ElicitationPreparation<
        CostConfirmationProposal,
        CostConfirmationResolution
      >
    > {
      const rate = await options.readRate(args);

      // Zero is an authoritative answer, not a missing one: there is nothing
      // to consent to. The rate still travels into execution as the approved
      // ceiling, so the check immediately before creation still catches a rate
      // that moved.
      if (rate.amount === 0) {
        return { type: 'execute', resolution: { maximumCreationRate: rate } };
      }

      return {
        type: 'elicit',
        proposal: { action: options.action, ...options.subject(args), rate },
      };
    },

    inputRequests(proposal) {
      return {
        [CONSENT_REQUEST]: inputRequired.elicit({
          message: costConfirmationMessage(proposal),
          // Property-less by contract: with no properties there is no field a
          // client could fill in, so consent can only come from the action.
          requestedSchema: { type: 'object', properties: {} },
        }),
      };
    },

    async resolve(proposal, inputResponses) {
      const answer = inputResponses[CONSENT_REQUEST];

      // No answer to the question that was asked. Asking again is the only
      // safe reading: a missing response is not consent, and it is not a
      // refusal either.
      if (answer === undefined || answer.kind !== 'elicit') {
        return { type: 'reissue' };
      }

      switch (answer.action) {
        case 'accept':
          // The wire action is the whole answer. Response content is never
          // read, so no Boolean, string, or absent field can grant, weaken, or
          // withdraw this consent.
          return {
            type: 'execute',
            resolution: { maximumCreationRate: proposal.rate },
          };
        case 'decline':
          return {
            type: 'declined',
            message: terminalMessage(proposal, 'declined'),
          };
        case 'cancel':
          return {
            type: 'cancelled',
            message: terminalMessage(proposal, 'cancelled'),
          };
        default:
          return { type: 'reissue' };
      }
    },
  };
}

/**
 * Guidance for a capable client that called the retired confirmation tool by
 * name. Draft copy, pending the same approval as the rest.
 */
const MIGRATION_GUIDANCE =
  'This client confirms costs inside the tool that creates the resource. Call create_project or create_branch directly and answer the confirmation it requests; a separate confirmation ID is not needed.';

/** The legacy confirmation token, split out of the business arguments. */
export const LEGACY_CONFIRMATION_FIELD = 'confirm_cost_id';

const LEGACY_TELEMETRY = {
  policyId: COST_CONFIRMATION_POLICY_ID,
  policyVersion: POLICY_VERSION,
  authorityPath: 'legacy_confirmation',
} as const;

/**
 * Chooses the authority path for one paid creation call, before the
 * elicitation runtime is consulted.
 *
 * A request that cannot carry a form takes the legacy lane it has always
 * taken: the same required token, the same schema, the same check inside the
 * tool. Only a request that can carry a form reaches the runtime. The
 * runtime's own refusal for an incapable client stays as a backstop for a
 * consumer that attaches this policy where forms cannot be delivered; it is
 * never how a legacy caller is routed.
 */
export function routeCostConfirmation<Args>(options: {
  capable(ctx: ToolRequestContext): boolean;
  confirmed: ToolPolicy<Args, CostConfirmationResolution>;
}): ToolPolicy<Args, CostConfirmationResolution | undefined> {
  const { capable, confirmed } = options;

  /**
   * Whether the runtime owns this request.
   *
   * A request carrying verified continuation state belongs to a flow that
   * already started, so it stays on the confirmed lane even if this leg is no
   * longer capable. Handing it to the legacy lane instead would demand a token
   * the caller was never given and answer capability loss with a hash
   * mismatch, where the runtime answers it with recovery text. State that
   * fails integrity, actor, or method binding never reaches here at all.
   */
  const runtimeOwns = (ctx: ToolRequestContext) =>
    ctx.server.mcpReq.requestState<VerifiedContinuation>() !== undefined ||
    capable(ctx);

  return {
    inputSchema(schema, ctx) {
      const contextual = confirmed.inputSchema?.(schema, ctx) ?? schema;

      // The legacy token is not part of the modern contract, so a capable
      // client is never shown a field it must not use.
      return runtimeOwns(ctx)
        ? contextual.omit({ [LEGACY_CONFIRMATION_FIELD]: true })
        : contextual;
    },

    outputSchema(schema, ctx) {
      // Composed, never re-decided, and never defaulted: the runtime widens
      // the schema for a request that can reach a terminal outcome and
      // returns undefined for one that cannot. Passing that undefined through
      // is what holds a legacy request on its pre-normalization bytes.
      return confirmed.outputSchema?.(schema, ctx);
    },

    normalizeArguments(raw, ctx) {
      const normalized = confirmed.normalizeArguments?.(raw, ctx) ?? raw;

      if (
        !runtimeOwns(ctx) ||
        normalized === null ||
        typeof normalized !== 'object'
      ) {
        return normalized;
      }

      // Dropped before canonicalization, so a token supplied anyway is not
      // part of what an approval binds to and cannot stand in for one.
      const { [LEGACY_CONFIRMATION_FIELD]: _ignored, ...business } =
        normalized as Record<string, unknown>;

      return business;
    },

    async resolve(
      args,
      ctx
    ): Promise<ToolPolicyDecision<CostConfirmationResolution | undefined>> {
      if (runtimeOwns(ctx)) {
        return confirmed.resolve(args, ctx);
      }

      // No resolution: the tool falls back to the legacy token check it has
      // always run, and nothing about this request reaches the runtime.
      return {
        type: 'execute',
        resolution: undefined,
        telemetry: { ...LEGACY_TELEMETRY, outcome: 'executed' },
      };
    },
  };
}

/**
 * Answers a direct call to the retired confirmation tool.
 *
 * The handler stays registered for every caller that still needs it. A capable
 * client that calls it by name gets guidance instead of a confirmation ID,
 * because a token it obtained here would be ignored by the creation call
 * anyway.
 */
export function routeLegacyConfirmation(options: {
  capable(ctx: ToolRequestContext): boolean;
}): ToolPolicy<unknown, undefined> {
  return {
    outputSchema(schema, ctx) {
      // An incapable caller keeps this tool exactly as it always was, which
      // means no structured results at all. A capable caller never sees it in
      // discovery, and its direct call is answered with guidance rather than
      // an execution, so normalizing that request changes nothing it can
      // observe.
      return options.capable(ctx) ? schema : undefined;
    },

    async resolve(_args, ctx): Promise<ToolPolicyDecision<undefined>> {
      if (options.capable(ctx)) {
        return {
          type: 'result',
          result: recoveryResult(MIGRATION_GUIDANCE),
          telemetry: {
            ...LEGACY_TELEMETRY,
            outcome: 'rejected',
            reason: 'legacy_confirmation_retired',
          },
        };
      }

      return {
        type: 'execute',
        resolution: undefined,
        telemetry: { ...LEGACY_TELEMETRY, outcome: 'executed' },
      };
    },
  };
}
