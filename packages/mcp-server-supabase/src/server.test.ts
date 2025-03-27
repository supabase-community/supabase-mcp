import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamTransport } from '@supabase/mcp-utils';
import { describe } from 'vitest';
import { createSupabaseMcpServer } from './server.js';

/**
 * Sets up a client and server for testing.
 */
async function setup() {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  const client = new Client(
    {
      name: 'TestClient',
      version: '0.1.0',
    },
    {
      capabilities: {},
    }
  );

  const server = createSupabaseMcpServer({
    platform: {
      accessToken: 'test',
    },
  });

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, clientTransport, server, serverTransport };
}

describe('tools', () => {});
