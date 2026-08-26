import type { ServerContext } from '@modelcontextprotocol/server';

/**
 * Signed, client-readable envelope for multi-round-trip request state.
 *
 * Wire shape, matching the SDK's own codec:
 *
 *     "v1." b64url({"p":<payload>,"exp":<unixSeconds>,"b":<bindTag>}) "." b64url(mac)
 *
 * The body is integrity-protected, not encrypted: the client can decode and
 * read the payload, so nothing secret goes in it.
 *
 * This package signs its own envelope rather than using the SDK's
 * `createRequestStateCodec` for one reason: the SDK verifier throws on an
 * elapsed expiry, and a throw at the request-state seam is a frozen JSON-RPC
 * `-32602`. An authenticated expiry has to reach the tool as recoverable text
 * instead, so expiry classification has to survive verification rather than
 * end it. Integrity, binding, and malformed input still throw and still
 * surface as the SDK-owned `-32602`.
 */

const STATE_PREFIX = 'v1.';
const BIND_LABEL = 'mcp.requestState.bind:';
const SIGNING_KEY_LABEL = 'mcp-request-state:v1';
const BIND_TAG_BYTES = 16;
const MINIMUM_KEY_BYTES = 32;

const encoder = new TextEncoder();

export type StateSigner = {
  sign(value: string): Promise<Uint8Array>;
  verify(value: string, mac: BufferSource): Promise<boolean>;
};

/** Any payload this codec can classify as live or elapsed. */
export type ExpiringPayload = { exp: number };

export type VerifiedPayload<T> =
  | { kind: 'valid'; payload: T }
  | { kind: 'expired'; payload: T };

export type SignedStateCodec<T extends ExpiringPayload> = {
  mint(payload: T, ctx: ServerContext): Promise<string>;
  /**
   * Authenticates an echoed value, then classifies its expiry.
   *
   * Throws for malformed input, a bad MAC, and a binding mismatch, which the
   * SDK request-state seam answers as `-32602`. Resolves for anything that
   * proved authentic, including an elapsed lifetime.
   */
  verify(wire: string, ctx: ServerContext): Promise<VerifiedPayload<T>>;
};

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCodePoint(byte);
  }
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/'));
  return Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Renders a value as JSON with object keys sorted and undefined members
 * dropped, so two arguments that mean the same thing digest the same way
 * whatever order they arrived in.
 */
export function canonicalJson(value: unknown): string {
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

/** Unkeyed digest of canonical arguments, carried inside the signed payload. */
export async function canonicalArgumentsDigest(
  value: unknown
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(canonicalJson(value))
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

/**
 * Derives a signing key from the operator secret, domain-separated by a fixed
 * label so the raw secret never signs anything directly.
 */
export function createStateSigner(key: string | Uint8Array): StateSigner {
  const rawKey =
    typeof key === 'string' ? encoder.encode(key) : Uint8Array.from(key);

  if (rawKey.byteLength < MINIMUM_KEY_BYTES) {
    throw new RangeError(
      `State key must be at least ${MINIMUM_KEY_BYTES} bytes (got ${rawKey.byteLength})`
    );
  }

  const signingKey = (async () => {
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
      encoder.encode(SIGNING_KEY_LABEL)
    );
    return crypto.subtle.importKey(
      'raw',
      derived,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  })();

  return {
    async sign(value) {
      return new Uint8Array(
        await crypto.subtle.sign(
          'HMAC',
          await signingKey,
          encoder.encode(value)
        )
      );
    },
    async verify(value, mac) {
      return crypto.subtle.verify(
        'HMAC',
        await signingKey,
        mac,
        encoder.encode(value)
      );
    },
  };
}

export function createSignedStateCodec<T extends ExpiringPayload>(options: {
  signer: StateSigner;
  /**
   * Values the state is bound to, such as the authenticated actor and the
   * originating MCP method. Stored as a keyed tag, never as the raw string.
   */
  bind: (ctx: ServerContext) => string;
  clock: () => number;
}): SignedStateCodec<T> {
  const { signer, bind, clock } = options;

  async function bindTag(ctx: ServerContext): Promise<string> {
    const signature = await signer.sign(BIND_LABEL + bind(ctx));
    return bytesToBase64Url(signature.slice(0, BIND_TAG_BYTES));
  }

  return {
    async mint(payload, ctx) {
      const envelope = {
        p: payload,
        exp: payload.exp,
        b: await bindTag(ctx),
      };
      const body = bytesToBase64Url(encoder.encode(JSON.stringify(envelope)));
      const mac = bytesToBase64Url(await signer.sign(STATE_PREFIX + body));
      return `${STATE_PREFIX}${body}.${mac}`;
    },

    async verify(wire, ctx) {
      const separator = wire.lastIndexOf('.');
      if (!wire.startsWith(STATE_PREFIX) || separator <= STATE_PREFIX.length) {
        throw new Error('malformed');
      }

      const body = wire.slice(STATE_PREFIX.length, separator);
      let mac: Uint8Array<ArrayBuffer>;
      try {
        mac = base64UrlToBytes(wire.slice(separator + 1));
      } catch {
        throw new Error('malformed');
      }

      if (!(await signer.verify(STATE_PREFIX + body, mac))) {
        throw new Error('mac');
      }

      let envelope: { p?: unknown; exp?: unknown; b?: unknown };
      try {
        envelope = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(
            base64UrlToBytes(body)
          )
        );
      } catch {
        throw new Error('malformed');
      }

      // The MAC covers the whole body, so the binding tag is authentic by the
      // time it is compared. The compare stays constant time anyway.
      if (
        typeof envelope.b !== 'string' ||
        !constantTimeEqual(envelope.b, await bindTag(ctx))
      ) {
        throw new Error('bind');
      }

      if (
        typeof envelope.exp !== 'number' ||
        envelope.p === null ||
        typeof envelope.p !== 'object'
      ) {
        throw new Error('malformed');
      }

      const payload = envelope.p as T;

      // Authenticate first, classify second: an elapsed lifetime is a fact
      // about a value this server signed, so the caller can recover from it.
      if (envelope.exp <= Math.floor(clock() / 1_000)) {
        return { kind: 'expired', payload };
      }

      return { kind: 'valid', payload };
    },
  };
}
