import type {
  CallToolResult,
  ClientCapabilities,
  Implementation,
  InputRequiredResult,
  ServerContext,
} from '@modelcontextprotocol/server';
import type { z } from 'zod/v4';

/**
 * Product-neutral facts about one tool request, normalized once per
 * `tools/list` and `tools/call` from SDK-owned request metadata.
 *
 * This context deliberately carries no product concern: it does not decide
 * elicitation support, parse serving-path URLs, or model per-connection
 * opt-out. A consumer that needs those builds them on top.
 */
export type ToolRequestContext = {
  /** The SDK request context, including the multi-round-trip accessors. */
  server: ServerContext;
  /**
   * `modern` when the request carried the per-request `_meta` envelope
   * introduced with the multi-round-trip protocol revision, `legacy`
   * otherwise.
   */
  era: 'legacy' | 'modern';
  /** Client identity, when the request envelope carried it. */
  clientInfo?: Implementation;
  /** Client capabilities, when the request envelope carried them. */
  clientCapabilities?: ClientCapabilities;
};

/**
 * Closed allowlist of fields a policy may report about its own decision.
 *
 * Deliberately has no index signature: every field is an optional named
 * scalar, so raw arguments, request state, and response content cannot reach
 * a telemetry sink through this type. Widening the allowlist is a deliberate,
 * reviewed change rather than a smuggled open record.
 *
 * The values are opaque to this package. A downstream policy chooses them.
 */
export type ToolPolicyTelemetry = {
  /** Correlates every round and repeated attempt of one logical interaction. */
  interactionId?: string;
  /** Which authority path granted the action. */
  authorityPath?: string;
  /** Terminal classification of the decision. */
  outcome?: string;
  /** Internal, non-user-facing explanation of the outcome. */
  reason?: string;
  /** Stable identifier of the policy that produced the decision. */
  policyId?: string;
  /** Version of the policy contract that produced the decision. */
  policyVersion?: number;
};

/**
 * The outcome of consulting a policy before business execution: either
 * proceed with a resolution, or answer the caller directly.
 */
export type ToolPolicyDecision<Resolution> =
  | {
      type: 'execute';
      resolution: Resolution;
      telemetry: ToolPolicyTelemetry;
    }
  | {
      type: 'result';
      result: CallToolResult | InputRequiredResult;
      telemetry: ToolPolicyTelemetry;
    };

/**
 * A pre-execution guard around one tool.
 *
 * The server applies the hooks in a fixed order: contextual discovery and
 * schema selection, argument normalization, strict parsing, then `resolve`.
 * Business execution runs only after `resolve` returns an `execute` decision.
 */
export type ToolPolicy<Params, Resolution> = {
  /** Replaces the advertised and enforced input schema for this request. */
  inputSchema?(
    schema: z.ZodObject<any>,
    ctx: ToolRequestContext
  ): z.ZodObject<any>;

  /**
   * Chooses the output schema this request advertises, and by doing so
   * decides whether the request carries structured results at all.
   *
   * Returning a schema normalizes the request: its `tools/list` entry
   * advertises that schema, its call result carries `structuredContent`, and
   * the tool's `formatResult` renders the text.
   *
   * Returning `undefined` suppresses structured results for that request,
   * restoring the whole pre-normalization result: no `outputSchema` key in
   * its `tools/list` entry, no `structuredContent`, and single-encoded
   * `JSON.stringify` text with `formatResult` skipped. Use it to hold one
   * serving path or client generation on byte-exact legacy output while
   * another is normalized.
   *
   * Defining no hook at all normalizes every request against the tool's own
   * `outputSchema`. Discovery and the call path evaluate this once per
   * request and always agree.
   */
  outputSchema?(
    schema: z.ZodObject<any>,
    ctx: ToolRequestContext
  ): z.ZodType | undefined;

  /** Adjusts raw arguments before strict parsing rejects unknown fields. */
  normalizeArguments?(raw: unknown, ctx: ToolRequestContext): unknown;

  /** Decides whether the tool executes, and with what resolution. */
  resolve(
    params: Params,
    ctx: ToolRequestContext
  ): Promise<ToolPolicyDecision<Resolution>>;
};
