import {
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
  type InputResponseView,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import {
  RequestStateCodec,
  type VerifiedRequestState,
} from './request-state-codec.js';
import { InMemoryReplayStore, type ReplayStore } from './replay-store.js';
import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from './tool-policy.js';

export {
  InMemoryReplayStore,
  type InMemoryReplayStoreOptions,
  type ReplayStore,
} from './replay-store.js';

const MAX_TTL_SECONDS = 120;

export type ElicitationPreparation<P, R> =
  | { type: 'execute'; resolution: R }
  | { type: 'elicit'; proposal: P };

export type ElicitationResolution<R> =
  | { type: 'execute'; resolution: R }
  | { type: 'declined'; message: string }
  | { type: 'cancelled'; message: string }
  | { type: 'reissue' };

export type ElicitationPolicy<Args, P, R> = {
  id: string;
  version: number;
  available(ctx: ToolRequestContext): boolean;
  canonicalArguments(args: Args): unknown;
  prepare(args: Args): Promise<ElicitationPreparation<P, R>>;
  inputRequests(proposal: P): Record<string, unknown>;
  resolve(
    proposal: P,
    inputResponses: Record<string, InputResponseView>
  ): Promise<ElicitationResolution<R>>;
};

export type ElicitationState<P = unknown> = {
  v: 1;
  policyVersion: number;
  policy: string;
  tool: string;
  argsDigest: string;
  proposal: P;
  jti: string;
  iat: number;
  exp: number;
};

export type VerifiedElicitationState = VerifiedRequestState<ElicitationState>;

export type ElicitationRuntimeOptions = {
  approverId: string;
  stateKey: string | Uint8Array;
  ttlSeconds?: number;
  replayStore?: ReplayStore;
  clock?: () => number;
  createJti?: () => string;
  gate?: (ctx: ToolRequestContext) => CallToolResult | null;
};

export const elicitationTerminalSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('declined') }),
  z.object({ status: z.literal('cancelled') }),
]);

export function withPolicyOutput<Schema extends z.ZodObject<any>>(
  schema: Schema
) {
  return z.union([schema, elicitationTerminalSchema]);
}

function errorDecision(
  message: string,
  telemetry: ToolPolicyTelemetry = {}
): ToolPolicyDecision<never> {
  return {
    type: 'result',
    result: {
      content: [{ type: 'text', text: message }],
      isError: true,
    },
    telemetry,
  };
}

function terminalDecision(
  status: 'declined' | 'cancelled',
  message: string,
  telemetry: ToolPolicyTelemetry
): ToolPolicyDecision<never> {
  return {
    type: 'result',
    result: {
      content: [{ type: 'text', text: message }],
      structuredContent: { status },
    },
    telemetry,
  };
}

export class ElicitationRuntime {
  readonly #ttlSeconds: number;
  readonly #clock: () => number;
  readonly #createJti: () => string;
  readonly #replayStore: ReplayStore;
  readonly #gate?: (ctx: ToolRequestContext) => CallToolResult | null;
  readonly #codec: RequestStateCodec<ElicitationState>;

  readonly requestState: {
    mint: (state: ElicitationState, ctx: ServerContext) => Promise<string>;
    verify: (
      state: string,
      ctx: ServerContext
    ) => Promise<VerifiedElicitationState>;
  };

  constructor(options: ElicitationRuntimeOptions) {
    const ttlSeconds = options.ttlSeconds ?? MAX_TTL_SECONDS;
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('ttlSeconds must be a positive finite number');
    }
    if (ttlSeconds > MAX_TTL_SECONDS) {
      throw new RangeError('ttlSeconds must be at most 120');
    }

    this.#ttlSeconds = ttlSeconds;
    this.#clock = options.clock ?? Date.now;
    this.#gate = options.gate;
    this.#createJti = options.createJti ?? (() => crypto.randomUUID());
    this.#replayStore =
      options.replayStore ?? new InMemoryReplayStore({ clock: this.#clock });
    this.#codec = new RequestStateCodec({
      approverId: options.approverId,
      stateKey: options.stateKey,
      clock: this.#clock,
    });
    this.requestState = {
      mint: (state, ctx) => this.#codec.mint(state, ctx),
      verify: (state, ctx) => this.#codec.verify(state, ctx),
    };
  }

  async #inputRequiredDecision<Args, P, R>(
    tool: string,
    policy: ElicitationPolicy<Args, P, R>,
    proposal: P,
    argsDigest: string,
    ctx: ToolRequestContext
  ): Promise<ToolPolicyDecision<never>> {
    const now = Math.floor(this.#clock() / 1_000);
    const jti = this.#createJti();
    const state: ElicitationState<P> = {
      v: 1,
      policyVersion: policy.version,
      policy: policy.id,
      tool,
      argsDigest,
      proposal,
      jti,
      iat: now,
      exp: now + this.#ttlSeconds,
    };
    const requestState = await this.requestState.mint(state, ctx.server);
    const result = inputRequired({
      inputRequests: policy.inputRequests(proposal) as Parameters<
        typeof inputRequired
      >[0]['inputRequests'],
      requestState,
    });

    return {
      type: 'result',
      result,
      telemetry: { interactionId: await this.#codec.interactionId(jti) },
    };
  }

  #gateDecision(
    result: CallToolResult,
    telemetry: ToolPolicyTelemetry = {}
  ): ToolPolicyDecision<never> {
    return {
      type: 'result',
      result,
      telemetry: { ...telemetry, outcome: 'blocked', reason: 'gate' },
    };
  }

  async #resolveInitial<Args, P, R>(
    tool: string,
    policy: ElicitationPolicy<Args, P, R>,
    args: Args,
    argsDigest: string,
    ctx: ToolRequestContext
  ): Promise<ToolPolicyDecision<R>> {
    const gated = this.#gate?.(ctx);
    if (gated != null) {
      return this.#gateDecision(gated);
    }

    const preparation = await policy.prepare(args);
    if (preparation.type === 'execute') {
      return {
        type: 'execute',
        resolution: preparation.resolution,
        telemetry: {},
      };
    }
    return this.#inputRequiredDecision(
      tool,
      policy,
      preparation.proposal,
      argsDigest,
      ctx
    );
  }

  async #resolveContinuation<Args, P, R>(
    tool: string,
    policy: ElicitationPolicy<Args, P, R>,
    argsDigest: string,
    verified: VerifiedElicitationState,
    ctx: ToolRequestContext
  ): Promise<ToolPolicyDecision<R>> {
    if (verified.kind === 'expired') {
      const telemetry =
        verified.authenticatedJti === undefined
          ? {}
          : {
              interactionId: await this.#codec.interactionId(
                verified.authenticatedJti
              ),
            };
      return errorDecision(
        'This confirmation expired. Run the tool again to request a new confirmation.',
        telemetry
      );
    }

    const state = verified.state;
    const interactionId = await this.#codec.interactionId(state.jti);
    const telemetry = { interactionId };
    if (state.v !== 1) {
      return errorDecision(
        'Continuation state version does not match this server.',
        telemetry
      );
    }
    if (state.policy !== policy.id) {
      return errorDecision(
        'Continuation state belongs to a different policy.',
        telemetry
      );
    }
    if (state.policyVersion !== policy.version) {
      return errorDecision(
        'Continuation state policy version is no longer supported. Run the tool again.',
        telemetry
      );
    }
    if (state.tool !== tool) {
      return errorDecision(
        'Continuation state belongs to a different tool.',
        telemetry
      );
    }
    if (state.argsDigest !== argsDigest) {
      return errorDecision(
        'Tool arguments changed after confirmation was requested. Run the tool again.',
        telemetry
      );
    }
    if (!policy.available(ctx)) {
      return errorDecision(
        'This client can no longer continue the confirmation. Run the tool again with form elicitation support.',
        telemetry
      );
    }
    const gated = this.#gate?.(ctx);
    if (gated != null) {
      return this.#gateDecision(gated, telemetry);
    }

    let consumed: boolean;
    try {
      consumed = this.#replayStore.consume(state.jti, (state.exp + 1) * 1_000);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Replay store capacity reached'
      ) {
        return errorDecision(error.message, telemetry);
      }
      throw error;
    }
    if (!consumed) {
      return errorDecision(
        'This confirmation response was already used. Run the tool again.',
        telemetry
      );
    }

    const proposal = state.proposal as P;
    const requests = policy.inputRequests(proposal);
    const rawResponses = ctx.server.mcpReq.inputResponses;
    const responses: Record<string, InputResponseView> = Object.fromEntries(
      Object.keys(requests).map((key) => [
        key,
        inputResponse(rawResponses, key),
      ])
    );
    const resolution = await policy.resolve(proposal, responses);
    if (resolution.type === 'execute') {
      return {
        type: 'execute',
        resolution: resolution.resolution,
        telemetry,
      };
    }
    if (resolution.type === 'declined') {
      return terminalDecision('declined', resolution.message, telemetry);
    }
    if (resolution.type === 'cancelled') {
      return terminalDecision('cancelled', resolution.message, telemetry);
    }
    return this.#inputRequiredDecision(tool, policy, proposal, argsDigest, ctx);
  }

  policy<Args, P, R>(
    tool: string,
    policy: ElicitationPolicy<Args, P, R>
  ): ToolPolicy<Args, R> {
    return {
      outputSchema: withPolicyOutput,
      resolve: async (
        args: Args,
        ctx: ToolRequestContext
      ): Promise<ToolPolicyDecision<R>> => {
        const verified = ctx.server.mcpReq.requestState<
          VerifiedElicitationState | undefined
        >();
        const argsDigest = await this.#codec.argumentsDigest(
          policy.canonicalArguments(args)
        );
        if (verified === undefined) {
          return this.#resolveInitial(tool, policy, args, argsDigest, ctx);
        }
        return this.#resolveContinuation(
          tool,
          policy,
          argsDigest,
          verified,
          ctx
        );
      },
    };
  }
}
