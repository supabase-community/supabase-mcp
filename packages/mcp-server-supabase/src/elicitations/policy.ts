import type { InputResponseView } from '@modelcontextprotocol/server';

/**
 * What a policy decides before anything is asked of the caller: either the
 * action needs no confirmation, or here is the proposal to confirm.
 */
export type ElicitationPreparation<Proposal, Resolution> =
  | { type: 'execute'; resolution: Resolution }
  | { type: 'elicit'; proposal: Proposal };

/**
 * What a policy makes of the caller's answer.
 *
 * `reissue` asks for another round with the proposal already signed, which is
 * how invalid input is corrected without preparing the proposal again.
 */
export type ElicitationResolution<Resolution> =
  | { type: 'execute'; resolution: Resolution }
  | { type: 'declined'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'reissue' };

/**
 * The product half of an elicitation flow. The runtime owns state integrity,
 * lifetime, correlation, and terminal composition; a policy owns what is
 * proposed, what is asked, and what an answer means.
 */
export type ElicitationPolicy<Args, Proposal, Resolution> = {
  /** Stable identifier bound into the signed state. */
  id: string;
  /** Contract version bound into the signed state. */
  version: number;
  /** The arguments an approval is bound to, minus incidental fields. */
  canonicalArguments(args: Args): unknown;
  prepare(args: Args): Promise<ElicitationPreparation<Proposal, Resolution>>;
  /** Embedded input requests, keyed by identifiers unique to this request. */
  inputRequests(proposal: Proposal): Record<string, unknown>;
  resolve(
    proposal: Proposal,
    inputResponses: Record<string, InputResponseView>
  ): Promise<ElicitationResolution<Resolution>>;
};
