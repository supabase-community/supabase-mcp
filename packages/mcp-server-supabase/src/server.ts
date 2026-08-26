import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  createMcpServer,
  type McpServerOptions,
  type Tool,
  type ToolCallCallback,
  type ToolRequestContext,
} from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import { createElicitationRuntime } from './elicitations/runtime.js';
import { createContentApiClient } from './content-api/index.js';
import type { SupabasePlatform } from './platform/types.js';
import { getAccountTools } from './tools/account-tools.js';
import { getBranchingTools } from './tools/branching-tools.js';
import { getDatabaseTools } from './tools/database-operation-tools.js';
import { getDebuggingTools } from './tools/debugging-tools.js';
import { getDevelopmentTools } from './tools/development-tools.js';
import { getDocsTools } from './tools/docs-tools.js';
import { getEdgeFunctionTools } from './tools/edge-function-tools.js';
import { getStorageTools } from './tools/storage-tools.js';
import { writeToolSet } from './tools/tool-schemas.js';
import { PLATFORM_INDEPENDENT_FEATURES, type FeatureGroup } from './types.js';
import { parseFeatureGroups } from './util.js';

/**
 * The dependencies a hosted deployment injects to serve cost confirmation.
 *
 * This is the whole supported surface, and it is deliberately smaller than
 * what the private runtime accepts: continuation lifetime is capped by
 * contract rather than configured, and the runtime's clock and correlation-id
 * seams stay internal, because a caller that replaced them would break expiry
 * classification and interaction correlation respectively.
 */
export type SupabaseElicitationOptions = {
  /**
   * Operator secret used to sign continuation state, at least 32 bytes. It
   * never reaches a client: state is signed and readable, not encrypted.
   */
  stateKey: string | Uint8Array;

  /** Authenticated approver every approval on this connection binds to. */
  actorId: string;

  /**
   * Whether the serving path in front of this server can deliver a form. A
   * path that cannot deliver one at all, such as deprecated stdio or classic
   * hosted, is better served by omitting these options entirely.
   */
  formDeliveryAvailable?: boolean;

  /**
   * Connection-level form elicitation opt-out.
   *
   * For a modern connection whose caller opted out, pass these options with
   * `optOut: true` rather than omitting them. Either way the tools stay on the
   * legacy `confirm_cost` contract, but passing them keeps continuation state
   * verified on this connection, so a flow that started before the opt-out
   * still gets an actionable answer, and keeps an operator opt-out
   * distinguishable from a client that never declared form support. Read the
   * hosted URL-only opt-out on the initial leg and pass the result here.
   */
  optOut?: boolean;

  /**
   * Kill switch consulted immediately before protected execution. Returning a
   * result blocks this attempt without invalidating signed state, so the same
   * confirmation is redeemable once the gate reopens. Tools without a cost
   * policy never reach it.
   */
  gate?: (
    ctx: ToolRequestContext
  ) => (CallToolResult & { isError: true }) | null;
};

const { version } = packageJson;

export type SupabaseMcpServerOptions = {
  /**
   * Platform implementation for Supabase.
   */
  platform: SupabasePlatform;

  /**
   * The API URL for the Supabase Content API.
   */
  contentApiUrl?: string;

  /**
   * The project ID to scope the server to.
   *
   * If undefined, the server will have access
   * to all organizations and projects for the user.
   */
  projectId?: string;

  /**
   * Executes database queries in read-only mode if true.
   */
  readOnly?: boolean;

  /**
   * Features to enable.
   * Options: 'account', 'branching', 'database', 'debugging', 'development', 'docs', 'functions', 'storage'
   */
  features?: string[];

  /**
   * Enables cost confirmation through form elicitation on this connection.
   *
   * Omit it for a serving path that cannot deliver a form at all, such as
   * deprecated stdio or classic hosted. Every tool then keeps the surface it
   * has today, policy-free and byte for byte. A read-only server keeps that
   * surface too, because it creates nothing to confirm.
   *
   * A connection whose caller opted out passes these options with
   * `optOut: true` rather than omitting them; see
   * {@link SupabaseElicitationOptions.optOut} for why.
   */
  elicitation?: SupabaseElicitationOptions;

  /**
   * Callback for each pre-execution policy decision, carrying the allowlisted
   * telemetry fields only.
   */
  onToolPolicyCall?: McpServerOptions['onToolPolicyCall'];

  /**
   * Callback for after a supabase tool is called.
   */
  onToolCall?: ToolCallCallback;
};

const DEFAULT_FEATURES: FeatureGroup[] = [
  'docs',
  'account',
  'database',
  'debugging',
  'development',
  'functions',
  'branching',
];

export const instructions = `
Here are guidelines for using Supabase tools effectively:

- Before making schema changes, inspect the existing tables so you understand the current structure
- When debugging issues, start by reading the project's logs and its security and performance advisories before making changes
- Look up the project's API URL and its publishable API keys when helping users configure client-side integrations

If you have access to a local development environment with a filesystem and shell:
- Install the Supabase agent skill for critical development and security guidance: \`npx skills add supabase/agent-skills\` (https://supabase.com/docs/guides/getting-started/ai-skills.md)
- Use the Supabase CLI (\`supabase\`) for local development workflows such as starting a local stack, managing migrations, and running edge functions locally (https://supabase.com/docs/guides/local-development.md)
- Prefer local development and testing before applying changes to a remote project

If you are running in a web-only or remote environment without filesystem or shell access:
- Rely on the MCP tools directly for all Supabase interactions
- Apply schema migrations carefully, as changes go directly to the remote project
`.trim();

/**
 * Creates an MCP server for interacting with Supabase.
 */
export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const {
    platform,
    projectId,
    readOnly,
    features,
    contentApiUrl = 'https://supabase.com/docs/api/graphql',
    onToolCall,
    onToolPolicyCall,
    elicitation: elicitationOptions,
  } = options;

  // One runtime per connection, and only when the consumer says this
  // connection serves form elicitation. Everything downstream keys off its
  // presence, so a consumer that injects nothing gets a policy-free server.
  const elicitation =
    elicitationOptions === undefined
      ? undefined
      : // Mapped field by field, never spread: a knob the private runtime
        // grows stays internal until this package decides to support it.
        createElicitationRuntime({
          actorId: elicitationOptions.actorId,
          stateKey: elicitationOptions.stateKey,
          formDeliveryAvailable: elicitationOptions.formDeliveryAvailable,
          optOut: elicitationOptions.optOut,
          gate: elicitationOptions.gate,
        });

  const contentApiClientPromise = createContentApiClient(contentApiUrl, {
    'User-Agent': `supabase-mcp/${version}`,
  });

  // Filter the default features based on the platform's capabilities
  const availableDefaultFeatures = DEFAULT_FEATURES.filter(
    (key) =>
      PLATFORM_INDEPENDENT_FEATURES.includes(key) ||
      Object.keys(platform).includes(key)
  );

  // Validate the desired features against the platform's available features
  const enabledFeatures = parseFeatureGroups(
    platform,
    features ?? availableDefaultFeatures
  );

  const server = createMcpServer({
    name: 'supabase',
    title: 'Supabase',
    version,
    instructions,
    async onInitialize(info) {
      // Note: in stateless HTTP mode, `onInitialize` will not always be called
      // so we cannot rely on it for initialization. It's still useful for telemetry.
      const { clientInfo } = info;
      const userAgent = `supabase-mcp/${version} (${clientInfo.name}/${clientInfo.version})`;

      await Promise.all([
        platform.init?.(info),
        contentApiClientPromise.then((client) =>
          client.setUserAgent(userAgent)
        ),
      ]);
    },
    requestState: elicitation?.requestState,
    onToolPolicyCall,
    onToolCall,
    tools: async () => {
      const contentApiClient = await contentApiClientPromise;
      const tools: Record<string, Tool> = {};

      const {
        account,
        database,
        functions,
        debugging,
        development,
        storage,
        branching,
      } = platform;

      if (enabledFeatures.has('docs')) {
        Object.assign(tools, getDocsTools({ contentApiClient }));
      }

      if (!projectId && account && enabledFeatures.has('account')) {
        Object.assign(
          tools,
          getAccountTools({ account, readOnly, elicitation })
        );
      }

      if (database && enabledFeatures.has('database')) {
        Object.assign(
          tools,
          getDatabaseTools({
            database,
            projectId,
            readOnly,
          })
        );
      }

      if (debugging && enabledFeatures.has('debugging')) {
        Object.assign(tools, getDebuggingTools({ debugging, projectId }));
      }

      if (development && enabledFeatures.has('development')) {
        Object.assign(tools, getDevelopmentTools({ development, projectId }));
      }

      if (functions && enabledFeatures.has('functions')) {
        Object.assign(
          tools,
          getEdgeFunctionTools({ functions, projectId, readOnly })
        );
      }

      if (branching && enabledFeatures.has('branching')) {
        Object.assign(
          tools,
          getBranchingTools({ branching, projectId, readOnly, elicitation })
        );
      }

      if (storage && enabledFeatures.has('storage')) {
        Object.assign(tools, getStorageTools({ storage, projectId, readOnly }));
      }

      if (readOnly) {
        for (const [name, tool] of Object.entries(tools)) {
          if (writeToolSet.has(name)) {
            tools[name] = { ...tool, hidden: true };
          }
        }
      }

      return tools;
    },
  });

  return server;
}
