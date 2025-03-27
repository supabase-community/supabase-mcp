#!/usr/bin/env node

import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Server } from 'node:http';
import { createSupabaseMcpServer } from './server.js';

const port = process.env.PORT ? Number(process.env.PORT) : 8080;

async function main() {
  let transport: SSEServerTransport | undefined;

  const httpServer = new Server(async (req, res) => {
    switch (req.url) {
      case '/sse': {
        if (req.method !== 'GET') {
          res.writeHead(405);
          res.end();
          return;
        }

        const auth = req.headers['authorization'];

        const accessToken = auth?.replace('Bearer ', '');

        if (!accessToken) {
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }

        const server = createSupabaseMcpServer({
          platform: {
            accessToken,
          },
        });

        transport = new SSEServerTransport('/messages', res);

        await server.connect(transport);
        break;
      }
      case '/messages': {
        if (req.method !== 'POST') {
          res.writeHead(405);
          res.end();
          return;
        }
        if (transport) {
          transport.handlePostMessage(req, res);
        }
        break;
      }
      default:
        res.writeHead(404);
        res.end();
        return;
    }
  });

  httpServer.listen(port, () => {
    console.log(`Server is listening on port ${port}`);
  });
}

main().catch(console.error);
