/**
 * PROTOTYPE: Can an unchanged MCP v2 client carry a server-issued
 * Mcp-Session-Id from modern server/discover into later requests?
 *
 * Runs the stock transport first, then the same transport with a public fetch
 * hook that captures and resends the header. No SDK source is patched.
 */
import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { createPoc } from "./server.js";

const SESSION_ID = "synthetic-modern-session";

type Exchange = {
  method: string;
  requestSessionId: string | null;
  responseSessionId?: string | null;
  status?: number;
};

async function run(useFetchHook: boolean) {
  const exchanges: Exchange[] = [];
  const poc = createPoc();
  let capturedSessionId: string | undefined;

  const serverFetch = async (request: Request): Promise<Response> => {
    const body = (await request.clone().json()) as { method?: string };
    const method = body.method ?? "unknown";
    const exchange: Exchange = {
      method,
      requestSessionId: request.headers.get("mcp-session-id"),
    };
    exchanges.push(exchange);

    if (method !== "server/discover" && exchange.requestSessionId !== SESSION_ID) {
      const response = Response.json(
        {
          jsonrpc: "2.0",
          error: { code: -32001, message: "Session not found" },
          id: null,
        },
        { status: 404 },
      );
      exchange.status = response.status;
      exchange.responseSessionId = response.headers.get("mcp-session-id");
      return response;
    }

    const response = await poc.handler.fetch(request);
    if (method !== "server/discover" || !response.ok) {
      exchange.status = response.status;
      exchange.responseSessionId = response.headers.get("mcp-session-id");
      return response;
    }

    const headers = new Headers(response.headers);
    headers.set("mcp-session-id", SESSION_ID);
    const withSession = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
    exchange.status = withSession.status;
    exchange.responseSessionId = withSession.headers.get("mcp-session-id");
    return withSession;
  };

  const routedFetch: typeof fetch = async (input, init) => {
    let request = new Request(input, init);
    if (useFetchHook && capturedSessionId) {
      const headers = new Headers(request.headers);
      headers.set("mcp-session-id", capturedSessionId);
      request = new Request(request, { headers });
    }

    const response = await serverFetch(request);
    if (useFetchHook) {
      capturedSessionId ??= response.headers.get("mcp-session-id") ?? undefined;
    }
    return response;
  };

  const client = new Client(
    { name: "modern-session-spike", version: "0.0.0" },
    { versionNegotiation: { mode: { pin: "2026-07-28" } } },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL("http://poc.local/mcp"),
    { fetch: routedFetch },
  );

  let toolListSucceeded = false;
  let error: string | undefined;
  try {
    await client.connect(transport);
    await client.listTools();
    toolListSucceeded = true;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    await client.close();
  }

  return {
    mode: useFetchHook ? "public fetch hook" : "stock client",
    transportSessionId: transport.sessionId,
    hookSessionId: capturedSessionId,
    toolListSucceeded,
    error,
    exchanges,
  };
}

console.log(
  JSON.stringify(
    {
      question:
        "Can an unchanged MCP v2 client carry modern Mcp-Session-Id without patching the SDK?",
      stock: await run(false),
      fetchHook: await run(true),
    },
    null,
    2,
  ),
);
