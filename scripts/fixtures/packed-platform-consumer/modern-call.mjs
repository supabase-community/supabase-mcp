import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import * as packageExports from '@supabase/mcp-server-supabase';
import { createSupabaseMcpHandler } from '@supabase/mcp-server-supabase';

// https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
const MODERN_PROTOCOL_VERSION = '2026-07-28';

// Stubbed `account` operations, real where this exchange needs them: the
// account feature registers real zod-built schemas, and the checks below drive
// a confirmed creation through them with Platform's zod pin. `docs` stays out:
// its tool description lazily calls supabase.com, and this exchange must never
// leave the process.
const notImplemented = () => Promise.reject(new Error('not implemented'));

const FIXED_PROJECT = {
  id: 'packed-fixture-ref',
  ref: 'packed-fixture-ref',
  organization_id: 'packed-fixture-org',
  organization_slug: 'packed-fixture-org',
  name: 'Packed Fixture',
  status: 'UNKNOWN',
  created_at: '2026-01-01T00:00:00.000Z',
  region: 'us-east-1',
};

const handler = createSupabaseMcpHandler({
  platform: {
    account: {
      listOrganizations: notImplemented,
      getOrganization: notImplemented,
      listProjects: notImplemented,
      getProject: notImplemented,
      createProject: async () => FIXED_PROJECT,
      pauseProject: notImplemented,
      restoreProject: notImplemented,
      getProjectCreationRate: async () => ({
        amount: 10,
        currency: 'USD',
        recurrence: 'monthly',
      }),
    },
  },
  features: ['account'],
  // The dependencies a hosted modern route injects.
  elicitation: {
    actorId: 'packed-fixture-approver',
    stateKey: 'a-platform-managed-state-key-long-enough',
    formDeliveryAvailable: true,
  },
});

const transport = new StreamableHTTPClientTransport(
  new URL('http://packed-platform-consumer-fixture.invalid/mcp'),
  {
    // Routes every request straight into the handler's fetch face in-process.
    fetch: (url, init) => handler.fetch(new Request(url, init)),
  }
);

const client = new Client(
  { name: 'packed-platform-consumer-fixture', version: '0.0.0' },
  {
    capabilities: { elicitation: {} },
    versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
  }
);

let elicitations = 0;
client.setRequestHandler('elicitation/create', async (request) => {
  elicitations += 1;
  const { message, requestedSchema } = request.params;

  if (typeof message !== 'string' || !message.includes('10 USD')) {
    throw new Error(`confirmation message lost its rate: ${message}`);
  }
  if (Object.keys(requestedSchema?.properties ?? {}).length > 0) {
    throw new Error(
      `confirmation asked for properties: ${JSON.stringify(requestedSchema)}`
    );
  }

  return { action: 'accept' };
});

await client.connect(transport);
const { tools } = await client.listTools();

// The no-argument witness proves that list_projects and its input schema are
// present. The parameterized create_project witness below proves that the
// zod-built schema keeps its required inputs across the dependency boundary.
const listProjects = tools.find((tool) => tool.name === 'list_projects');

if (!listProjects?.inputSchema) {
  throw new Error(
    `tools/list did not return list_projects with an input schema (got: ${JSON.stringify(tools.map((tool) => tool.name))})`
  );
}

const createProject = tools.find((tool) => tool.name === 'create_project');

if (!createProject?.inputSchema?.properties) {
  throw new Error(
    `tools/list did not return create_project with input schema properties (got: ${JSON.stringify(tools.map((tool) => tool.name))})`
  );
}

const requiredCreateProjectProperties = ['name', 'region', 'organization_id'];
const createProjectProperties = Object.keys(
  createProject.inputSchema.properties
);
const missingCreateProjectProperties = requiredCreateProjectProperties.filter(
  (property) => !createProjectProperties.includes(property)
);

if (missingCreateProjectProperties.length > 0) {
  throw new Error(
    `create_project input schema is missing required properties: ${missingCreateProjectProperties.join(', ')} (got: ${JSON.stringify(createProjectProperties)})`
  );
}

// The legacy confirmation surface is gone for a capable client, and the
// confirmation happens inside the creation call instead.
if (tools.some((tool) => tool.name === 'confirm_cost')) {
  throw new Error('a form-capable client was offered confirm_cost');
}
if (createProjectProperties.includes('confirm_cost_id')) {
  throw new Error('a form-capable client was offered confirm_cost_id');
}

const created = await client.callTool({
  name: 'create_project',
  arguments: {
    name: 'Packed Fixture',
    region: 'us-east-1',
    organization_id: 'packed-fixture-org',
  },
});

if (elicitations !== 1) {
  throw new Error(`expected exactly one confirmation, saw ${elicitations}`);
}
if (created.structuredContent?.ref !== FIXED_PROJECT.ref) {
  throw new Error(
    `confirmed creation lost its business output: ${JSON.stringify(created)}`
  );
}

// The package entry point is a value-level allowlist. Any new value export,
// regardless of its name, is a public API change that this fixture must catch.
const allowedValueExports = new Set([
  'CURRENT_FEATURE_GROUPS',
  'createSupabaseMcpHandler',
  'createSupabaseMcpServer',
  'createToolSchemas',
  'supabaseMcpToolSchemas',
  'version',
]);
const actualValueExports = Object.keys(packageExports);
const unexpectedValueExports = actualValueExports.filter(
  (name) => !allowedValueExports.has(name)
);
const missingValueExports = [...allowedValueExports].filter(
  (name) => !actualValueExports.includes(name)
);

if (unexpectedValueExports.length > 0 || missingValueExports.length > 0) {
  throw new Error(
    `package entry point value exports changed: unexpected=${JSON.stringify(unexpectedValueExports)} missing=${JSON.stringify(missingValueExports)}`
  );
}

await client.close();
await handler.close();

console.log(`MODERN_CALL_OK tools=${tools.length}`);
