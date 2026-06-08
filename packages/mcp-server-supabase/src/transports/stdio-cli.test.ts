import { describe, expect, test } from 'vitest';
import { parseStdioCliArgs } from './stdio-cli.js';

describe('parseStdioCliArgs', () => {
  test('prints help without starting the server', () => {
    const result = parseStdioCliArgs(['--help'], '0.8.2');

    expect(result.action).toBe('exit');
    if (result.action !== 'exit') {
      throw new Error('Expected CLI parsing to exit');
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: mcp-server-supabase [options]');
    expect(result.stdout).toContain('--access-token');
    expect(result.stderr).toBeUndefined();
  });

  test('prints help for the short help flag', () => {
    const result = parseStdioCliArgs(['-h'], '0.8.2');

    expect(result.action).toBe('exit');
    if (result.action !== 'exit') {
      throw new Error('Expected CLI parsing to exit');
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: mcp-server-supabase [options]');
  });

  test('prints the package version', () => {
    const result = parseStdioCliArgs(['--version'], '0.8.2');

    expect(result).toEqual({
      action: 'exit',
      exitCode: 0,
      stdout: '0.8.2\n',
    });
  });

  test('prints the package version for the short version flag', () => {
    const result = parseStdioCliArgs(['-v'], '0.8.2');

    expect(result).toEqual({
      action: 'exit',
      exitCode: 0,
      stdout: '0.8.2\n',
    });
  });

  test('prints a concise error for unknown flags', () => {
    const result = parseStdioCliArgs(['--definitely-not-a-real-flag'], '0.8.2');

    expect(result.action).toBe('exit');
    if (result.action !== 'exit') {
      throw new Error('Expected CLI parsing to exit');
    }
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(
      "Unknown option '--definitely-not-a-real-flag'"
    );
    expect(result.stderr).not.toContain('TypeError');
    expect(result.stderr).not.toContain('ERR_PARSE_ARGS_UNKNOWN_OPTION');
  });
});
