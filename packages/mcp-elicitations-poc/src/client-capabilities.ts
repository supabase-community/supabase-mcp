import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";

export type ClientInfo = { name?: string; version?: string };
export type DeclaredCapabilities = { elicitation?: Record<string, unknown> };

export type Opening = {
  method: string;
  clientInfo?: ClientInfo;
  capabilities?: DeclaredCapabilities;
  protocol?: unknown;
};

/**
 * The opening exchange of a connection. `initialize` is the 2025 era,
 * `server/discover` the 2026-07-28 era. Both carry what the client declares.
 */
const OPENING_METHODS: Record<string, true> = {
  initialize: true,
  "server/discover": true,
};

export function readOpening(message: unknown): Opening | undefined {
  if (!message || typeof message !== "object") return undefined;
  if (!("method" in message) || typeof message.method !== "string") {
    return undefined;
  }
  if (OPENING_METHODS[message.method] !== true) return undefined;

  const params =
    "params" in message && message.params && typeof message.params === "object"
      ? (message.params as Record<string, unknown>)
      : {};
  const meta =
    params._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : {};

  return {
    method: message.method,
    clientInfo: (meta[CLIENT_INFO_META_KEY] ?? params.clientInfo) as
      | ClientInfo
      | undefined,
    capabilities: (meta[CLIENT_CAPABILITIES_META_KEY] ??
      params.capabilities) as DeclaredCapabilities | undefined,
    protocol: meta[PROTOCOL_VERSION_META_KEY] ?? params.protocolVersion,
  };
}

export type CapabilityMemo = {
  remember(message: unknown): void;
  declared(): DeclaredCapabilities | undefined;
};

/**
 * Remembers what the opening exchange declared.
 *
 * The 2026-07-28 design puts client capabilities in every request's `_meta`
 * envelope, and a server is meant to read them there. Claude Code 2.1.226
 * declares them only at `server/discover`, so a server that reads the envelope
 * alone sees nothing and routes the client to its lowest-capability path.
 */
export function createCapabilityMemo(): CapabilityMemo {
  let declared: DeclaredCapabilities | undefined;

  return {
    remember(message) {
      const opening = readOpening(message);
      if (opening?.capabilities) declared = opening.capabilities;
    },
    declared: () => declared,
  };
}

/**
 * Claude Code declares `elicitation: {}` with no mode on both eras, and its
 * 2025-era UI renders a form. A mode-less declaration therefore counts as form
 * capable here. A declaration naming only `url` does not.
 */
export function isFormCapable(
  declared: DeclaredCapabilities | undefined,
): boolean {
  const elicitation = declared?.elicitation;
  if (elicitation === undefined) return false;

  const modes = Object.keys(elicitation);
  return modes.length === 0 || modes.includes("form");
}
