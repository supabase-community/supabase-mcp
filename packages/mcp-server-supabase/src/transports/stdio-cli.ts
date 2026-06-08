import { parseArgs } from 'node:util';

export type StdioCliResult =
  | {
      action: 'start';
      apiUrl?: string;
      cliAccessToken?: string;
      cliFeatures?: string;
      projectId?: string;
      readOnly: boolean;
    }
  | {
      action: 'exit';
      exitCode: number;
      stderr?: string;
      stdout?: string;
    };

const helpText = `Usage: mcp-server-supabase [options]

Options:
  --access-token <token>  Supabase personal access token
  --project-ref <ref>     Supabase project reference
  --read-only             Restrict the server to read-only tools
  --api-url <url>         Supabase Management API URL
  --features <list>       Comma-separated feature list
  -v, --version           Print the package version
  -h, --help              Display help for command
`;

export function parseStdioCliArgs(
  args: string[],
  version: string
): StdioCliResult {
  try {
    const {
      values: {
        ['access-token']: cliAccessToken,
        ['project-ref']: projectId,
        ['read-only']: readOnly,
        ['api-url']: apiUrl,
        ['version']: showVersion,
        ['features']: cliFeatures,
        ['help']: showHelp,
      },
    } = parseArgs({
      args,
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
        ['version']: {
          type: 'boolean',
          short: 'v',
        },
        ['features']: {
          type: 'string',
        },
        ['help']: {
          type: 'boolean',
          short: 'h',
        },
      },
    });

    if (showHelp) {
      return {
        action: 'exit',
        exitCode: 0,
        stdout: helpText,
      };
    }

    if (showVersion) {
      return {
        action: 'exit',
        exitCode: 0,
        stdout: `${version}\n`,
      };
    }

    return {
      action: 'start',
      apiUrl,
      cliAccessToken,
      cliFeatures,
      projectId,
      readOnly: readOnly ?? false,
    };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ) {
      return {
        action: 'exit',
        exitCode: 1,
        stderr: `${error.message}\n`,
      };
    }

    throw error;
  }
}
