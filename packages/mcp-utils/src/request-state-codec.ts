import type { webcrypto } from 'node:crypto';
import type { ServerContext } from '@modelcontextprotocol/server';

const STATE_PREFIX = 'v1.';
const BIND_LABEL = 'mcp.requestState.bind:';
const STATE_KEY_LABEL = 'mcp-request-state:v1';
const INTERACTION_LABEL = 'mcp-interaction:v1|';

export type ExpiringRequestState = {
  exp: number;
  jti: string;
};

export type VerifiedRequestState<T> =
  | { kind: 'valid'; state: T }
  | {
      kind: 'expired';
      authenticatedExp: number;
      authenticatedJti?: string;
    };

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

export class RequestStateCodec<T extends ExpiringRequestState> {
  readonly #approverId: string;
  readonly #clock: () => number;
  readonly #keyPromise: Promise<webcrypto.CryptoKey>;
  readonly #encoder = new TextEncoder();

  constructor(options: {
    approverId: string;
    stateKey: string | Uint8Array;
    clock: () => number;
  }) {
    this.#approverId = options.approverId;
    this.#clock = options.clock;
    const rawKey =
      typeof options.stateKey === 'string'
        ? this.#encoder.encode(options.stateKey)
        : Uint8Array.from(options.stateKey);
    if (rawKey.byteLength < 32) {
      throw new RangeError(
        `createRequestStateCodec: key must be at least 32 bytes (got ${rawKey.byteLength})`
      );
    }
    this.#keyPromise = this.#deriveKey(rawKey);
  }

  async #deriveKey(rawKey: Uint8Array): Promise<webcrypto.CryptoKey> {
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

  async mint(state: T, ctx: ServerContext): Promise<string> {
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

  async verify(
    state: string,
    ctx: ServerContext
  ): Promise<VerifiedRequestState<T>> {
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

    let envelope: { p?: unknown; exp?: unknown; b?: unknown };
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
    return { kind: 'valid', state: envelope.p as T };
  }

  async argumentsDigest(value: unknown): Promise<string> {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      this.#encoder.encode(canonicalJson(value))
    );
    return bytesToBase64Url(new Uint8Array(digest));
  }

  async interactionId(jti: string): Promise<string> {
    return bytesToBase64Url(await this.#sign(INTERACTION_LABEL + jti));
  }
}
