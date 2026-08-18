import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type CallToolResult,
  type ClientCapabilities,
  type Implementation,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import type { z } from 'zod/v4';

export type ToolRequestInputs = {
  /** Serving-path fact injected by the entry point; capability metadata cannot derive it. */
  formDeliveryAvailable: boolean;
  /** Connection-level form elicitation opt-out. */
  optOut?: boolean;
};

export type ToolRequestContext = {
  server: ServerContext;
  era: 'legacy' | 'modern';
  clientInfo?: Implementation;
  clientCapabilities?: ClientCapabilities;
  formElicitation: boolean;
  formSupportReason: 'available' | 'serving_path' | 'opt_out' | 'capability';
};

export type ToolPolicyTelemetry = {
  interactionId?: string;
  authorityPath?: string;
  outcome?: string;
  reason?: string;
  policyId?: string;
  policyVersion?: number;
  formSupportReason?: string;
};

export function sanitizeToolPolicyTelemetry(
  telemetry: ToolPolicyTelemetry
): ToolPolicyTelemetry {
  const sanitized: ToolPolicyTelemetry = {};
  if (telemetry.interactionId !== undefined) {
    sanitized.interactionId = telemetry.interactionId;
  }
  if (telemetry.authorityPath !== undefined) {
    sanitized.authorityPath = telemetry.authorityPath;
  }
  if (telemetry.outcome !== undefined) {
    sanitized.outcome = telemetry.outcome;
  }
  if (telemetry.reason !== undefined) {
    sanitized.reason = telemetry.reason;
  }
  if (telemetry.policyId !== undefined) {
    sanitized.policyId = telemetry.policyId;
  }
  if (telemetry.policyVersion !== undefined) {
    sanitized.policyVersion = telemetry.policyVersion;
  }
  if (telemetry.formSupportReason !== undefined) {
    sanitized.formSupportReason = telemetry.formSupportReason;
  }
  return sanitized;
}

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

export type ToolPolicy<Params, Resolution> = {
  inputSchema?(
    schema: z.ZodObject<any>,
    ctx: ToolRequestContext
  ): z.ZodObject<any>;
  outputSchema?(
    schema: z.ZodObject<any>,
    ctx: ToolRequestContext
  ): z.ZodType;
  normalizeArguments?(raw: unknown, ctx: ToolRequestContext): unknown;
  resolve(
    params: Params,
    ctx: ToolRequestContext
  ): Promise<ToolPolicyDecision<Resolution>>;
};

export function normalizeToolRequestContext(
  server: ServerContext,
  inputs: ToolRequestInputs
): ToolRequestContext {
  const envelope = server.mcpReq.envelope;
  const metadata = envelope as Record<string, unknown> | undefined;
  const protocolVersion = metadata?.[PROTOCOL_VERSION_META_KEY];
  const era = protocolVersion === undefined ? 'legacy' : 'modern';
  const clientInfo = metadata?.[CLIENT_INFO_META_KEY] as
    | Implementation
    | undefined;
  const clientCapabilities = metadata?.[CLIENT_CAPABILITIES_META_KEY] as
    | ClientCapabilities
    | undefined;
  const elicitation = clientCapabilities?.elicitation;
  const clientDeclaresForm =
    elicitation !== undefined &&
    ('form' in elicitation || Object.keys(elicitation).length === 0);
  const formElicitation =
    inputs.formDeliveryAvailable && clientDeclaresForm && !inputs.optOut;

  const formSupportReason = !inputs.formDeliveryAvailable
    ? 'serving_path'
    : inputs.optOut
      ? 'opt_out'
      : !clientDeclaresForm
        ? 'capability'
        : 'available';

  return {
    server,
    era,
    clientInfo,
    clientCapabilities,
    formElicitation,
    formSupportReason,
  };
}
