import {
  Client,
  type ElicitResult,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { createPocServerFactory } from "../src/server.js";

type ElicitationRequest = {
  message: string;
  requestedSchema?: unknown;
};

type ElicitationAnswer = {
  action: "accept" | "decline" | "cancel";
  content?: Record<string, unknown>;
};

const toolResultSchema = z.object({
  structuredContent: z.object({ status: z.string() }),
});

const schemaShape = z.object({ required: z.array(z.string()) });

const open: Array<() => Promise<unknown>> = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((close) => close()));
});

/**
 * A 2025-era client: no per-request capability envelope, classic
 * `elicitation: {}`, and one pinned server instance for the connection. This is
 * the shape a shipping MCP client sends today.
 */
async function connectClassicClient(
  respond: (request: ElicitationRequest) => ElicitationAnswer,
) {
  const { createServer, registry } = createPocServerFactory();
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: "classic-era-client", version: "0.0.0" },
    {
      capabilities: { roots: { listChanged: true }, elicitation: {} },
      versionNegotiation: { mode: "legacy" },
    },
  );

  const requests: ElicitationRequest[] = [];
  client.setRequestHandler("elicitation/create", async (request) => {
    const received: ElicitationRequest = {
      message: request.params.message,
      requestedSchema:
        "requestedSchema" in request.params
          ? request.params.requestedSchema
          : undefined,
    };
    requests.push(received);

    // The SDK's ElicitResult content index accepts primitives only; the PoC
    // validates accepted content server-side with Zod.
    return respond(received) as unknown as ElicitResult;
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  open.push(() => Promise.all([client.close(), server.close()]));

  return { client, registry, requests };
}

describe("classic-era elicitation fallback", () => {
  it("pushes elicitation/create and creates one project when the client accepts", async () => {
    const connection = await connectClassicClient(() => ({ action: "accept" }));

    const result = await connection.client.callTool({
      name: "create_project",
      arguments: { name: "classic-project", organization_id: "org_classic" },
    });

    expect(connection.requests).toHaveLength(1);
    expect(connection.requests[0]?.message).toContain("$10/month");
    expect(connection.requests[0]?.requestedSchema).toEqual({
      type: "object",
      properties: {},
    });
    expect(toolResultSchema.parse(result).structuredContent.status).toBe(
      "created",
    );
    expect(connection.registry.countByName("classic-project")).toBe(1);
  });

  it("creates no project when the client declines", async () => {
    const connection = await connectClassicClient(() => ({
      action: "decline",
    }));

    const result = await connection.client.callTool({
      name: "create_project",
      arguments: { name: "declined-project", organization_id: "org_classic" },
    });

    expect(toolResultSchema.parse(result).structuredContent.status).toBe(
      "declined",
    );
    expect(connection.registry.list()).toHaveLength(0);
  });

  it("keeps cancellation distinct from a decline", async () => {
    const connection = await connectClassicClient(() => ({
      action: "cancel",
    }));

    const result = await connection.client.callTool({
      name: "create_project",
      arguments: { name: "cancelled-project", organization_id: "org_classic" },
    });

    expect(toolResultSchema.parse(result).structuredContent.status).toBe(
      "cancelled",
    );
    expect(connection.registry.list()).toHaveLength(0);
  });

});
