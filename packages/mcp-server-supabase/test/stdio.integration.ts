import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { describe, expect, test } from 'vitest';
import { ACCESS_TOKEN, MCP_CLIENT_NAME, MCP_CLIENT_VERSION } from './mocks.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawnSync } from 'node:child_process';

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
  test('prints help without starting the server', () => {
    for (const flag of ['--help', '-h']) {
      const result = spawnSync(
        process.execPath,
        ['dist/transports/stdio.js', flag],
        {
          encoding: 'utf8',
        }
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Usage: mcp-server-supabase');
      expect(result.stdout).toContain('--access-token');
      expect(result.stdout).toContain('--version');
      expect(result.stderr).toBe('');
    }
  });

  test('prints a concise error for unknown flags', () => {
    const result = spawnSync(
      process.execPath,
      ['dist/transports/stdio.js', '--definitely-not-a-real-flag'],
      {
        encoding: 'utf8',
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      "Unknown option '--definitely-not-a-real-flag'"
    );
    expect(result.stderr).not.toContain('ERR_PARSE_ARGS_UNKNOWN_OPTION');
  });

  test('server connects and lists tools', async () => {
    const { client } = await setup();

    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThan(0);
  });

  test('missing access token fails', async () => {
    const setupPromise = setup({ accessToken: null as any });

    await expect(setupPromise).rejects.toThrow('MCP error -32000');
  });
});
