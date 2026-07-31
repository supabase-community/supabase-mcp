import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  acceptedContent,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import { createRegistry } from "./mock-management.js";
import type { Registry } from "./types.js";

export interface JtiStore {
  consume(jti: string): boolean;
}

export class InMemoryJtiStore implements JtiStore {
  readonly #consumed = new Set<string>();

  consume(jti: string): boolean {
    if (this.#consumed.has(jti)) return false;
    this.#consumed.add(jti);
    return true;
  }
}

export type PocOptions = {
  stateKey?: string;
  ttlSeconds?: number;
  jtiStore?: JtiStore | null;
  projectCreator?: (input: {
    name: string;
    organization_id: string;
  }) => Promise<{ id: string }>;
};

export type Poc = {
  handler: { fetch(req: Request): Promise<Response> };
  registry: Registry;
};

export const DEFAULT_STATE_KEY =
  process.env.POC_STATE_KEY ?? randomBytes(32).toString("hex");
export const PROJECT_COST = { amount: 10, recurrence: "monthly" } as const;

type State = {
  v: 1;
  sub: string;
  tool: "create_project";
  argsDigest: string;
  cost: typeof PROJECT_COST;
  jti: string;
  iat: number;
};

const inputSchema = z.object({
  name: z.string(),
  organization_id: z.string(),
  confirm_cost_token: z.string().optional(),
});
const confirmationSchema = z.object({ confirm: z.boolean() });

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalArgs(name: string, organizationId: string): string {
  return JSON.stringify({ name, organization_id: organizationId });
}

function argsDigest(name: string, organizationId: string): string {
  return sha256(canonicalArgs(name, organizationId));
}

export function legacyConfirmToken(
  name: string,
  organizationId: string,
): string {
  return sha256(
    JSON.stringify({
      tool: "create_project",
      args: { name, organization_id: organizationId },
      cost: PROJECT_COST,
    }),
  );
}

function principal(ctx: ServerContext): string {
  const authorization = ctx.http?.req?.headers.get("authorization");
  const match = authorization?.match(/^Bearer (.+)$/i);
  return match?.[1] ?? "anonymous";
}

function declaresFormElicitation(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as
    | Record<string, unknown>
    | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as
    | { elicitation?: { form?: unknown } }
    | undefined;
  return capabilities?.elicitation?.form !== undefined;
}

function result(
  structuredContent: Record<string, unknown>,
  text: string,
  isError = false,
) {
  return {
    content: [{ type: "text" as const, text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

export function createPoc(opts: PocOptions = {}): Poc {
  const registry = createRegistry();
  const jtiStore = opts.jtiStore ?? null;
  const codec = createRequestStateCodec<State>({
    key: opts.stateKey ?? DEFAULT_STATE_KEY,
    ttlSeconds: opts.ttlSeconds ?? 120,
    bind: (ctx) => ctx.mcpReq.method,
  });

  const mintState = (
    ctx: ServerContext,
    sub: string,
    name: string,
    organizationId: string,
  ) =>
    codec.mint(
      {
        v: 1,
        sub,
        tool: "create_project",
        argsDigest: argsDigest(name, organizationId),
        cost: PROJECT_COST,
        jti: randomUUID(),
        iat: Math.floor(Date.now() / 1000),
      },
      ctx,
    );

  const createProject = async (name: string, organization_id: string) => {
    try {
      const created = await opts.projectCreator?.({ name, organization_id });
      const project = registry.createProject({
        name,
        organization_id,
        cost: PROJECT_COST,
      });
      if (created) project.id = created.id;
      return result(
        { status: "created", project },
        `Created project "${name}".`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return result({ status: "error" }, message, true);
    }
  };

  const askForConfirmation = async (
    ctx: ServerContext,
    sub: string,
    name: string,
    organizationId: string,
  ) =>
    inputRequired({
      inputRequests: {
        confirm_cost: inputRequired.elicit({
          mode: "form",
          message: `Creating project "${name}" costs $10/month. Do you confirm?`,
          requestedSchema: {
            type: "object",
            properties: {
              confirm: {
                type: "boolean",
                description: "Confirm the recurring project cost.",
              },
            },
            required: ["confirm"],
          },
        }),
      },
      requestState: await mintState(ctx, sub, name, organizationId),
    });

  const handler = createMcpHandler((requestContext) => {
    const server = new McpServer(
      { name: "mcp-elicitations-poc", version: "0.0.0" },
      { requestState: { verify: codec.verify } },
    );

    server.registerTool(
      "create_project",
      {
        description: opts.projectCreator
          ? "Create a Supabase project via the configured Management API."
          : "Create a mock Supabase project.",
        inputSchema,
      },
      async ({ name, organization_id, confirm_cost_token }, ctx) => {
        const sub = principal(ctx);

        if (!declaresFormElicitation(ctx)) {
          const expected = legacyConfirmToken(name, organization_id);
          if (confirm_cost_token === undefined) {
            return result(
              {
                status: "confirmation_required",
                confirm_cost_token: expected,
              },
              "Confirmation required. Retry with the supplied confirm_cost_token.",
            );
          }
          if (confirm_cost_token !== expected) {
            return result(
              { status: "error" },
              "The confirm_cost_token is invalid.",
              true,
            );
          }
          return createProject(name, organization_id);
        }

        const state = ctx.mcpReq.requestState<State>();
        if (!state) {
          return askForConfirmation(ctx, sub, name, organization_id);
        }
        if (state.sub !== sub) {
          return result(
            { status: "error" },
            "Request state principal does not match the current principal.",
            true,
          );
        }
        if (state.argsDigest !== argsDigest(name, organization_id)) {
          return result(
            { status: "error" },
            "Request state arguments do not match the current arguments.",
            true,
          );
        }
        if (jtiStore && !jtiStore.consume(state.jti)) {
          return result(
            { status: "error" },
            "Request state replay was rejected.",
            true,
          );
        }

        const response = inputResponse(
          ctx.mcpReq.inputResponses,
          "confirm_cost",
        );
        if (response.kind === "missing") {
          return askForConfirmation(ctx, sub, name, organization_id);
        }
        if (response.kind !== "elicit") {
          return askForConfirmation(ctx, sub, name, organization_id);
        }
        if (response.action === "decline") {
          return result(
            { status: "declined" },
            "Project creation was declined.",
          );
        }
        if (response.action === "cancel") {
          return result(
            { status: "cancelled" },
            "Project creation was cancelled.",
          );
        }

        const content = acceptedContent(
          ctx.mcpReq.inputResponses,
          "confirm_cost",
          confirmationSchema,
        );
        if (!content) {
          return askForConfirmation(ctx, sub, name, organization_id);
        }
        if (!content.confirm) {
          return result(
            { status: "declined" },
            "Project creation was declined.",
          );
        }

        return createProject(name, organization_id);
      },
    );

    // requestInfo is surfaced again as ctx.http.req by the HTTP transport.
    void requestContext;
    return server;
  });

  return { handler, registry };
}
