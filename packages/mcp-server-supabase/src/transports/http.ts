#!/usr/bin/env node

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseList } from './util.js';

const { version } = packageJson;

// AsyncLocalStorage for managing per-request state
export const asyncLocalStorage = new AsyncLocalStorage<{
  accessToken: string;
}>();

const DEFAULT_PORT = 3000;

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
  const xAuthToken = req.headers['x-auth-token'] || req.headers['x-access-token'];
  if (xAuthToken) {
    return typeof xAuthToken === 'string' ? xAuthToken : xAuthToken[0];
  }
  
  return undefined;
}

/**
 * Create a server instance for a request
 */
function createServerInstance(
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

async function main() {
  const {
    values: {
      ['project-ref']: projectId,
      ['read-only']: readOnly,
      ['api-url']: apiUrl,
      ['port']: portArg,
      ['version']: showVersion,
      ['features']: cliFeatures,
    },
  } = parseArgs({
    options: {
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
      ['port']: {
        type: 'string',
      },
      ['version']: {
        type: 'boolean',
      },
      ['features']: {
        type: 'string',
      },
    },
  });

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  const features = cliFeatures ? parseList(cliFeatures) : undefined;
  const port = portArg ? parseInt(portArg, 10) : DEFAULT_PORT;

  if (isNaN(port)) {
    console.error(`Invalid port: ${portArg}`);
    process.exit(1);
  }

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
              message: 'Missing authentication token. Provide via Authorization header or X-Auth-Token header.',
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
      // STREAMABLE HTTP TRANSPORT
      //=============================================================================
      
      if (pathname === '/mcp' && req.method === 'POST') {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });
        
        // Create server inside AsyncLocalStorage context
        await asyncLocalStorage.run({ accessToken }, async () => {
          const server = createServerInstance(
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
        console.warn(`Port ${attemptPort} is in use, trying port ${attemptPort + 1}...`);
        startServer(attemptPort + 1, maxAttempts);
      } else {
        console.error(`Failed to start server: ${err.message}`);
        process.exit(1);
      }
    });

    httpServer.listen(attemptPort, () => {
      console.error(`Supabase MCP Server v${version} running on HTTP`);
      console.error(`  - StreamableHTTP: http://localhost:${attemptPort}/mcp`);
      console.error(`  - Health check: http://localhost:${attemptPort}/health`);
      console.error('');
      console.error('Authentication: Provide Supabase access token via:');
      console.error('  - Authorization: Bearer <token>');
      console.error('  - X-Auth-Token: <token>');
    });
  }

  startServer(port);

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

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
