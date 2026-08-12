import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  createMcpHandler,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type ServerContext,
} from '@modelcontextprotocol/server';
import { z } from 'zod';

import { createConnectApp } from './connect-app.js';
import {
  InMemoryInteractionStore,
  InMemorySecretStore,
  type InteractionStore,
  type SecretStore,
} from './url-stores.js';

export type UrlPocOptions = {
  stateKey?: string;
  ttlSeconds?: number;
  interactions?: InteractionStore;
  secrets?: SecretStore;
  connectBaseUrl?: string;
  clock?: () => number;
};

export type UrlPoc = {
  handler: { fetch(req: Request): Promise<Response> };
  connect: { fetch(req: Request): Promise<Response> };
  interactions: InteractionStore;
  secrets: SecretStore;
};

type State = {
  v: 1;
  sub: string;
  tool: 'store_api_key';
  argsDigest: string;
  interactionId: string;
  jti: string;
  iat: number;
};

function digest(name: string): string {
  return createHash('sha256').update(JSON.stringify({ name })).digest('hex');
}

function principal(ctx: ServerContext): string {
  const authorization = ctx.http?.req?.headers.get('authorization');
  return authorization?.match(/^Bearer (.+)$/i)?.[1] ?? 'anonymous';
}

function declaresUrl(ctx: ServerContext): boolean {
  const envelope = ctx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as
    | { elicitation?: { url?: unknown } }
    | undefined;
  return capabilities?.elicitation?.url !== undefined;
}

function result(
  structuredContent: Record<string, unknown>,
  text: string,
  isError = false
) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent,
    ...(isError ? { isError: true } : {}),
  };
}

export function createUrlPoc(opts: UrlPocOptions = {}): UrlPoc {
  const clock = opts.clock ?? (() => Date.now());
  const ttlSeconds = opts.ttlSeconds ?? 300;
  const interactions = opts.interactions ?? new InMemoryInteractionStore(clock);
  const secrets = opts.secrets ?? new InMemorySecretStore();
  const connectBaseUrl = (
    opts.connectBaseUrl ?? 'http://localhost:3901'
  ).replace(/\/$/, '');
  const codec = createRequestStateCodec<State>({
    key: opts.stateKey ?? randomBytes(32).toString('hex'),
    ttlSeconds,
    bind: (ctx) => ctx.mcpReq.method,
  });

  const mintState = (
    ctx: ServerContext,
    sub: string,
    name: string,
    interactionId: string
  ) =>
    codec.mint(
      {
        v: 1,
        sub,
        tool: 'store_api_key',
        argsDigest: digest(name),
        interactionId,
        jti: randomUUID(),
        iat: Math.floor(clock() / 1000),
      },
      ctx
    );

  const ask = async (
    ctx: ServerContext,
    sub: string,
    name: string,
    interactionId: string,
    waiting = false
  ) =>
    inputRequired({
      inputRequests: {
        provide_api_key: inputRequired.elicitUrl({
          message: waiting
            ? `Still waiting for the API key "${name}". Open this page to finish.`
            : `Open this page to enter your API key for "${name}". It is stored by Supabase and never passes through your MCP client.`,
          url: `${connectBaseUrl}/connect?i=${encodeURIComponent(interactionId)}`,
        }),
      },
      requestState: await mintState(ctx, sub, name, interactionId),
    });

  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: 'mcp-url-elicitations-poc', version: '0.0.0' },
      { requestState: { verify: codec.verify } }
    );
    server.registerTool(
      'store_api_key',
      {
        description: 'Store an API key through a browser page.',
        inputSchema: z.object({ name: z.string() }),
      },
      async ({ name }, ctx) => {
        const sub = principal(ctx);
        if (!declaresUrl(ctx)) {
          return result(
            {
              status: 'unsupported_client',
              message:
                'A browser-capable client that declares URL elicitation is required.',
            },
            'A browser-capable client that declares URL elicitation is required.'
          );
        }

        const state = ctx.mcpReq.requestState<State>();
        if (!state) {
          const interactionId = randomUUID();
          interactions.create({
            id: interactionId,
            principal: sub,
            tool: 'store_api_key',
            argsDigest: digest(name),
            exp: clock() + ttlSeconds * 1000,
          });
          return ask(ctx, sub, name, interactionId);
        }
        if (state.sub !== sub)
          return result(
            { status: 'error' },
            'Request state principal mismatch.',
            true
          );
        if (state.argsDigest !== digest(name))
          return result(
            { status: 'error' },
            'Request state arguments mismatch.',
            true
          );

        const response = inputResponse(
          ctx.mcpReq.inputResponses,
          'provide_api_key'
        );
        if (response.kind === 'elicit' && response.action === 'decline') {
          return result(
            { status: 'declined' },
            'API key storage was declined.'
          );
        }
        if (response.kind === 'elicit' && response.action === 'cancel') {
          return result(
            { status: 'cancelled' },
            'API key storage was cancelled.'
          );
        }
        if (response.kind !== 'elicit' || response.action !== 'accept') {
          return ask(ctx, sub, name, state.interactionId, true);
        }

        const interaction = interactions.get(state.interactionId);
        if (!interaction)
          return result(
            { status: 'error' },
            'The interaction is missing or expired.',
            true
          );
        if (interaction.status === 'pending')
          return ask(ctx, sub, name, state.interactionId, true);
        if (!interactions.consume(state.interactionId)) {
          return result(
            { status: 'error' },
            'The interaction replay was rejected.',
            true
          );
        }
        const secret = secrets.get(sub, name);
        if (!secret)
          return result(
            { status: 'error' },
            'The stored secret reference is missing.',
            true
          );
        // Any suffix is credential material in model context. Fingerprints need an RFC decision, not a PoC default.
        return result(
          { status: 'stored', name, secret_ref: secret.ref },
          `Stored API key "${name}".`
        );
      }
    );
    return server;
  });

  return {
    handler,
    connect: createConnectApp({ interactions, secrets, clock }),
    interactions,
    secrets,
  };
}
