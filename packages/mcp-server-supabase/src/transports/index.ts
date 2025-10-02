#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseList } from './util.js';

const { version } = packageJson;

// AsyncLocalStorage for managing per-request state in HTTP mode
const asyncLocalStorage = new AsyncLocalStorage<{
  accessToken: string;
}>();

// Store SSE transports by session ID for the deprecated SSE protocol
const sseTransports: Record<string, SSEServerTransport> = {};

const DEFAULT_PORT = 3000;
const ALLOWED_TRANSPORTS = ['stdio', 'http'] as const;
type TransportType = (typeof ALLOWED_TRANSPORTS)[number];

/**
 * Extract client IP from request headers with fallback chain
 */
function getClientIp(req: IncomingMessage): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    return typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : forwarded[0];
  }

  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return typeof realIp === 'string' ? realIp : realIp[0];
  }

  return req.socket.remoteAddress;
}

/**
 * Extract authentication token from request headers
 */
function extractAuthToken(req: IncomingMessage): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const auth = typeof authHeader === 'string' ? authHeader : authHeader[0];
    // Remove 'Bearer ' prefix if present
    if (auth.startsWith('Bearer ')) {
      return auth.substring(7).trim();
    }
    return auth;
  }

  // Try alternative header names
  const xAuthToken =
    req.headers['x-auth-token'] || req.headers['x-access-token'];
  if (xAuthToken) {
    return typeof xAuthToken === 'string' ? xAuthToken : xAuthToken[0];
  }

  return undefined;
}

/**
 * Create a server instance for HTTP mode (stateless, per-request)
 */
function createHttpServerInstance(
  projectId?: string,
  readOnly?: boolean,
  features?: string[],
  apiUrl?: string
) {
  const store = asyncLocalStorage.getStore();
  if (!store) {
    throw new Error('Access token not found in AsyncLocalStorage');
  }

  const platform = createSupabaseApiPlatform({
    accessToken: store.accessToken,
    apiUrl,
  });

  return createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
  });
}

/**
 * Start HTTP server with both StreamableHTTP and SSE support
 */
async function startHttpServer(
  port: number,
  projectId?: string,
  readOnly?: boolean,
  features?: string[],
  apiUrl?: string
) {
  const httpServer: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      // Set CORS headers for all responses
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Auth-Token, X-Access-Token, MCP-Session-Id, MCP-Protocol-Version'
      );
      res.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id');

      // Handle preflight OPTIONS requests
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // Extract authentication token
      const accessToken = extractAuthToken(req);

      if (!accessToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message:
                'Missing authentication token. Provide via Authorization header or X-Auth-Token header.',
            },
            id: null,
          })
        );
        return;
      }

      // Get client IP for logging/analytics
      const clientIp = getClientIp(req);
      if (clientIp) {
        console.error(`Request from ${clientIp} to ${pathname}`);
      }

      //=============================================================================
      // STREAMABLE HTTP TRANSPORT (PROTOCOL VERSION 2025-03-26)
      //=============================================================================

      if (pathname === '/mcp' && req.method === 'POST') {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        // Create server inside AsyncLocalStorage context
        await asyncLocalStorage.run({ accessToken }, async () => {
          const server = createHttpServerInstance(
            projectId,
            readOnly,
            features,
            apiUrl
          );

          try {
            await server.connect(transport);

            // Parse request body for streamable HTTP
            let body = '';
            req.on('data', (chunk) => {
              body += chunk.toString();
            });

            await new Promise<void>((resolve, reject) => {
              req.on('end', async () => {
                try {
                  const requestBody = body ? JSON.parse(body) : undefined;
                  await transport.handleRequest(req, res, requestBody);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              });
              req.on('error', reject);
            });
          } catch (error) {
            console.error('Error handling MCP request:', error);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({
                  jsonrpc: '2.0',
                  error: {
                    code: -32603,
                    message: 'Internal server error',
                  },
                  id: null,
                })
              );
            }
          } finally {
            res.on('close', () => {
              transport.close();
              server.close();
            });
          }
        });

        return;
      }

      if (pathname === '/mcp' && req.method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Method not allowed. Use POST for MCP requests.',
            },
            id: null,
          })
        );
        return;
      }

      //=============================================================================
      // DEPRECATED HTTP+SSE TRANSPORT (PROTOCOL VERSION 2024-11-05)
      //=============================================================================

      if (pathname === '/sse' && req.method === 'GET') {
        console.warn(
          'Warning: SSE transport is deprecated. Please use the /mcp endpoint with StreamableHTTP transport.'
        );

        const transport = new SSEServerTransport('/messages', res);
        sseTransports[transport.sessionId] = transport;

        res.on('close', () => {
          delete sseTransports[transport.sessionId];
          transport.close();
        });

        await asyncLocalStorage.run({ accessToken }, async () => {
          const server = createHttpServerInstance(
            projectId,
            readOnly,
            features,
            apiUrl
          );

          await server.connect(transport);
        });

        return;
      }

      if (pathname === '/messages' && req.method === 'POST') {
        const sessionId = url.searchParams.get('sessionId');

        if (!sessionId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'Missing sessionId parameter',
            })
          );
          return;
        }

        const transport = sseTransports[sessionId];

        if (!transport) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: `No transport found for sessionId: ${sessionId}`,
            })
          );
          return;
        }

        await asyncLocalStorage.run({ accessToken }, async () => {
          await transport.handlePostMessage(req, res);
        });

        return;
      }

      //=============================================================================
      // HEALTH CHECK & INFO ENDPOINTS
      //=============================================================================

      if (pathname === '/health' || pathname === '/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            version,
            message: 'Supabase MCP Server',
          })
        );
        return;
      }

      // 404 for unknown routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'Not found',
          availableEndpoints: [
            'POST /mcp - StreamableHTTP transport (recommended)',
            'GET /sse - SSE transport (deprecated)',
            'POST /messages?sessionId=... - SSE message handler',
            'GET /health - Health check',
          ],
        })
      );
    } catch (error) {
      console.error('Unhandled error in request handler:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          })
        );
      }
    }
  });

  // Start server with port fallback
  function startServer(attemptPort: number, maxAttempts = 10): void {
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attemptPort < port + maxAttempts) {
        console.warn(
          `Port ${attemptPort} is in use, trying port ${attemptPort + 1}...`
        );
        startServer(attemptPort + 1, maxAttempts);
      } else {
        console.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    });

    httpServer.listen(attemptPort, () => {
      console.error(`Supabase MCP Server v${version} running on HTTP`);
      console.error(`  - StreamableHTTP: http://localhost:${attemptPort}/mcp`);
      console.error(
        `  - SSE (deprecated): http://localhost:${attemptPort}/sse`
      );
      console.error(
        `  - Health check: http://localhost:${attemptPort}/health`
      );
      console.error('');
      console.error('Authentication: Provide Supabase access token via:');
      console.error('  - Authorization: Bearer <token>');
      console.error('  - X-Auth-Token: <token>');
    });
  }

  startServer(port);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.error('\nShutting down server...');
    httpServer.close(() => {
      console.error('Server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.error('\nShutting down server...');
    httpServer.close(() => {
      console.error('Server closed');
      process.exit(0);
    });
  });
}

/**
 * Start STDIO server (stateful, single connection)
 */
async function startStdioServer(
  accessToken: string,
  projectId?: string,
  readOnly?: boolean,
  features?: string[],
  apiUrl?: string
) {
  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl,
  });

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('Supabase MCP Server running on STDIO');
}

async function main() {
  const {
    values: {
      ['access-token']: cliAccessToken,
      ['project-ref']: projectId,
      ['read-only']: readOnly,
      ['api-url']: apiUrl,
      ['transport']: cliTransport,
      ['port']: portArg,
      ['version']: showVersion,
      ['features']: cliFeatures,
      ['help']: showHelp,
    },
  } = parseArgs({
    options: {
      ['access-token']: {
        type: 'string',
      },
      ['project-ref']: {
        type: 'string',
      },
      ['read-only']: {
        type: 'boolean',
        default: false,
      },
      ['api-url']: {
        type: 'string',
      },
      ['transport']: {
        type: 'string',
      },
      ['port']: {
        type: 'string',
      },
      ['version']: {
        type: 'boolean',
      },
      ['features']: {
        type: 'string',
      },
      ['help']: {
        type: 'boolean',
      },
    },
  });

  if (showHelp) {
    console.log(`
Supabase MCP Server v${version}

Usage:
  mcp-server-supabase [options]

Options:
  --transport <stdio|http>    Transport type (default: stdio)
  --port <number>             Port for HTTP transport (default: 3000)
  --access-token <token>      Supabase access token (required for stdio, env: SUPABASE_ACCESS_TOKEN)
  --project-ref <id>          Project reference ID to scope to specific project
  --read-only                 Run in read-only mode (default: false)
  --api-url <url>             Custom Supabase API URL
  --features <list>           Comma-separated list of features to enable
  --version                   Show version
  --help                      Show this help

Transport Modes:
  stdio   - Standard I/O transport (default, stateful, single connection)
            Requires --access-token or SUPABASE_ACCESS_TOKEN env var
            
  http    - HTTP server transport (stateless, multiple concurrent connections)
            Authentication via headers: Authorization: Bearer <token> or X-Auth-Token: <token>
            Endpoints:
              - POST /mcp - StreamableHTTP transport (recommended)
              - GET /sse - SSE transport (deprecated)
              - GET /health - Health check

Examples:
  # STDIO mode (for MCP clients like Claude Desktop, Cursor)
  mcp-server-supabase --access-token <token>
  
  # HTTP mode (for hosting/scaling, web clients)
  mcp-server-supabase --transport http --port 3000
  
  # HTTP mode with specific project
  mcp-server-supabase --transport http --port 3000 --project-ref <project-id>
  
  # HTTP mode with specific features
  mcp-server-supabase --transport http --features "database,functions,debugging"

Environment Variables:
  SUPABASE_ACCESS_TOKEN   Access token for STDIO mode
`);
    process.exit(0);
  }

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  // Parse transport type
  const transport: TransportType =
    (cliTransport as TransportType) || 'stdio';

  if (!ALLOWED_TRANSPORTS.includes(transport)) {
    console.error(
      `Invalid transport: ${cliTransport}. Must be one of: ${ALLOWED_TRANSPORTS.join(', ')}`
    );
    process.exit(1);
  }

  // Parse features
  const features = cliFeatures ? parseList(cliFeatures) : undefined;

  // Parse port
  const port = portArg ? parseInt(portArg, 10) : DEFAULT_PORT;
  if (isNaN(port)) {
    console.error(`Invalid port: ${portArg}`);
    process.exit(1);
  }

  // Validate flags based on transport
  if (transport === 'stdio' && portArg) {
    console.error('--port flag is not allowed with --transport stdio');
    process.exit(1);
  }

  if (transport === 'http' && cliAccessToken) {
    console.error(
      '--access-token flag is not allowed with --transport http. Use header-based authentication instead.'
    );
    process.exit(1);
  }

  // Start server based on transport type
  if (transport === 'http') {
    await startHttpServer(port, projectId, readOnly, features, apiUrl);
  } else {
    // STDIO mode
    const accessToken = cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN;

    if (!accessToken) {
      console.error(
        'Please provide a personal access token (PAT) with the --access-token flag or set the SUPABASE_ACCESS_TOKEN environment variable'
      );
      process.exit(1);
    }

    await startStdioServer(accessToken, projectId, readOnly, features, apiUrl);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
