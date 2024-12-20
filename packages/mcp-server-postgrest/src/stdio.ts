import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import PostgrestMcpServer from './server.js';

async function main() {
  const {
    values: { baseUrl },
  } = parseArgs({
    options: {
      baseUrl: {
        type: 'string',
      },
    },
  });

  if (!baseUrl) {
    console.error('Please provide a base URL with the --baseUrl flag');
    process.exit(1);
  }

  const server = new PostgrestMcpServer(baseUrl);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
