import { describe, expect, it } from "vitest";

import { createUrlPoc } from "../src/url-server.js";
import {
  createUrlTestClient,
  openConnectPage,
  rawUrlToolCall,
  submitSecret,
} from "./url-harness.js";

const SENTINEL = "sk-live-SENTINEL-9f3a2b";

function elicitation(result: any) {
  return result.body.result.inputRequests.provide_api_key.params;
}

function interactionId(url: string): string {
  return new URL(url).searchParams.get("i")!;
}

describe("URL-mode security", () => {
  describe("secret isolation from the MCP wire", () => {
    it("keeps the secret on the connect channel and returns metadata only", async () => {
      const poc = createUrlPoc({ stateKey: "url-security-wire-state-key-at-least-32-bytes" });
      let connectUrl = "";
      const testClient = await createUrlTestClient({
        poc,
        bearer: "user-alice",
        onUrl: (async (url: string) => {
          connectUrl = url;
          const opened = await openConnectPage({ poc, url, session: "user-alice" });
          expect(opened.status).toBe(200);
          const submitted = await submitSecret({
            poc,
            interactionId: interactionId(url),
            secret: SENTINEL,
            session: "user-alice",
          });
          expect(submitted.status).toBe(200);
          return { action: "accept" as const };
        }) as any,
      });

      try {
        const final = await testClient.client.callTool({
          name: "store_api_key",
          arguments: { name: "github" },
        });
        const frames = testClient.wire.map((frame) => JSON.stringify(frame));
        expect(frames.every((frame) => !frame.includes(SENTINEL))).toBe(true);

        expect(final.structuredContent).toEqual({
          status: "stored",
          name: "github",
          secret_ref: expect.any(String),
          last4: "3a2b",
        });
        expect(JSON.stringify(final)).not.toContain(SENTINEL);

        const url = new URL(connectUrl);
        expect(url.searchParams.size).toBe(1);
        expect([...url.searchParams.keys()]).toEqual(["i"]);
        expect(url.searchParams.get("i")).toMatch(/^[0-9a-f-]{36}$/i);
        expect(connectUrl).not.toMatch(/bearer|sub|secret/i);

        expect(poc.secrets.get("user-alice", "github")).toEqual({
          ref: (final.structuredContent as any).secret_ref,
          last4: "3a2b",
        });
      } finally {
        await testClient.close();
      }
    });
  });

  describe("phishing binding", () => {
    it("rejects missing and mismatched sessions without wedging Alice's flow", async () => {
      const poc = createUrlPoc({ stateKey: "url-security-phishing-state-key-at-least-32-bytes" });
      const first = await rawUrlToolCall({ poc, bearer: "user-alice", args: { name: "github" } });
      const url = elicitation(first).url;
      const id = interactionId(url);

      const unauthenticated = await openConnectPage({ poc, url });
      expect(unauthenticated).toEqual({
        status: 401,
        body: "A valid mock dashboard session is required.",
      });
      expect(poc.interactions.get(id)?.status).toBe("pending");
      expect(poc.secrets.get("user-alice", "github")).toBeUndefined();

      const nobody = await openConnectPage({ poc, url, session: "user-nobody" });
      expect(nobody.status).toBe(403);
      expect(nobody.body).toMatch(/identity mismatch/i);
      expect(poc.interactions.get(id)?.status).toBe("pending");
      expect(poc.secrets.get("user-nobody", "github")).toBeUndefined();

      const bobOpen = await openConnectPage({ poc, url, session: "user-bob" });
      expect(bobOpen.status).toBe(403);
      expect(bobOpen.body).toMatch(/identity mismatch/i);
      expect(poc.interactions.get(id)?.status).toBe("pending");
      expect(poc.secrets.get("user-alice", "github")).toBeUndefined();

      const bobPost = await submitSecret({
        poc,
        interactionId: id,
        secret: SENTINEL,
        session: "user-bob",
      });
      expect(bobPost.status).toBe(403);
      expect(bobPost.body).toMatch(/identity mismatch/i);
      expect(poc.interactions.get(id)?.status).toBe("pending");
      expect(poc.secrets.get("user-alice", "github")).toBeUndefined();
      expect(poc.secrets.get("user-bob", "github")).toBeUndefined();

      expect(await openConnectPage({ poc, url, session: "user-alice" })).toMatchObject({ status: 200 });
      expect(await submitSecret({
        poc,
        interactionId: id,
        secret: SENTINEL,
        session: "user-alice",
      })).toMatchObject({ status: 200 });

      const complete = await rawUrlToolCall({
        poc,
        bearer: "user-alice",
        args: { name: "github" },
        requestState: first.body.result.requestState,
        inputResponses: { provide_api_key: { action: "accept" } },
      });
      expect(complete.body.result.structuredContent).toMatchObject({
        status: "stored",
        secret_ref: expect.any(String),
        last4: "3a2b",
      });
      expect(poc.secrets.get("user-alice", "github")).toBeDefined();
    });
  });

  describe("cross-principal state redemption", () => {
    it("rejects Mallory's retry and leaves Alice's stored secret untouched", async () => {
      const poc = createUrlPoc({ stateKey: "url-security-redemption-state-key-at-least-32-bytes" });
      const first = await rawUrlToolCall({ poc, bearer: "user-alice", args: { name: "github" } });
      const url = elicitation(first).url;
      await openConnectPage({ poc, url, session: "user-alice" });
      await submitSecret({
        poc,
        interactionId: interactionId(url),
        secret: SENTINEL,
        session: "user-alice",
      });
      const aliceSecret = poc.secrets.get("user-alice", "github");

      const mallory = await rawUrlToolCall({
        poc,
        bearer: "user-mallory",
        args: { name: "github" },
        requestState: first.body.result.requestState,
        inputResponses: { provide_api_key: { action: "accept" } },
      });
      expect(mallory.status).toBe(200);
      expect(mallory.body.result).toMatchObject({
        isError: true,
        structuredContent: { status: "error" },
        content: [{ type: "text", text: "Request state principal mismatch." }],
      });
      expect(JSON.stringify(mallory.body)).not.toMatch(/secret_ref|sk-live-SENTINEL/);
      expect(poc.secrets.get("user-mallory", "github")).toBeUndefined();
      expect(poc.secrets.get("user-alice", "github")).toEqual(aliceSecret);
      expect(poc.interactions.get(interactionId(url))?.status).toBe("complete");
    });
  });
});
