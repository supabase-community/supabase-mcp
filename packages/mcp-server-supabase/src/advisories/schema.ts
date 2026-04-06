import { z } from 'zod/v4';

/**
 * Advisory schema for injecting contextual warnings into MCP tool responses.
 *
 * All GROWTH advisory tasks share this shape. Max 1 advisory per response;
 * when multiple candidates apply, the lowest `priority` number wins.
 *
 * Priority table:
 *   1 — Security (RLS disabled)       GROWTH-712
 *   2 — Plan limit / upgrade errors   GROWTH-699
 *   3 — Activation (checklist/score)  GROWTH-709, GROWTH-715
 *   4 — Feature discovery             GROWTH-711, GROWTH-713
 *   5 — Re-engagement (inactive)      GROWTH-714
 */
export const advisorySchema = z.object({
  id: z.string(),
  priority: z.number().int(),
  level: z.enum(['critical', 'warning', 'info']),
  title: z.string(),
  message: z.string(),
  remediation_sql: z.string(),
  doc_url: z.string(),
});

export type Advisory = z.infer<typeof advisorySchema>;

/**
 * Select the highest-priority advisory (lowest priority number).
 * Returns `null` if no candidates are present.
 */
export function selectAdvisory(
  candidates: (Advisory | null)[]
): Advisory | null {
  const valid = candidates.filter((a): a is Advisory => a !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, curr) =>
    curr.priority < best.priority ? curr : best
  );
}
