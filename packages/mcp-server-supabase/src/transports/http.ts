import { Hono } from 'hono';
import axios from 'axios';
import { createSupabaseMcpServer } from '../server.js';
import { StatelessHttpServerTransport } from '@supabase/mcp-utils';
import { serve } from '@hono/node-server';
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { cors } from 'hono/cors';

const managementApiUrl =
  process.env.SUPABASE_API_URL ?? 'https://api.supabase.com';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

const app = new Hono();

//
app.use(
  cors({
    origin: ['dev', 'test'].includes((process.env.ENV ?? '').toLowerCase())
      ? '*'
      : 'https://api.supabase.io/mcp',
  })
);

/**
 * Stateless HTTP transport for the Supabase MCP server.
 */
app.post('/mcp', async (c) => {
  const projectId = c.req.query('project-ref');
  const readOnly = c.req.query('read-only') === 'true';
  const apiUrl = c.req.query('api-url');

  const accessToken = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) in the Authorization header'
    );
    return c.json({ error: 'Access token is required' }, 401);
  }

  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
  });

  const transport = new StatelessHttpServerTransport();
  await server.connect(transport);
  return await transport.handleRequest(c.req.raw);
});

// SSE notifications not supported in stateless mode
app.get('/mcp', async (c) => {
  console.log('Received GET MCP request');
  c.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    },
    405
  );
});

// Session termination not needed in stateless mode
app.delete('/mcp', async (c) => {
  console.log('Received DELETE MCP request');
  c.json(
    {
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    },
    405
  );
});

const fetchOauthMetadata = async () => {
  const response = await axios.get(
    `${managementApiUrl}/.well-known/oauth-authorization-server`
  );
  if (response.status != 200) {
    throw new Error('Failed to fetch OAuth metadata');
  }

  return response.data;
};

const oauthMetadata = await fetchOauthMetadata();

const protectedResourceMetadata = {
  resource: `http://localhost:${port}`, // "https://api.supabase.io/mcp",
  authorization_servers: [oauthMetadata.issuer],
  scopes_supported: oauthMetadata.scopes_supported,
};
app.get('/.well-known/oauth-protected-resource', (c) =>
  c.json(protectedResourceMetadata)
);
app.get('/.well-known/oauth-authorization-server', (c) =>
  c.json(oauthMetadata)
);

serve(
  {
    fetch: app.fetch,
    port: port,
  },
  () => {
    console.log('Server is running on port', port);
  }
);
