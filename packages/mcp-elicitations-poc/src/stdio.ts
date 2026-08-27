/**
 * STDIO entry for a manual client run.
 *
 * A pinned connection buys two things the stateless HTTP entry cannot give.
 *
 * `createMcpHandler` serves 2025-era HTTP traffic statelessly, so the instance
 * answering a tool call never saw `initialize` and cannot know the client
 * declared `elicitation`. One STDIO connection keeps one instance, which makes
 * the pushed 2025-era `elicitation/create` path reachable.
 *
 * On the 2026-07-28 era it also lets the transport repair the envelope. See
 * `restoreDeclaredElicitation`.
 *
 * stdout carries the protocol. Diagnostics go to stderr.
 */
import {
  CLIENT_CAPABILITIES_META_KEY,
  type ServerContext,
} from "@modelcontextprotocol/server";
import {
  StdioServerTransport,
  serveStdio,
} from "@modelcontextprotocol/server/stdio";

import { createCapabilityMemo } from "./client-capabilities.js";
import { createPocServerFactory } from "./server.js";
import { createTrace, traceOpening } from "./trace.js";

const memo = createCapabilityMemo();
const { createServer } = createPocServerFactory({ trace: true });
const trace = createTrace("poc form", true);
const transport = new StdioServerTransport();

/**
 * PoC shim for Claude Code 2.1.226 on the 2026-07-28 era.
 *
 * It declares `elicitation: {}` once at `server/discover`, then sends an empty
 * capability object in every request envelope. The SDK gates elicitation on
 * that envelope and rejects the emit with `-32021`, so the client never sees
 * the request it is capable of rendering. This restores the declaration per
 * request and reads the mode-less form as `form`, which is the mode its
 * 2025-era UI renders.
 */
function restoreDeclaredElicitation(message: unknown): void {
  const declared = memo.declared()?.elicitation;
  if (declared === undefined) return;
  if (!message || typeof message !== "object" || !("params" in message)) return;

  const params = message.params;
  if (!params || typeof params !== "object" || !("_meta" in params)) return;

  const envelope = params._meta;
  if (!envelope || typeof envelope !== "object") return;

  // Narrowed above: the per-request `_meta` envelope of a JSON-RPC request.
  const meta = envelope as Record<string, unknown>;
  const capabilities = meta[CLIENT_CAPABILITIES_META_KEY];
  if (!capabilities || typeof capabilities !== "object") return;

  const carried = capabilities as Record<string, unknown>;
  if (carried.elicitation !== undefined) return;

  carried.elicitation =
    Object.keys(declared).length === 0 ? { form: {} } : declared;
  trace("restored declared elicitation into envelope", {
    elicitation: JSON.stringify(carried.elicitation),
  });
}

console.error("Form-mode MCP PoC serving STDIO; project creation: MOCK");

const handle = serveStdio(createServer, { transport });

// The entry owns the transport and assigns its handler synchronously above, so
// wrapping it here observes every inbound frame without dropping one.
const served = transport.onmessage;
transport.onmessage = (message) => {
  memo.remember(message);
  traceOpening(trace, message);
  restoreDeclaredElicitation(message);
  served?.(message);
};

process.on("SIGINT", () => {
  void handle.close();
});
