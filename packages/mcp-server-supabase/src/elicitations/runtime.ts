import {
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputResponseView,
} from '@modelcontextprotocol/server';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from '@supabase/mcp-utils';

import {
  resolveElicitationAvailability,
  type ElicitationAvailability,
} from './capability.js';
import type { ElicitationPolicy } from './policy.js';
import {
  createContinuationState,
  CONTINUATION_PAYLOAD_VERSION,
  type ContinuationStateStore,
  type VerifiedContinuation,
} from './state.js';
import {
  recoveryResult,
  terminalResult,
  withTerminalOutput,
} from './terminal.js';

/**
 * Recovery text for the failures a caller can act on. Every one of them
 * creates nothing and leaves the caller a way forward.
 *
 * The wording is infrastructure, not product copy: it names the mechanism
 * that failed and the next step, and never what the tool would have cost.
 */
const RECOVERY_TEXT = {
  state_expired:
    'This request expired before it was answered. Run the tool again to start a new one.',
  payload_version:
    'This request was issued by a different version of this server. Run the tool again.',
  policy_id: 'This request belongs to a different policy. Run the tool again.',
  policy_version:
    'This request was issued under a policy version this server no longer supports. Run the tool again.',
  tool: 'This request belongs to a different tool. Run the tool again.',
  arguments:
    'The tool arguments changed after this request was issued. Run the tool again with the arguments you want.',
  unsupported_continuation:
    'This client can no longer complete the request it started. Run the tool again from a client that supports form elicitation.',
  unsupported_elicitation:
    'This client cannot complete the confirmation this tool requires, so nothing was created. Run the tool again from a client and connection that support form elicitation.',
} as const;

type RecoveryReason = keyof typeof RECOVERY_TEXT;

export type ElicitationRuntimeOptions = {
  /** Authenticated actor the continuation state is bound to. */
  actorId: string;
  /** Operator secret used to sign continuation state, at least 32 bytes. */
  stateKey: string | Uint8Array;
  /** Redeemable lifetime of a continuation, capped at 120 seconds. */
  lifetimeSeconds?: number;
  /** Whether the serving path in front of this server can deliver a form. */
  formDeliveryAvailable?: boolean;
  /** Connection-level form elicitation opt-out. */
  optOut?: boolean;
  /**
   * Kill switch consulted immediately before protected execution. Returning a
   * result blocks this attempt; it neither consumes nor invalidates signed
   * state, so the same continuation is redeemable once the gate reopens.
   *
   * The result must set `isError`. A block is not a success, and on a
   * normalized request a content-only success carries no `structuredContent`
   * for the schema that request advertised, so it would be refused on the
   * way out rather than reaching the caller as the block it is.
   *
   * Tools without an elicitation policy never reach it.
   */
  gate?: (
    ctx: ToolRequestContext
  ) => (CallToolResult & { isError: true }) | null;
  clock?: () => number;
  createJti?: () => string;
};

export type ElicitationRuntime = {
  /**
   * Drop-in for `McpServerOptions.requestState`. The SDK runs it before
   * dispatch, so state that fails integrity, actor, or method binding never
   * reaches a tool.
   */
  readonly requestState: Pick<ContinuationStateStore, 'verify'>;
  /** Form elicitation support for this request, with one stable reason. */
  availability(ctx: ToolRequestContext): ElicitationAvailability;
  /** Wraps a policy as the pre-execution guard for one tool. */
  policy<Args, Proposal, Resolution>(
    tool: string,
    policy: ElicitationPolicy<Args, Proposal, Resolution>
  ): ToolPolicy<Args, Resolution>;
};

export function createElicitationRuntime(
  options: ElicitationRuntimeOptions
): ElicitationRuntime {
  const state = createContinuationState({
    actorId: options.actorId,
    stateKey: options.stateKey,
    lifetimeSeconds: options.lifetimeSeconds,
    clock: options.clock,
    createJti: options.createJti,
  });
  const servingFacts = {
    formDeliveryAvailable: options.formDeliveryAvailable ?? false,
    optOut: options.optOut,
  };

  function recover(
    reason: RecoveryReason,
    // The outcome is this helper's own: every recovery is a rejection, so a
    // caller supplies only the identity the record is filed under.
    telemetry: Omit<ToolPolicyTelemetry, 'outcome'>
  ): ToolPolicyDecision<never> {
    return {
      type: 'result',
      result: recoveryResult(RECOVERY_TEXT[reason]),
      telemetry: { ...telemetry, outcome: 'rejected', reason },
    };
  }

  return {
    requestState: { verify: state.verify },

    availability(ctx) {
      return resolveElicitationAvailability(ctx, servingFacts);
    },

    policy<Args, Proposal, Resolution>(
      tool: string,
      policy: ElicitationPolicy<Args, Proposal, Resolution>
    ): ToolPolicy<Args, Resolution> {
      const identity = { policyId: policy.id, policyVersion: policy.version };

      async function elicit(
        proposal: Proposal,
        argsDigest: string,
        ctx: ToolRequestContext,
        reason?: string
      ): Promise<ToolPolicyDecision<Resolution>> {
        const { requestState, interactionId } = await state.mint(
          {
            policy: policy.id,
            policyVersion: policy.version,
            tool,
            argsDigest,
            proposal,
          },
          ctx.server
        );

        return {
          type: 'result',
          result: inputRequired({
            // The private contract keeps the SDK's wire vocabulary out of a
            // policy author's way; it is applied once, here.
            inputRequests: policy.inputRequests(proposal) as Parameters<
              typeof inputRequired
            >[0]['inputRequests'],
            requestState,
          }),
          telemetry: {
            ...identity,
            interactionId,
            authorityPath: 'form_elicitation',
            outcome: 'input_required',
            ...(reason === undefined ? {} : { reason }),
          },
        };
      }

      async function continuation(
        verified: VerifiedContinuation,
        argsDigest: string,
        ctx: ToolRequestContext
      ): Promise<ToolPolicyDecision<Resolution>> {
        const { interactionId } = verified;
        const telemetry = { ...identity, interactionId };

        if (verified.kind === 'expired') {
          return {
            type: 'result',
            result: recoveryResult(RECOVERY_TEXT.state_expired),
            telemetry: {
              ...telemetry,
              outcome: 'expired',
              reason: 'state_expired',
            },
          };
        }

        const signed = verified.state;

        if (signed.v !== CONTINUATION_PAYLOAD_VERSION) {
          return recover('payload_version', telemetry);
        }
        if (signed.policy !== policy.id) {
          return recover('policy_id', telemetry);
        }
        if (signed.policyVersion !== policy.version) {
          return recover('policy_version', telemetry);
        }
        if (signed.tool !== tool) {
          return recover('tool', telemetry);
        }
        if (signed.argsDigest !== argsDigest) {
          return recover('arguments', telemetry);
        }
        // Capability is consulted only after the state proved it belongs
        // here, so a client that lost form support gets an actionable answer
        // instead of a different authority path.
        if (!policy.available(ctx)) {
          return recover('unsupported_continuation', telemetry);
        }

        const blocked = options.gate?.(ctx);
        if (blocked != null) {
          return {
            type: 'result',
            result: blocked,
            telemetry: { ...telemetry, outcome: 'blocked', reason: 'gate' },
          };
        }

        const proposal = signed.proposal as Proposal;
        const requests = policy.inputRequests(proposal);
        const responses: Record<string, InputResponseView> = Object.fromEntries(
          Object.keys(requests).map((key) => [
            key,
            inputResponse(ctx.server.mcpReq.inputResponses, key),
          ])
        );
        const resolution = await policy.resolve(proposal, responses);

        switch (resolution.type) {
          case 'execute':
            return {
              type: 'execute',
              resolution: resolution.resolution,
              telemetry: {
                ...telemetry,
                authorityPath: 'form_elicitation',
                outcome: 'executed',
              },
            };
          case 'declined':
          case 'cancelled':
            return {
              type: 'result',
              result: terminalResult(resolution.type, resolution.message),
              telemetry: { ...telemetry, outcome: resolution.type },
            };
          case 'reissue':
            // The proposal is the one already signed, so preparation does not
            // run again and the caller cannot be shown a changed proposal.
            return elicit(proposal, argsDigest, ctx, 'reissued');
        }
      }

      return {
        // Structured results follow capability. A request that cannot carry
        // the elicitation can never reach a terminal variant either, so it
        // keeps the tool's pre-normalization output byte for byte instead of
        // advertising terminal variants it will never produce.
        outputSchema: (schema, ctx) =>
          policy.available(ctx) ? withTerminalOutput(schema) : undefined,

        resolve: async (args, ctx) => {
          // Signed state resolves first. Current capability cannot promote a
          // request that carries none, and cannot demote one that does.
          const verified =
            ctx.server.mcpReq.requestState<VerifiedContinuation>();
          const argsDigest = await state.argumentsDigest(
            policy.canonicalArguments(args)
          );

          if (verified !== undefined) {
            return continuation(verified, argsDigest, ctx);
          }

          // Nothing protected has run yet: preparation itself is part of the
          // guarded path, so the gate closes in front of it.
          const blocked = options.gate?.(ctx);
          if (blocked != null) {
            return {
              type: 'result',
              result: blocked,
              telemetry: { ...identity, outcome: 'blocked', reason: 'gate' },
            };
          }

          const preparation = await policy.prepare(args);

          if (preparation.type === 'execute') {
            return {
              type: 'execute',
              resolution: preparation.resolution,
              telemetry: {
                ...identity,
                authorityPath: 'not_required',
                outcome: 'executed',
              },
            };
          }

          // Availability is consulted here and not before preparation: a
          // preparation that needs no confirmation must still execute on an
          // incapable request. Only the branch that would emit a form is
          // refused, and it is refused before anything is emitted or run.
          if (!policy.available(ctx)) {
            return recover('unsupported_elicitation', identity);
          }

          return elicit(preparation.proposal, argsDigest, ctx);
        },
      };
    },
  };
}
