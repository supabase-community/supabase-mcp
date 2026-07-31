import { describe, expect, it, vi } from "vitest";

import { createManagementProjectCreator } from "../src/management.js";
import { createPoc } from "../src/server.js";
import { rawToolCall } from "./harness.js";

const args = { name: "staging-project", organization_id: "org-slug" };

async function confirmedCall(poc: ReturnType<typeof createPoc>) {
  const initial = await rawToolCall({
    poc,
    declareElicitation: true,
    args,
  });
  return rawToolCall({
    poc,
    declareElicitation: true,
    args,
    inputResponses: {
      confirm_cost: {
        action: "accept",
        content: { confirm: true },
      },
    },
    requestState: initial.body.result.requestState as string,
  });
}

describe("Management API project creation", () => {
  it("posts the create-project schema and returns the project ref", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ref: "project-ref" }), { status: 201 }),
    );
    const creator = createManagementProjectCreator({
      baseUrl: "https://api.supabase.green/",
      token: "staging-token",
      region: "eu-west-1",
      fetchImpl,
    });

    await expect(creator(args)).resolves.toEqual({ id: "project-ref" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.supabase.green/v1/projects");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer staging-token",
      "Content-Type": "application/json",
    });
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      name: args.name,
      organization_slug: args.organization_id,
      region: "eu-west-1",
      db_pass: expect.any(String),
    });
    expect(body).not.toHaveProperty("organization_id");
  });

  it("includes the response status when creation fails", async () => {
    const creator = createManagementProjectCreator({
      baseUrl: "https://api.supabase.green",
      token: "staging-token",
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("no capacity", { status: 503 })),
    });

    await expect(creator(args)).rejects.toThrow(/503/);
  });

  it("creates through the injected creator after confirmation", async () => {
    const projectCreator = vi.fn().mockResolvedValue({ id: "real-project-ref" });
    const poc = createPoc({ projectCreator });

    const response = await confirmedCall(poc);

    expect(projectCreator).toHaveBeenCalledWith(args);
    expect(response.body.result.structuredContent.project.id).toBe(
      "real-project-ref",
    );
    expect(poc.registry.list()).toHaveLength(1);
  });

  it("creates in mock mode without using global fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      const poc = createPoc();
      const response = await confirmedCall(poc);

      expect(response.body.result.structuredContent.project).toMatchObject(args);
      expect(poc.registry.list()).toHaveLength(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("returns a tool error and leaves the registry empty on failure", async () => {
    const poc = createPoc({
      projectCreator: vi.fn().mockRejectedValue(new Error("staging unavailable")),
    });

    const response = await confirmedCall(poc);

    expect(response.body.result.isError).toBe(true);
    expect(response.body.result.content[0].text).toContain(
      "staging unavailable",
    );
    expect(poc.registry.list()).toEqual([]);
  });
});
