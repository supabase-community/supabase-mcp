import { createHash } from "node:crypto";
import { appendFileSync } from "node:fs";

import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  type McpServer,
  PROTOCOL_VERSION_META_KEY,
  type ServerContext,
} from "@modelcontextprotocol/server";

import {
  type ClientInfo,
  type DeclaredCapabilities,
  readOpening,
} from "./client-capabilities.js";

export type Trace = (event: string, fields?: Record<string, unknown>) => void;

/**
 * A client that spawns a STDIO server owns its stderr, so a manual run cannot
 * watch the narrative in a terminal. `POC_TRACE_FILE` gives it something to
 * tail.
 */
const TRACE_FILE = process.env.POC_TRACE_FILE;

/**
 * A bearer token is credential material, so a trace never carries one. The
 * digest prefix still correlates rounds from one principal within a run.
 */
export function principalTag(sub: string): string {
  return sub === "anonymous"
    ? "anonymous"
    : `sha256:${createHash("sha256").update(sub).digest("hex").slice(0, 12)}`;
}

/**
 * Wire-observed client identity: which client connected, which protocol
 * version it negotiated, and which elicitation modes it declares. A manual
 * client run reads these to tell a form round from a legacy fallback.
 */
function describeClient(
  info: ClientInfo | undefined,
  capabilities: DeclaredCapabilities | undefined,
  protocol: unknown,
): Record<string, unknown> {
  const declared = capabilities?.elicitation;
  const modes = Object.keys(declared ?? {});

  return {
    client: `${info?.name ?? "unknown"}@${info?.version ?? "unknown"}`,
    protocol: typeof protocol === "string" ? protocol : "unknown",
    elicitation:
      declared === undefined
        ? "absent"
        : modes.length > 0
          ? modes.join(",")
          : "declared-empty",
  };
}

export function clientFields(ctx: ServerContext): Record<string, unknown> {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;

  return describeClient(
    envelope?.[CLIENT_INFO_META_KEY] as ClientInfo | undefined,
    envelope?.[CLIENT_CAPABILITIES_META_KEY] as
      | DeclaredCapabilities
      | undefined,
    envelope?.[PROTOCOL_VERSION_META_KEY],
  );
}

/**
 * A 2025-era connection carries client identity on the pinned server instance
 * rather than in a per-request envelope, so a STDIO run reads it from there.
 */
export function pinnedClientFields(
  server: McpServer,
): Record<string, unknown> {
  return describeClient(
    server.server.getClientVersion(),
    server.server.getClientCapabilities(),
    server.server.getNegotiatedProtocolVersion(),
  );
}

export function createTrace(scope: string, enabled = false): Trace {
  if (!enabled) return () => {};

  return (event, fields) => {
    const rendered = Object.entries(fields ?? {})
      .map(
        ([key, value]) =>
          `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
      )
      .join(" ");
    const line = `[${scope}] ${event}${rendered ? ` ${rendered}` : ""}`;
    // stderr only: on a STDIO connection stdout carries the protocol.
    console.error(line);
    if (TRACE_FILE) appendFileSync(TRACE_FILE, `${line}\n`);
  };
}

/**
 * Traces one inbound JSON-RPC message when it opens a connection. Every
 * transport can feed this, which is what makes the STDIO path observable.
 */
export function traceOpening(trace: Trace, message: unknown): void {
  const opening = readOpening(message);
  if (!opening) return;

  trace(opening.method, {
    ...describeClient(
      opening.clientInfo,
      opening.capabilities,
      opening.protocol,
    ),
    capabilities: JSON.stringify(opening.capabilities ?? null),
  });
}

function parseBody(body: string): unknown[] {
  if (!body) return [];

  try {
    const parsed: unknown = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

export function withRequestTrace<
  T extends { fetch(request: Request): Promise<Response> },
>(
  scope: string,
  enabled: boolean | undefined,
  handler: T,
  observe?: (message: unknown) => void,
): T {
  if (!enabled && !observe) return handler;

  const trace = createTrace(scope, enabled);

  return {
    ...handler,
    async fetch(request: Request): Promise<Response> {
      if (request.method === "POST") {
        const body = await request
          .clone()
          .text()
          .catch(() => "");
        for (const message of parseBody(body)) {
          observe?.(message);
          traceOpening(trace, message);
        }
      }
      return handler.fetch(request);
    },
  };
}
