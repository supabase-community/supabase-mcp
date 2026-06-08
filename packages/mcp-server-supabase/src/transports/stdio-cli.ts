import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import { parseList } from './util.js';

const { version } = packageJson;

const helpText = `Usage: mcp-server-supabase [options]

Options:
  --access-token <token>  Supabase personal access token
  --project-ref <ref>     Supabase project ref
  --read-only             Disable write tools
  --api-url <url>         Supabase management API URL
  --features <features>   Comma-separated feature groups to enable
  --version               Print version
  -h, --help              Print help
`;

type CliResult =
  | { type: 'run'; options: StdioCliOptions }
  | { type: 'exit'; code: number; output: string; stream: 'stdout' | 'stderr' };

export type StdioCliOptions = {
  accessToken?: string;
  projectId?: string;
  readOnly: boolean;
  apiUrl?: string;
  features?: string[];
};

export function parseStdioCliArgs(args = process.argv.slice(2)): CliResult {
  try {
    const {
      values: {
        ['access-token']: cliAccessToken,
        ['project-ref']: projectId,
        ['read-only']: readOnly = false,
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
      return { type: 'exit', code: 0, output: helpText, stream: 'stdout' };
    }

    if (showVersion) {
      return {
        type: 'exit',
        code: 0,
        output: `${version}\n`,
        stream: 'stdout',
      };
    }

    return {
      type: 'run',
      options: {
        accessToken: cliAccessToken ?? process.env.SUPABASE_ACCESS_TOKEN,
        projectId,
        readOnly,
        apiUrl,
        features: cliFeatures ? parseList(cliFeatures) : undefined,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      type: 'exit',
      code: 1,
      output: `${message}\n\n${helpText}`,
      stream: 'stderr',
    };
  }
}

export function writeCliExit(
  result: Extract<CliResult, { type: 'exit' }>
): never {
  const writer = result.stream === 'stdout' ? process.stdout : process.stderr;
  writer.write(result.output);
  process.exit(result.code);
}
