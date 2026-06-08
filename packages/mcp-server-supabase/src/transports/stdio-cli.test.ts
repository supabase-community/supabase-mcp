import { afterEach, describe, expect, test, vi } from 'vitest';
import packageJson from '../../package.json' with { type: 'json' };
import { parseStdioCliArgs } from './stdio-cli.js';

describe('parseStdioCliArgs', () => {
  const originalAccessToken = process.env.SUPABASE_ACCESS_TOKEN;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (originalAccessToken === undefined) {
      delete process.env.SUPABASE_ACCESS_TOKEN;
    } else {
      process.env.SUPABASE_ACCESS_TOKEN = originalAccessToken;
    }
  });

  test.each([['--help'], ['-h']])('prints help for %s', (arg) => {
    expect(parseStdioCliArgs([arg])).toEqual({
      type: 'exit',
      code: 0,
      output: expect.stringContaining('Usage: mcp-server-supabase'),
      stream: 'stdout',
    });
  });

  test('prints version', () => {
    expect(parseStdioCliArgs(['--version'])).toEqual({
      type: 'exit',
      code: 0,
      output: `${packageJson.version}\n`,
      stream: 'stdout',
    });
  });

  test('normalizes unknown option errors', () => {
    expect(parseStdioCliArgs(['--definitely-not-real'])).toEqual({
      type: 'exit',
      code: 1,
      output: expect.stringContaining("Unknown option '--definitely-not-real'"),
      stream: 'stderr',
    });
  });

  test('parses server startup options', () => {
    expect(
      parseStdioCliArgs([
        '--access-token',
        'token-from-cli',
        '--project-ref',
        'project-ref',
        '--read-only',
        '--api-url',
        'https://api.example.test',
        '--features',
        'database,docs',
      ])
    ).toEqual({
      type: 'run',
      options: {
        accessToken: 'token-from-cli',
        projectId: 'project-ref',
        readOnly: true,
        apiUrl: 'https://api.example.test',
        features: ['database', 'docs'],
      },
    });
  });

  test('falls back to SUPABASE_ACCESS_TOKEN', () => {
    vi.stubEnv('SUPABASE_ACCESS_TOKEN', 'token-from-env');

    expect(parseStdioCliArgs([])).toEqual({
      type: 'run',
      options: {
        accessToken: 'token-from-env',
        projectId: undefined,
        readOnly: false,
        apiUrl: undefined,
        features: undefined,
      },
    });
  });
});
