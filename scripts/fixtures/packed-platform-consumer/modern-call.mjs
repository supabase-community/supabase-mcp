import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { createSupabaseMcpHandler } from '@supabase/mcp-server-supabase';

// https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
const MODERN_PROTOCOL_VERSION = '2026-07-28';

// Stubbed `account` operations only run on a tool call. The account feature
// registers real zod-built schemas, and the tools/list checks below verify
// that create_project keeps its required properties with Platform's zod pin.
// `docs` stays out: its tool description lazily calls supabase.com, and this
// exchange must never leave the process.
const notImplemented = () => Promise.reject(new Error('not implemented'));

const handler = createSupabaseMcpHandler({
  platform: {
    account: {
      listOrganizations: notImplemented,
      getOrganization: notImplemented,
      listProjects: notImplemented,
      getProject: notImplemented,
      createProject: notImplemented,
      pauseProject: notImplemented,
      restoreProject: notImplemented,
    },
  },
  features: ['account'],
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
  { versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } } }
);

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

await client.close();
await handler.close();

console.log(`MODERN_CALL_OK tools=${tools.length}`);
