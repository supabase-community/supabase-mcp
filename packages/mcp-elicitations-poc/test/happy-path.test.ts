import { afterEach, describe, expect, it } from "vitest";

import { createPoc } from "../src/server.js";
import { createTestClient, rawToolCall } from "./harness.js";

const openClients: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map((client) => client.close()));
});

const args = { name: "test-project", organization_id: "org-1" };

function structured(result: unknown): Record<string, any> {
  return (result as { structuredContent: Record<string, any> })
    .structuredContent;
}

describe("create_project MRTR happy path", () => {
  it("creates exactly one project after acceptance", async () => {
    const poc = createPoc();
    const testClient = await createTestClient({
      poc,
      elicitation: () => ({
        action: "accept",
        content: { confirm: true },
      }),
    });
    openClients.push(testClient);

    const result = await testClient.client.callTool({
      name: "create_project",
      arguments: args,
    });

    expect(structured(result).status).toBe("created");
    expect(poc.registry.list()).toHaveLength(1);
    expect(poc.registry.countByName(args.name)).toBe(1);

    const intermediate = testClient.wire.find(
      (frame) =>
        frame.direction === "response" &&
        frame.body?.result?.resultType === "input_required",
    );
    expect(intermediate?.body.result.resultType).toBe("input_required");
  });

  it("returns an agent-readable normal result when declined", async () => {
    const poc = createPoc();
    const testClient = await createTestClient({
      poc,
      elicitation: () => ({ action: "decline" }),
    });
    openClients.push(testClient);

    const result = await testClient.client.callTool({
      name: "create_project",
      arguments: args,
    });

    expect(structured(result).status).toBe("declined");
    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringMatching(/declined/i),
        }),
      ]),
    );
    expect(poc.registry.list()).toEqual([]);
  });

  it("distinguishes cancellation from decline", async () => {
    const poc = createPoc();
    const testClient = await createTestClient({
      poc,
      elicitation: () => ({ action: "cancel" }),
    });
    openClients.push(testClient);

    const result = await testClient.client.callTool({
      name: "create_project",
      arguments: args,
    });

    expect(structured(result).status).toBe("cancelled");
    expect(structured(result).status).not.toBe("declined");
    expect(poc.registry.list()).toEqual([]);
  });

  it.each([
    ["absent", undefined],
    ["empty", {}],
  ])("reissues input_required when inputResponses are %s", async (_, responses) => {
    const poc = createPoc();
    const first = await rawToolCall({
      poc,
      declareElicitation: true,
      args,
    });
    const requestState = first.body.result.requestState as string;

    const retry = await rawToolCall({
      poc,
      declareElicitation: true,
      args,
      inputResponses: responses,
      requestState,
    });

    expect(retry.status).toBe(200);
    expect(retry.body.error).toBeUndefined();
    expect(retry.body.result.resultType).toBe("input_required");
    expect(retry.body.result.requestState).not.toBe(requestState);
    expect(poc.registry.list()).toEqual([]);
  });

});
