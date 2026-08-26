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
 * The business schema itself owns business validation and parsing. The root
 * only preserves the object's declared keys and unknown-key policy until that
 * parse, so defaults, refinements, catchalls, and transforms each run once.
 * Successful business output is then returned exactly as the original schema
 * parsed it.
 */
export function withTerminalOutput<Schema extends z.ZodObject<any>>(
  schema: Schema
) {
  const businessShape = schema.shape as Record<string, z.ZodType>;
  const catchall = schema._zod.def.catchall;
  const advertisedShape: Record<string, z.ZodType> = Object.fromEntries(
    Object.entries(businessShape).map(([key, field]) => [key, field.optional()])
  );
  advertisedShape.status =
    businessShape.status === undefined
      ? elicitationTerminalStatusSchema.optional()
      : z
          .union([businessShape.status, elicitationTerminalStatusSchema])
          .optional();

  const advertisedRoot =
    catchall === undefined
      ? z.object(advertisedShape)
      : z.object(advertisedShape).catchall(catchall);
  const advertisedJSONSchema = z.toJSONSchema(advertisedRoot, {
    target: 'draft-7',
    io: 'input',
  });
  delete advertisedJSONSchema.$schema;

  const runtimeShape: Record<string, z.ZodType> = Object.fromEntries(
    Object.keys(businessShape).map((key) => [key, z.unknown().optional()])
  );
  runtimeShape.status = z.unknown().optional();

  // Preserve raw catchall values for the business parse. A stripping object
  // must still strip undeclared keys before that parse, matching the original.
  const root =
    catchall === undefined
      ? z.object(runtimeShape)
      : z.looseObject(runtimeShape);
  const businessOutputs = new WeakMap<object, z.output<Schema>>();

  return root
    .superRefine((value, ctx) => {
      const business = schema.safeParse(value);
      if (business.success) {
        // Keep this result for the overwrite below. Parsing the original
        // schema again would apply field transforms and defaults twice.
        businessOutputs.set(value, business.data);
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
    })
    .overwrite((value) => businessOutputs.get(value) ?? value)
    .meta(advertisedJSONSchema);
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
