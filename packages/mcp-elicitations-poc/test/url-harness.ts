import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  Client,
  PROTOCOL_VERSION_META_KEY,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import type { UrlPoc } from "../src/url-server.js";

export type WireFrame = {
  direction: "request" | "response";
  status?: number;
  body: any;
};

export type UrlTestClientOptions = {
  poc: UrlPoc;
  bearer?: string;
  capabilities?: "url" | "form-only" | "none";
  onUrl?: (url: string, message: string) => {
    action: "accept" | "decline" | "cancel";
  };
};

function parseBody(text: string): any {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function capabilities(
  value: "url" | "form-only" | "none" = "url",
): Record<string, any> {
  if (value === "url") return { elicitation: { url: {} } };
  if (value === "form-only") return { elicitation: { form: {} } };
  return {};
}

export async function createUrlTestClient(opts: UrlTestClientOptions): Promise<{
  client: Client;
  wire: WireFrame[];
  close(): Promise<void>;
}> {
  const wire: WireFrame[] = [];
  const capturedFetch: typeof fetch = async (input, init) => {
    const outgoing = new Request(input, init);
    wire.push({ direction: "request", body: parseBody(await outgoing.clone().text()) });
    const response = await opts.poc.handler.fetch(outgoing);
    wire.push({ direction: "response", status: response.status, body: parseBody(await response.clone().text()) });
    return response;
  };
  const client = new Client(
    { name: "mcp-url-elicitations-poc-test", version: "0.0.0" },
    {
      versionNegotiation: { mode: { pin: "2026-07-28" } },
      capabilities: capabilities(opts.capabilities),
    },
  );
  if (opts.onUrl) {
    client.setRequestHandler("elicitation/create", async (request) => {
      if (request.params.mode !== "url") throw new Error("Expected URL elicitation");
      return opts.onUrl!(request.params.url, request.params.message);
    });
  }
  const transport = new StreamableHTTPClientTransport(new URL("http://poc.local/mcp"), {
    fetch: capturedFetch,
    requestInit: { headers: { Authorization: `Bearer ${opts.bearer ?? "user-alice"}` } },
  });
  await client.connect(transport);
  return { client, wire, close: () => client.close() };
}

let nextId = 1000;
export async function rawUrlToolCall(opts: {
  poc: UrlPoc;
  bearer?: string;
  capabilities?: "url" | "form-only" | "none";
  args: Record<string, unknown>;
  inputResponses?: Record<string, unknown>;
  requestState?: string;
}): Promise<{ status: number; body: any }> {
  const params: Record<string, unknown> = {
    name: "store_api_key",
    arguments: opts.args,
  };
  if (opts.inputResponses !== undefined) params.inputResponses = opts.inputResponses;
  if (opts.requestState !== undefined) params.requestState = opts.requestState;
  const body = {
    jsonrpc: "2.0",
    id: nextId++,
    method: "tools/call",
    params: {
      ...params,
      _meta: {
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        [CLIENT_INFO_META_KEY]: { name: "mcp-url-poc-raw-test", version: "0.0.0" },
        [CLIENT_CAPABILITIES_META_KEY]: capabilities(opts.capabilities),
      },
    },
  };
  const response = await opts.poc.handler.fetch(new Request("http://poc.local/mcp", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.bearer ?? "user-alice"}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": "tools/call",
      "Mcp-Name": "store_api_key",
    },
    body: JSON.stringify(body),
  }));
  return { status: response.status, body: parseBody(await response.text()) };
}

export async function openConnectPage(opts: {
  poc: UrlPoc;
  url: string;
  session?: string;
}): Promise<{ status: number; body: string }> {
  const response = await opts.poc.connect.fetch(new Request(opts.url, {
    headers: opts.session ? { Cookie: `poc_session=${encodeURIComponent(opts.session)}` } : {},
  }));
  return { status: response.status, body: await response.text() };
}

export async function submitSecret(opts: {
  poc: UrlPoc;
  interactionId: string;
  secret: string;
  name?: string;
  session?: string;
}): Promise<{ status: number; body: string }> {
  const form = new URLSearchParams({
    i: opts.interactionId,
    name: opts.name ?? "github",
    secret: opts.secret,
  });
  const response = await opts.poc.connect.fetch(new Request("http://localhost:3901/connect", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...(opts.session ? { Cookie: `poc_session=${encodeURIComponent(opts.session)}` } : {}),
    },
    body: form,
  }));
  return { status: response.status, body: await response.text() };
}
