import type { ServerContext } from '@modelcontextprotocol/server';
import {
  createMcpServer,
  type Tool,
  type ToolCallCallback,
} from '@supabase/mcp-utils';
import packageJson from '../package.json' with { type: 'json' };
import {
  createCostConfirmation,
  type CreationRate,
} from './cost-confirmation.js';
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
import type { FeatureGroup } from './types.js';
import { parseFeatureGroups } from './util.js';

const { version } = packageJson;
type HostedPolicyCallDetails = {
  name: string;
  decision: 'execute' | 'result' | 'rejected';
  clientInfo?: { name: string; version: string; title?: string };
  durationMs: number;
  telemetry: {
    policyId?: string;
    policyVersion?: number;
    outcome?: string;
    interactionId?: string;
    authorityPath?: string;
    reason?: string;
  };
};

type HostedElicitationOptions = {
  /** Shared SDK request-state HMAC key, at least 32 bytes. */
  key: string | Uint8Array;
  /** Binds request state to the authenticated actor and MCP method. */
  bind(ctx: ServerContext): string;
  /** Reads the authoritative project creation rate outside SupabasePlatform. */
  readProjectCreationRate(organizationId: string): Promise<CreationRate>;
  /** Reads the authoritative branch creation rate outside SupabasePlatform. */
  readBranchCreationRate(projectId: string): Promise<CreationRate>;
  /** Whether this serving path can deliver form input requests. */
  formDeliveryAvailable: boolean;
  /** Direct product kill switch, checked at proposal and redemption time. */
  enabled(): boolean;
  /** Connection-level form elicitation opt-out. */
  optOut?: boolean;
  /** Callback for each allowlisted cost-policy decision. */
  onToolPolicyCall?: (details: HostedPolicyCallDetails) => void | Promise<void>;
};
function assertHostedElicitationOptions(
  value: unknown
): asserts value is HostedElicitationOptions {
  if (value === null || typeof value !== 'object') {
    throw new TypeError('Hosted elicitation options must be an object.');
  }
  const options = value as Record<string, unknown>;
  for (const field of [
    'bind',
    'readProjectCreationRate',
    'readBranchCreationRate',
    'enabled',
  ]) {
    if (typeof options[field] !== 'function') {
      throw new TypeError(
        `Hosted elicitation option "${field}" must be a function.`
      );
    }
  }
  if (typeof options.formDeliveryAvailable !== 'boolean') {
    throw new TypeError(
      'Hosted elicitation option "formDeliveryAvailable" must be a boolean.'
    );
  }
}

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
   * Hosted cost-confirmation integration.
   *
   * Omit this block for classic, local, and stdio serving. When present, all
   * security dependencies are required: state integrity and actor/method
   * binding, authoritative rate readers, form delivery, and the kill switch.
   */
  elicitation?: HostedElicitationOptions;

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

export const PLATFORM_INDEPENDENT_FEATURES: FeatureGroup[] = ['docs'];

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
 * Creates an MCP server for Supabase.
 */
export function createSupabaseMcpServer(options: SupabaseMcpServerOptions) {
  const {
    platform,
    projectId,
    readOnly,
    features,
    contentApiUrl = 'https://supabase.com/docs/api/graphql',
    elicitation: elicitationOptions,
    onToolCall,
  } = options;
  if (elicitationOptions !== undefined) {
    assertHostedElicitationOptions(elicitationOptions);
  }
  const onToolPolicyCall = elicitationOptions?.onToolPolicyCall;

  const costConfirmation =
    elicitationOptions === undefined
      ? undefined
      : createCostConfirmation({
          key: elicitationOptions.key,
          bind: elicitationOptions.bind,
          formDeliveryAvailable: elicitationOptions.formDeliveryAvailable,
          optOut: elicitationOptions.optOut,
          enabled: () => elicitationOptions.enabled(),
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
    requestState: costConfirmation?.requestState,
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
          getAccountTools({
            account,
            readOnly,
            elicitation:
              costConfirmation === undefined || elicitationOptions === undefined
                ? undefined
                : {
                    costConfirmation,
                    readProjectCreationRate:
                      elicitationOptions.readProjectCreationRate,
                  },
          })
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
          getBranchingTools({
            branching,
            projectId,
            readOnly,
            elicitation:
              costConfirmation === undefined || elicitationOptions === undefined
                ? undefined
                : {
                    costConfirmation,
                    readBranchCreationRate:
                      elicitationOptions.readBranchCreationRate,
                  },
          })
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
