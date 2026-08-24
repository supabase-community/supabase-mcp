import type { ToolRequestContext } from '@supabase/mcp-utils';

/**
 * Whether this request can carry a form elicitation, and the one stable reason
 * behind the answer.
 *
 * The reasons stay distinguishable so a caller can tell an operator opt-out
 * from a serving path that cannot deliver a form, and both from a client that
 * never declared form support.
 */
export type ElicitationAvailability = {
  formElicitation: boolean;
  reason: 'available' | 'serving_path' | 'opt_out' | 'capability';
};

/**
 * Facts the entry point injects because capability metadata cannot derive
 * them. Hosted URL parsing and route selection stay outside this package.
 */
export type ElicitationServingFacts = {
  /** Whether the serving path in front of this server can deliver a form. */
  formDeliveryAvailable: boolean;
  /** Connection-level form elicitation opt-out. */
  optOut?: boolean;
};

/**
 * The SDK-owned facts the resolver reads. Client name and version are
 * deliberately absent: no client label carries authority here, so there is no
 * compatibility table to drift.
 */
type CapabilityContext = Pick<ToolRequestContext, 'era' | 'clientCapabilities'>;

/**
 * Resolves form elicitation support from SDK-owned request facts combined with
 * the injected serving-path facts.
 */
export function resolveElicitationAvailability(
  ctx: CapabilityContext,
  facts: ElicitationServingFacts
): ElicitationAvailability {
  // A legacy request has no multi-round-trip leg to deliver a form on, so
  // classic hosted and deprecated stdio stay incapable however they declare
  // themselves.
  if (!facts.formDeliveryAvailable || ctx.era !== 'modern') {
    return { formElicitation: false, reason: 'serving_path' };
  }

  if (facts.optOut === true) {
    return { formElicitation: false, reason: 'opt_out' };
  }

  const elicitation = ctx.clientCapabilities?.elicitation;
  // A mode-less `elicitation: {}` predates the mode split and means every
  // mode. A declaration that names its modes must name `form`, which leaves a
  // URL-only declaration incapable.
  const declaresForm =
    elicitation !== undefined &&
    (Object.keys(elicitation).length === 0 || 'form' in elicitation);

  if (!declaresForm) {
    return { formElicitation: false, reason: 'capability' };
  }

  return { formElicitation: true, reason: 'available' };
}
