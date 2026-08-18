import type { webcrypto } from 'node:crypto';
import {
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

import type {
  ToolPolicy,
  ToolPolicyDecision,
  ToolPolicyTelemetry,
  ToolRequestContext,
} from './tool-policy.js';

const MAX_TTL_SECONDS = 120;
const DEFAULT_REPLAY_CAPACITY = 10_000;
const STATE_PREFIX = 'v1.';
const BIND_LABEL = 'mcp.requestState.bind:';
const STATE_KEY_LABEL = 'mcp-request-state:v1';
const INTERACTION_LABEL = 'mcp-interaction:v1|';

export type ReplayStore = {
  consume(jti: string, expiresAt: number): boolean;
};

export type InMemoryReplayStoreOptions = {
  capacity?: number;
  clock?: () => number;
};

export class InMemoryReplayStore implements ReplayStore {
  readonly #capacity: number;
  readonly #clock: () => number;
  readonly #entries = new Map<string, number>();

  constructor(options: InMemoryReplayStoreOptions = {}) {
    this.#capacity = options.capacity ?? DEFAULT_REPLAY_CAPACITY;
    this.#clock = options.clock ?? Date.now;

    if (!Number.isInteger(this.#capacity) || this.#capacity < 1) {
      throw new RangeError('Replay store capacity must be a positive integer');
    }
  }

  consume(jti: string, expiresAt: number): boolean {
    const now = this.#clock();

    for (const [entryJti, entryExpiresAt] of this.#entries) {
      if (now >= entryExpiresAt) {
        this.#entries.delete(entryJti);
      }
    }

    if (this.#entries.has(jti)) {
      return false;
    }
    if (this.#entries.size >= this.#capacity) {
      throw new Error('Replay store capacity reached');
    }

    this.#entries.set(jti, expiresAt);
    return true;
  }
}

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
    inputResponses: unknown
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

export type VerifiedElicitationState =
  | { kind: 'valid'; state: ElicitationState }
  | {
      kind: 'expired';
      authenticatedExp: number;
      authenticatedJti?: string;
    };

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

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}

function constantTimeTagEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) {
      throw new TypeError('Canonical arguments must be JSON-serializable');
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
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
  readonly #approverId: string;
  readonly #ttlSeconds: number;
  readonly #clock: () => number;
  readonly #createJti: () => string;
  readonly #replayStore: ReplayStore;
  readonly #gate?: (ctx: ToolRequestContext) => CallToolResult | null;
  readonly #keyPromise: Promise<webcrypto.CryptoKey>;
  readonly #encoder = new TextEncoder();

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

    this.#approverId = options.approverId;
    this.#ttlSeconds = ttlSeconds;
    this.#clock = options.clock ?? Date.now;
    this.#gate = options.gate;
    this.#createJti = options.createJti ?? (() => crypto.randomUUID());
    this.#replayStore =
      options.replayStore ?? new InMemoryReplayStore({ clock: this.#clock });

    const rawKey =
      typeof options.stateKey === 'string'
        ? this.#encoder.encode(options.stateKey)
        : Uint8Array.from(options.stateKey);
    this.#keyPromise = this.#deriveRequestStateKey(rawKey);
    this.requestState = {
      mint: (state, ctx) => this.#mint(state, ctx),
      verify: (state, ctx) => this.#verify(state, ctx),
    };
  }

  async #deriveRequestStateKey(
    rawKey: Uint8Array
  ): Promise<webcrypto.CryptoKey> {
    const derivationKey = await crypto.subtle.importKey(
      'raw',
      rawKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const derived = await crypto.subtle.sign(
      'HMAC',
      derivationKey,
      this.#encoder.encode(STATE_KEY_LABEL)
    );
    return crypto.subtle.importKey(
      'raw',
      derived,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  async #sign(value: string): Promise<Uint8Array> {
    return new Uint8Array(
      await crypto.subtle.sign(
        'HMAC',
        await this.#keyPromise,
        this.#encoder.encode(value)
      )
    );
  }

  async #bindTag(ctx: ServerContext): Promise<string> {
    const binding = `${this.#approverId}\u0000${ctx.mcpReq.method}`;
    return bytesToBase64Url(
      (await this.#sign(BIND_LABEL + binding)).slice(0, 16)
    );
  }

  async #mint(state: ElicitationState, ctx: ServerContext): Promise<string> {
    const envelope = {
      p: state,
      exp: state.exp,
      b: await this.#bindTag(ctx),
    };
    const body = bytesToBase64Url(
      this.#encoder.encode(JSON.stringify(envelope))
    );
    const mac = bytesToBase64Url(await this.#sign(STATE_PREFIX + body));
    return `${STATE_PREFIX}${body}.${mac}`;
  }

  async #verify(
    state: string,
    ctx: ServerContext
  ): Promise<VerifiedElicitationState> {
    const dot = state.lastIndexOf('.');
    if (!state.startsWith(STATE_PREFIX) || dot <= STATE_PREFIX.length) {
      throw new Error('malformed');
    }

    const body = state.slice(STATE_PREFIX.length, dot);
    let mac: Uint8Array;
    try {
      mac = base64UrlToBytes(state.slice(dot + 1));
    } catch {
      throw new Error('malformed');
    }
    const validMac = await crypto.subtle.verify(
      'HMAC',
      await this.#keyPromise,
      mac,
      this.#encoder.encode(STATE_PREFIX + body)
    );
    if (!validMac) {
      throw new Error('mac');
    }

    let envelope: {
      p?: unknown;
      exp?: unknown;
      b?: unknown;
    };
    try {
      envelope = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(base64UrlToBytes(body))
      );
    } catch {
      throw new Error('malformed');
    }

    const expectedBindTag = await this.#bindTag(ctx);
    if (
      typeof envelope.b !== 'string' ||
      !constantTimeTagEqual(envelope.b, expectedBindTag)
    ) {
      throw new Error('bind');
    }
    if (typeof envelope.exp !== 'number') {
      throw new Error('malformed');
    }

    if (envelope.exp < Math.floor(this.#clock() / 1_000)) {
      const authenticatedJti =
        envelope.p !== null &&
        typeof envelope.p === 'object' &&
        'jti' in envelope.p &&
        typeof envelope.p.jti === 'string'
          ? envelope.p.jti
          : undefined;
      return {
        kind: 'expired',
        authenticatedExp: envelope.exp,
        ...(authenticatedJti === undefined ? {} : { authenticatedJti }),
      };
    }
    if (envelope.p === null || typeof envelope.p !== 'object') {
      throw new Error('malformed');
    }

    return { kind: 'valid', state: envelope.p as ElicitationState };
  }

  async #argsDigest(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      this.#encoder.encode(canonicalJson(value))
    );
    return bytesToBase64Url(new Uint8Array(digest));
  }

  async #interactionId(jti: string): Promise<string> {
    return bytesToBase64Url(await this.#sign(INTERACTION_LABEL + jti));
  }

  async #inputRequiredDecision<P>(
    tool: string,
    policy: ElicitationPolicy<unknown, P, unknown>,
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
      telemetry: { interactionId: await this.#interactionId(jti) },
    };
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
        const argsDigest = await this.#argsDigest(
          policy.canonicalArguments(args)
        );

        if (verified === undefined) {
          const gated = this.#gate?.(ctx);
          if (gated != null) {
            return { type: 'result', result: gated, telemetry: {} };
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
            policy as ElicitationPolicy<unknown, P, unknown>,
            preparation.proposal,
            argsDigest,
            ctx
          );
        }

        if (verified.kind === 'expired') {
          const telemetry =
            verified.authenticatedJti === undefined
              ? {}
              : {
                  interactionId: await this.#interactionId(
                    verified.authenticatedJti
                  ),
                };
          return errorDecision(
            'This confirmation expired. Run the tool again to request a new confirmation.',
            telemetry
          );
        }

        const state = verified.state as ElicitationState<P>;
        const interactionId = await this.#interactionId(state.jti);
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
          return { type: 'result', result: gated, telemetry };
        }

        let consumed: boolean;
        try {
          consumed = this.#replayStore.consume(
            state.jti,
            (state.exp + 1) * 1_000
          );
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

        const requests = policy.inputRequests(state.proposal);
        const rawResponses = ctx.server.mcpReq.inputResponses;
        const responses = Object.fromEntries(
          Object.keys(requests).map((key) => [
            key,
            inputResponse(rawResponses, key),
          ])
        );
        const resolution = await policy.resolve(state.proposal, responses);
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
        return this.#inputRequiredDecision(
          tool,
          policy as ElicitationPolicy<unknown, P, unknown>,
          state.proposal,
          argsDigest,
          ctx
        );
      },
    };
  }
}
