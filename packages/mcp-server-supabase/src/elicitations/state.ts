import type { ServerContext } from '@modelcontextprotocol/server';

import {
  canonicalArgumentsDigest,
  createSignedStateCodec,
  createStateSigner,
} from './codec.js';
import { deriveInteractionId } from './interaction-id.js';

/**
 * Continuation State is stateless: everything a later round needs travels
 * inside the signed value the client holds. Nothing is stored server side, so
 * nothing has to be evicted, replicated, or consumed.
 */

/** Hard ceiling on how long a continuation stays redeemable. */
export const MAX_LIFETIME_SECONDS = 120;

/** Version of the readable payload shape. */
export const CONTINUATION_PAYLOAD_VERSION = 1;

/**
 * The readable, MAC-protected payload, minus the correlation id.
 *
 * `jti` is deliberately absent: it enters the wire payload at mint time and
 * leaves this module only as a derived Interaction ID, so no caller can read
 * it, log it, or build a single-use check on it.
 */
export type ContinuationState<Proposal = unknown> = {
  v: number;
  policyVersion: number;
  policy: string;
  tool: string;
  argsDigest: string;
  proposal: Proposal;
  iat: number;
  exp: number;
};

type SignedContinuationPayload = ContinuationState & { jti: string };

export type VerifiedContinuation =
  | { kind: 'valid'; interactionId: string; state: ContinuationState }
  | { kind: 'expired'; interactionId: string };

/** What a policy binds into the state when it asks for another round. */
export type ContinuationClaims = {
  policy: string;
  policyVersion: number;
  tool: string;
  argsDigest: string;
  proposal: unknown;
};

export type ContinuationStateOptions = {
  /** Authenticated actor the state is bound to. */
  actorId: string;
  /** Operator secret, at least 32 bytes. */
  stateKey: string | Uint8Array;
  /** Redeemable lifetime, capped at {@link MAX_LIFETIME_SECONDS}. */
  lifetimeSeconds?: number;
  clock?: () => number;
  createJti?: () => string;
};

export type ContinuationStateStore = {
  /** Digest of the canonical arguments a continuation is bound to. */
  argumentsDigest(value: unknown): Promise<string>;
  mint(
    claims: ContinuationClaims,
    ctx: ServerContext
  ): Promise<{ requestState: string; interactionId: string }>;
  /**
   * Drop-in for `McpServerOptions.requestState.verify`. It throws for
   * malformed input, a failed MAC, a wrong actor, and a wrong MCP method, all
   * of which the SDK seam answers as `-32602` before any handler runs.
   */
  verify(wire: string, ctx: ServerContext): Promise<VerifiedContinuation>;
};

export function createContinuationState(
  options: ContinuationStateOptions
): ContinuationStateStore {
  const lifetimeSeconds = options.lifetimeSeconds ?? MAX_LIFETIME_SECONDS;

  if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0) {
    throw new RangeError('lifetimeSeconds must be a positive finite number');
  }

  if (lifetimeSeconds > MAX_LIFETIME_SECONDS) {
    throw new RangeError(
      `lifetimeSeconds must be at most ${MAX_LIFETIME_SECONDS}`
    );
  }

  const clock = options.clock ?? Date.now;
  const createJti = options.createJti ?? (() => crypto.randomUUID());
  const signer = createStateSigner(options.stateKey);
  const codec = createSignedStateCodec<SignedContinuationPayload>({
    signer,
    // The actor keeps one caller from redeeming another's state; the method
    // keeps state minted for one MCP method from being echoed into another.
    bind: (ctx) => `${options.actorId}\u0000${ctx.mcpReq.method}`,
    clock,
  });

  return {
    argumentsDigest: canonicalArgumentsDigest,

    async mint(claims, ctx) {
      const issuedAt = Math.floor(clock() / 1_000);
      const jti = createJti();
      const requestState = await codec.mint(
        {
          v: CONTINUATION_PAYLOAD_VERSION,
          policyVersion: claims.policyVersion,
          policy: claims.policy,
          tool: claims.tool,
          argsDigest: claims.argsDigest,
          proposal: claims.proposal,
          jti,
          iat: issuedAt,
          exp: issuedAt + lifetimeSeconds,
        },
        ctx
      );

      return {
        requestState,
        interactionId: await deriveInteractionId(signer, jti),
      };
    },

    async verify(wire, ctx) {
      const verified = await codec.verify(wire, ctx);
      const { jti, ...state } = verified.payload;

      if (typeof jti !== 'string') {
        throw new Error('malformed');
      }

      const interactionId = await deriveInteractionId(signer, jti);

      if (verified.kind === 'expired') {
        return { kind: 'expired', interactionId };
      }

      return { kind: 'valid', interactionId, state };
    },
  };
}
