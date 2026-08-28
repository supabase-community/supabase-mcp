import { inputRequired } from '@modelcontextprotocol/server';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from '@supabase/mcp-utils';

/** Input requests accepted by the SDK's multi-round-trip result builder. */
type InputRequests = NonNullable<
  Parameters<typeof inputRequired>[0]['inputRequests']
>;

/** Transport values available when the SDK re-enters the policy. */
type ElicitationRound<RequestState> = {
  /** Policy state after the server's request-state verifier accepts it. */
  requestState: RequestState | undefined;
  /** Client responses to the policy's prior input requests. */
  inputResponses: ToolRequestContext['server']['mcpReq']['inputResponses'];
};

/** A policy-authored request for another SDK multi-round trip. */
type ElicitationRequired = {
  type: 'inputRequired';
  inputRequests: InputRequests;
  requestState: string;
  telemetry: ToolPolicyTelemetry;
};

/**
 * Private author contract for policies that use SDK multi-round trips.
 *
 * The policy owns every product decision and all request-state persistence.
 * This adapter only translates its input request into the SDK result shape and
 * returns the SDK's verified state and input responses on the next round.
 */
type ElicitationToolPolicy<Params, RequestState, Resolution> = Omit<
  ToolPolicy<Params, Resolution>,
  'resolve'
> & {
  resolve(
    params: Params,
    ctx: ToolRequestContext,
    round: ElicitationRound<RequestState>
  ): Promise<ToolPolicyDecision<Resolution> | ElicitationRequired>;
};

/** Mounts a private elicitation author contract on mcp-utils' ToolPolicy seam. */
export function createElicitationToolPolicy<Params, RequestState, Resolution>(
  policy: ElicitationToolPolicy<Params, RequestState, Resolution>
): ToolPolicy<Params, Resolution> {
  return {
    ...policy,
    async resolve(params, ctx) {
      const decision = await policy.resolve(params, ctx, {
        requestState: ctx.server.mcpReq.requestState<RequestState>(),
        inputResponses: ctx.server.mcpReq.inputResponses,
      });

      if (decision.type !== 'inputRequired') {
        return decision;
      }

      return {
        type: 'result',
        result: inputRequired({
          inputRequests: decision.inputRequests,
          requestState: decision.requestState,
        }),
        telemetry: decision.telemetry,
      };
    },
  };
}
