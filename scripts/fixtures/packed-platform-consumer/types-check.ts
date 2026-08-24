import {
  createSupabaseMcpHandler,
  type SupabaseElicitationOptions,
  type SupabaseMcpServerOptions,
} from '@supabase/mcp-server-supabase';

// The supported hosted-injection surface, pinned exactly. A private runtime
// knob reaching the packed declarations (a clock, a correlation-id seam, a
// configurable lifetime) fails here rather than in a hosted deployment.
type HostedInjectionKeys =
  | 'stateKey'
  | 'actorId'
  | 'formDeliveryAvailable'
  | 'optOut'
  | 'gate';

type Exactly<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : { unexpected: Exclude<Actual, Expected> }
  : { missing: Exclude<Expected, Actual> };

const elicitationKeysArePinned: Exactly<
  keyof SupabaseElicitationOptions,
  HostedInjectionKeys
> = true;
void elicitationKeysArePinned;

// A stubbed `account` platform, whose operations only ever run on a tool call
// and so can reject here. It buys the thing that matters: asking for the
// `account` feature group makes the server register real tools, so the
// typecheck covers the zod-backed tool surface rather than an empty one.
const account: SupabaseMcpServerOptions['platform']['account'] = {
  listOrganizations: () => Promise.reject(new Error('not implemented')),
  getOrganization: () => Promise.reject(new Error('not implemented')),
  listProjects: () => Promise.reject(new Error('not implemented')),
  getProject: () => Promise.reject(new Error('not implemented')),
  createProject: () => Promise.reject(new Error('not implemented')),
  pauseProject: () => Promise.reject(new Error('not implemented')),
  restoreProject: () => Promise.reject(new Error('not implemented')),
  getProjectCreationRate: () => Promise.reject(new Error('not implemented')),
};

const options: SupabaseMcpServerOptions = {
  platform: { account },
  features: ['account'],
  // Exactly what a hosted modern route injects. If any of it stops being
  // consumable from the packed artifact, this typecheck fails rather than a
  // deployment.
  elicitation: {
    actorId: 'auth-grant-id',
    stateKey: 'a-platform-managed-state-key-long-enough',
    formDeliveryAvailable: true,
    optOut: false,
    gate: () => null,
  },
  onToolPolicyCall: ({ name, decision, telemetry }) => {
    void name;
    void decision;
    void telemetry.interactionId;
    void telemetry.outcome;
  },
};

const handler = createSupabaseMcpHandler(options);

// Touch every member of the public McpHttpHandler shape so a signature
// change here fails the typecheck, not just a missing export.
void handler.fetch;
void handler.close;
void handler.notify;
void handler.bus;
