import type { CreationRate } from './platform/types.js';

/**
 * The cost shape the legacy `get_cost` and `confirm_cost` pair speaks.
 *
 * It carries no currency, because the hash a legacy confirmation is identified
 * by is computed over exactly these fields. Adding one would invalidate every
 * confirmation a legacy client is holding.
 */
export type Cost = {
  type: 'project' | 'branch';
  recurrence: 'hourly' | 'monthly';
  amount: number;
};

/**
 * Presents an authoritative rate as the legacy cost shape.
 *
 * This is the whole adapter: the rate itself comes from the Management API, so
 * this package holds no price of its own to fall back to.
 */
export function toCost(type: Cost['type'], rate: CreationRate): Cost {
  return { type, recurrence: rate.recurrence, amount: rate.amount };
}

/**
 * The hourly branch rate the legacy confirmation pair agrees on.
 *
 * The authoritative branch rate is scoped to the parent project, and legacy
 * `get_cost` has no project reference to read it with: its only argument is an
 * organization. Both halves of the legacy pair therefore keep quoting this
 * value, which is the same rate Billing's catalog reports today, so a legacy
 * confirmation still matches the cost the legacy creation path recomputes.
 *
 * It is not a fallback: no authoritative read ever resolves to it. The v2
 * confirmation path reads the Management API for the parent project and never
 * calls this.
 */
export function legacyBranchCost(): Cost {
  return { type: 'branch', recurrence: 'hourly', amount: 0.01344 };
}

/**
 * Whether a freshly read rate is still covered by the maximum a caller
 * approved.
 *
 * An equal or lower amount proceeds; a higher amount does not. Recurrence and
 * currency must be unchanged, because a lower number under a different
 * interval or currency is not a lower price.
 */
export function isRateWithinApproved(
  rate: CreationRate,
  approved: CreationRate
): boolean {
  return (
    rate.currency === approved.currency &&
    rate.recurrence === approved.recurrence &&
    rate.amount <= approved.amount
  );
}
