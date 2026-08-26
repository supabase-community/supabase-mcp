import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

/**
 * Non-error terminal outcomes an elicitation flow reaches without running the
 * tool's business logic.
 *
 * `declined` and `cancelled` stay distinct wire values: a caller that refuses
 * an action has answered, while a caller that abandoned the prompt has not.
 * Collapsing them would erase that difference for every consumer downstream.
 */
export const elicitationTerminalStatusSchema = z.enum([
  'declined',
  'cancelled',
]);

export type ElicitationTerminalStatus = z.infer<
  typeof elicitationTerminalStatusSchema
>;

/**
 * Widens a tool's business output schema with the terminal variants, so a
 * guarded tool advertises every shape it can actually return.
 *
 * MCP restricts structured output to an object root, so the variants sit
 * beneath one object root instead of in a root-level union: every business
 * field becomes optional at the root, `status` also accepts the terminal
 * values, and a refinement decides which whole variant a payload must
 * satisfy. A root-level union serializes to `anyOf` with no root `type`,
 * which fails the entire `tools/list` response.
 *
 * The business schema itself passes through unchanged: an accepted execution
 * is validated by the tool's own schema, not by the widened copy, so an
 * incomplete business payload stays a rejection. The widened root is derived
 * from that same schema, so whatever it says about undeclared fields still
 * holds and an accepted payload survives validation byte for byte.
 */
export function withTerminalOutput<Schema extends z.ZodObject<any>>(
  schema: Schema
) {
  const businessStatus = (schema.shape as Record<string, z.ZodType>).status;

  // Deriving the root from the business schema keeps its own unknown-key
  // handling: a widened copy that stripped what the tool is allowed to emit
  // would turn valid output into an error.
  const root = schema.partial().extend({
    // A business schema that already carries `status` keeps its own values;
    // the terminal ones are offered beside them rather than replacing them.
    status:
      businessStatus === undefined
        ? elicitationTerminalStatusSchema.optional()
        : z.union([businessStatus, elicitationTerminalStatusSchema]).optional(),
  });

  return root.superRefine((value, ctx) => {
    const business = schema.safeParse(value);
    if (business.success) {
      // The original schema owns complete business output. A terminal word in
      // its status field does not turn that valid value into a terminal result.
      return;
    }

    const record = value as Record<string, unknown>;
    const terminal = elicitationTerminalStatusSchema.safeParse(record.status);

    if (terminal.success) {
      // A terminal payload carries the status and nothing else: a business
      // field beside it would claim work that never ran.
      for (const key of Object.keys(record)) {
        if (key !== 'status') {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `Unexpected field on a "${terminal.data}" terminal result.`,
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

/**
 * Composes a non-error terminal result: the distinct status the output schema
 * advertises, plus the caller's own text.
 *
 * The text is a parameter rather than a template. This module carries no
 * product copy, so the same helper serves any policy built on the runtime.
 */
export function terminalResult(
  status: ElicitationTerminalStatus,
  message: string
): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { status },
  };
}

/**
 * Composes an in-band recovery result: an actionable error the caller can act
 * on by running the tool again.
 *
 * It deliberately carries no `structuredContent`. Recovery is not one of the
 * advertised output variants, so emitting structured content here would put
 * off-schema data on the wire.
 */
export function recoveryResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}
