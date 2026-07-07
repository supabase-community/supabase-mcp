import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, test } from 'vitest';
import { ACCESS_TOKEN, MCP_CLIENT_NAME, MCP_CLIENT_VERSION } from './mocks.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';

type SetupOptions = {
  accessToken?: string;
  projectId?: string;
  readOnly?: boolean;
};

async function setup(options: SetupOptions = {}) {
  const { accessToken = ACCESS_TOKEN, projectId, readOnly } = options;

  const client = new Client(
    {
      name: MCP_CLIENT_NAME,
      version: MCP_CLIENT_VERSION,
    },
    {
      capabilities: {},
    }
  );

  client.setNotificationHandler(LoggingMessageNotificationSchema, (message) => {
    const { level, data } = message.params;
    if (level === 'error') {
      console.error(data);
    } else {
      console.log(data);
    }
  });

  const command = 'node';
  const args = ['dist/transports/stdio.js'];

  if (accessToken) {
    args.push('--access-token', accessToken);
  }

  if (projectId) {
    args.push('--project-ref', projectId);
  }

  if (readOnly) {
    args.push('--read-only');
  }

  const clientTransport = new StdioClientTransport({
    command,
    args,
  });

  await client.connect(clientTransport);

  return { client, clientTransport };
}

describe('stdio', () => {
  test('server connects and lists tools', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
  });

  test('read-only mode filters mutating tools from tool list', async () => {
    const { client } = await setup({ readOnly: true });

    const { tools } = await client.listTools();
    const toolNames = new Set(tools.map((tool) => tool.name));

    expect(toolNames.has('apply_migration')).toBe(false);
    expect(toolNames.has('deploy_edge_function')).toBe(false);
    expect(toolNames.has('create_branch')).toBe(false);
    expect(toolNames.has('delete_branch')).toBe(false);

    expect(toolNames.has('list_tables')).toBe(true);
    expect(toolNames.has('execute_sql')).toBe(true);
  });

  test('missing access token fails', async () => {
    const setupPromise = setup({ accessToken: null as any });

    await expect(setupPromise).rejects.toThrow('MCP error -32000');
  });
});
