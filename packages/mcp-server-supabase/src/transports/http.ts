import { Hono } from 'hono';
import { createSupabaseMcpServer } from '../server.js';
import { StatelessHttpServerTransport } from '@supabase/mcp-utils';
import { serve } from '@hono/node-server';

const app = new Hono();

/**
 * Stateless HTTP transport for the Supabase MCP server.
 */
app.all('/mcp', async (c) => {
  const projectId = c.req.query('project-ref');
  const readOnly = c.req.query('read-only') === 'true';
  const apiUrl = c.req.query('api-url');

  console.log('User agent:', c.req.header('User-Agent'));

  const accessToken =
    c.req.header('Authorization')?.replace('Bearer ', '') ||
    c.req.query('access-token');
  if (!accessToken) {
    console.error(
      'Please provide a personal access token (PAT) in the Authorization header'
    );
    return c.text('Access token is required', 401);
  }

  const server = createSupabaseMcpServer({
    platform: {
      accessToken,
      apiUrl,
    },
    projectId,
    readOnly,
  });

  const transport = new StatelessHttpServerTransport();
  await server.connect(transport);
  return await transport.handleRequest(c.req.raw);
});

serve({
  fetch: app.fetch,
  port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
});
