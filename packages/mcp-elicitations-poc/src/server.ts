import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  CLIENT_CAPABILITIES_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  McpServer,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type ServerContext,
} from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  type DeclaredCapabilities,
  isFormCapable,
} from "./client-capabilities.js";
import { createRegistry } from "./mock-management.js";
import {
  clientFields,
  createTrace,
  pinnedClientFields,
  principalTag,
  withRequestTrace,
} from "./trace.js";
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
  trace?: boolean;
  elicitTimeoutMs?: number;
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
  compute_size: z.string().optional(),
  confirm_cost_token: z.string().optional(),
});

/** Branch-style hourly pricing, for the compute-size variant of the prompt. */
const HOURLY_RATE = 0.01344;
const HOURS_PER_MONTH = 24 * 30;
/**
 * A schema with no properties asks the question and nothing else: the client
 * renders the message with its accept and decline controls, and consent lives
 * in `action`. A required boolean instead puts a field in front of the user,
 * who must set it and then accept.
 */
const QUESTION_SCHEMA = { type: "object" as const, properties: {} };

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

/**
 * Which elicitation path this request can take. The 2026-07-28 wire carries the
 * client's capabilities in every request's `_meta` envelope, so routing reads
 * them from there. A client that declares only at its opening exchange needs
 * the transport to restore them per request; see `src/stdio.ts`.
 */
function lane(ctx: ServerContext): "form" | "modern-plain" | "classic" {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  if (typeof envelope?.[PROTOCOL_VERSION_META_KEY] !== "string") {
    return "classic";
  }

  return isFormCapable(
    envelope[CLIENT_CAPABILITIES_META_KEY] as DeclaredCapabilities | undefined,
  )
    ? "form"
    : "modern-plain";
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

/**
 * The tool logic, as a factory of `McpServer` instances. `createMcpHandler`
 * calls it per HTTP request; the STDIO entry calls it once and keeps that
 * instance for the connection, which is what makes `initialize`-scoped
 * 2025-era client capabilities readable at tool-call time.
 */
export function createPocServerFactory(opts: PocOptions = {}): {
  createServer: () => McpServer;
  registry: Registry;
} {
  const registry = createRegistry();
  const jtiStore = opts.jtiStore ?? null;
  const trace = createTrace("poc form", opts.trace);
  // A manual client run pauses on the elicitation UI, so the pushed 2025-era
  // request waits far longer than the SDK's default request timeout.
  const elicitTimeoutMs = opts.elicitTimeoutMs ?? 600_000;
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
      trace("created project", { id: project.id, name });
      return result(
        { status: "created", project },
        `Created project "${name}".`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      trace("creation failed", { message });
      return result({ status: "error" }, message, true);
    }
  };

  const askForConfirmation = async (
    ctx: ServerContext,
    sub: string,
    name: string,
    organizationId: string,
    message: string,
    reason: string,
  ) => {
    trace("-> input_required", { key: "confirm_cost", mode: "form", reason });
    return inputRequired({
      inputRequests: {
        confirm_cost: inputRequired.elicit({
          mode: "form",
          message,
          requestedSchema: QUESTION_SCHEMA,
        }),
      },
      requestState: await mintState(ctx, sub, name, organizationId),
    });
  };

  const createServer = () => {
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
      async (
        { name, organization_id, compute_size, confirm_cost_token },
        ctx,
      ) => {
        const sub = principal(ctx);
        const selected = lane(ctx);
        const form = selected === "form";
        const classic =
          selected === "classic" &&
          server.server.getClientCapabilities()?.elicitation !== undefined;
        const monthlyEstimate = (HOURLY_RATE * HOURS_PER_MONTH).toFixed(2);
        const costMessage = (
          compute_size
            ? [
                `Creating this project costs $${HOURLY_RATE}/hr while it runs.`,
                "",
                `Project          ${name}`,
                `Organization     ${organization_id}`,
                `Compute size     ${compute_size}`,
                `Hourly rate      $${HOURLY_RATE}/hr`,
                `30-day estimate  ~$${monthlyEstimate} if left running`,
                "",
                "Assumes continuous running. Cost recurs until deletion.",
              ]
            : [
                `Creating this project costs $${PROJECT_COST.amount}/month.`,
                "",
                `Project        ${name}`,
                `Organization   ${organization_id}`,
                `Cost           $${PROJECT_COST.amount}/month`,
                "",
                "Cost recurs until the project is deleted.",
              ]
        ).join("\n");
        trace("tools/call create_project", {
          ...(selected === "classic"
            ? pinnedClientFields(server)
            : clientFields(ctx)),
          lane: selected,
          sub: principalTag(sub),
          path: form ? "form" : classic ? "classic" : "legacy",
        });

        // A 2025-era client answers a pushed elicitation/create request inline,
        // so this path completes in one tool call and mints no requestState.
        if (classic) {
          trace("-> elicitation/create", { mode: "form" });
          const elicited = await ctx.mcpReq.elicitInput(
            {
              mode: "form",
              message: costMessage,
              requestedSchema: QUESTION_SCHEMA,
            },
            { timeout: elicitTimeoutMs },
          );
          trace("<- elicitation result", { action: elicited.action });

          if (elicited.action === "decline") {
            return result(
              { status: "declined" },
              "Project creation was declined.",
            );
          }
          if (elicited.action === "cancel") {
            return result(
              { status: "cancelled" },
              "Project creation was cancelled.",
            );
          }

          trace("accepted", { key: "confirm_cost", via: "action" });
          return createProject(name, organization_id);
        }

        if (!form) {
          const expected = legacyConfirmToken(name, organization_id);
          if (confirm_cost_token === undefined) {
            trace("-> legacy confirmation_required");
            return result(
              {
                status: "confirmation_required",
                confirm_cost_token: expected,
              },
              "Confirmation required. Retry with the supplied confirm_cost_token.",
            );
          }
          if (confirm_cost_token !== expected) {
            trace("-> legacy token mismatch");
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
          return askForConfirmation(
            ctx,
            sub,
            name,
            organization_id,
            costMessage,
            "no-state",
          );
        }
        if (state.sub !== sub) {
          trace("-> rejected", { reason: "principal mismatch" });
          return result(
            { status: "error" },
            "Request state principal does not match the current principal.",
            true,
          );
        }
        if (state.argsDigest !== argsDigest(name, organization_id)) {
          trace("-> rejected", { reason: "argument digest mismatch" });
          return result(
            { status: "error" },
            "Request state arguments do not match the current arguments.",
            true,
          );
        }
        if (jtiStore && !jtiStore.consume(state.jti)) {
          trace("-> rejected", { reason: "jti replay" });
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
          return askForConfirmation(
            ctx,
            sub,
            name,
            organization_id,
            costMessage,
            "response-missing",
          );
        }
        if (response.kind !== "elicit") {
          return askForConfirmation(
            ctx,
            sub,
            name,
            organization_id,
            costMessage,
            `response-kind-${response.kind}`,
          );
        }
        if (response.action === "decline") {
          trace("-> declined", { key: "confirm_cost", action: "decline" });
          return result(
            { status: "declined" },
            "Project creation was declined.",
          );
        }
        if (response.action === "cancel") {
          trace("-> cancelled", { key: "confirm_cost", action: "cancel" });
          return result(
            { status: "cancelled" },
            "Project creation was cancelled.",
          );
        }

        trace("accepted", { key: "confirm_cost", via: "action" });
        return createProject(name, organization_id);
      },
    );

    return server;
  };

  return { createServer, registry };
}

export function createPoc(opts: PocOptions = {}): Poc {
  const { createServer, registry } = createPocServerFactory(opts);

  return {
    handler: withRequestTrace(
      "poc form",
      opts.trace,
      createMcpHandler(createServer),
    ),
    registry,
  };
}
