import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';

import { createManagementProjectCreator } from './management.js';
import { createPoc, InMemoryJtiStore } from './server.js';
import { createUrlPoc } from './url-server.js';

const managementApiUrl = process.env.MANAGEMENT_API_URL;
const managementApiToken = process.env.MANAGEMENT_API_TOKEN;

if (managementApiUrl && !managementApiToken) {
  console.error(
    'MANAGEMENT_API_TOKEN is required when MANAGEMENT_API_URL is set'
  );
  process.exit(1);
}

if (!managementApiUrl && managementApiToken) {
  console.error(
    'MANAGEMENT_API_URL is required when MANAGEMENT_API_TOKEN is set'
  );
  process.exit(1);
}

if (managementApiUrl && managementApiToken) {
  let hostname: string;
  let protocol: string;
  try {
    const url = new URL(managementApiUrl);
    hostname = url.hostname;
    protocol = url.protocol;
  } catch {
    console.error(
      `Refusing Management API URL with invalid host: ${managementApiUrl}`
    );
    process.exit(1);
  }

  if (protocol !== 'https:') {
    console.error(`Refusing Management API protocol: ${protocol}`);
    process.exit(1);
  }

  if (hostname !== 'supabase.green' && !hostname.endsWith('.supabase.green')) {
    console.error(`Refusing Management API host: ${hostname}`);
    process.exit(1);
  }
}

const projectCreator =
  managementApiUrl && managementApiToken
    ? createManagementProjectCreator({
        baseUrl: managementApiUrl,
        token: managementApiToken,
        region: process.env.MANAGEMENT_API_REGION,
      })
    : undefined;

if (projectCreator) {
  console.log(
    `Real Management API project creation ENABLED against ${managementApiUrl}; single-use enforcement ENABLED (in-memory, single instance)`
  );
} else {
  console.log(
    'Project creation: MOCK (in-memory registry; set MANAGEMENT_API_URL + MANAGEMENT_API_TOKEN for staging)'
  );
}

const { handler } = createPoc({
  projectCreator,
  jtiStore: projectCreator ? new InMemoryJtiStore() : undefined,
});
const server = createServer(toNodeHandler(handler));

server.listen(3900, () => {
  console.log('MCP Elicitations PoC listening on http://localhost:3900/mcp');
});

const urlPoc = createUrlPoc();
const urlMcpServer = createServer(toNodeHandler(urlPoc.handler));
const connectServer = createServer(toNodeHandler(urlPoc.connect));

urlMcpServer.listen(3902, () => {
  console.log('URL-mode MCP PoC listening on http://localhost:3902/mcp');
});

connectServer.listen(3901, () => {
  console.log('Mock connect page listening on http://localhost:3901/connect');
});
