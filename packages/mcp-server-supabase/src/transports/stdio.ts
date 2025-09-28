#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import {
  resolveAccessToken,
  validateAuthenticationSetup,
  detectClientContext,
  resolveTokenFromConfig,
  type ClientInfo
} from '../auth.js';
import { createSupabaseApiPlatform } from '../platform/api-platform.js';
import { createSupabaseMcpServer } from '../server.js';
import { parseList } from './util.js';
import { initializeModeManager } from '../runtime/mode-manager.js';
import { initializeProjectManager } from '../runtime/project-manager.js';

const { version } = packageJson;

async function main() {
  const {
    values: {
      ['access-token']: cliAccessToken,
      ['project-ref']: projectId,
      ['read-only']: readOnly,
      ['api-url']: apiUrl,
      ['version']: showVersion,
      ['features']: cliFeatures,
    },
  } = parseArgs({
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
    },
  });

  if (showVersion) {
    console.log(version);
    process.exit(0);
  }

  // Detect client context for better error messaging
  const clientContext = detectClientContext(undefined, process.env.USER_AGENT);

  // Resolve tokens from config file if needed
  const configTokenResult = await resolveTokenFromConfig(clientContext);

  // Display Claude CLI guidance if config file was attempted
  if (configTokenResult.claudeCLIGuidance && clientContext.isClaudeCLI) {
    configTokenResult.claudeCLIGuidance.forEach(guidance => console.log(guidance));
  }

  // Enhanced token resolution with config file fallback
  const tokenResolution = resolveAccessToken({
    cliToken: cliAccessToken,
    envToken: process.env.SUPABASE_ACCESS_TOKEN,
    configFileTokens: configTokenResult.tokens,
    clientContext,
  });

  // Validate authentication setup
  const authValidation = validateAuthenticationSetup(tokenResolution, clientContext);

  if (!authValidation.isValid) {
    console.error(authValidation.error);
    if (authValidation.claudeCLIGuidance && clientContext.isClaudeCLI) {
      console.log('\n' + authValidation.claudeCLIGuidance.join('\n'));
    }
    process.exit(1);
  }

  // Log warnings if any
  if (authValidation.warnings?.length) {
    authValidation.warnings.forEach(warning => console.warn(`⚠️  ${warning}`));
  }

  // Show Claude CLI guidance for successful setup if relevant
  if (authValidation.claudeCLIGuidance && clientContext.isClaudeCLI) {
    authValidation.claudeCLIGuidance.forEach(guidance => console.log(`💡 ${guidance}`));
  }

  const accessToken = tokenResolution.token!;

  const features = cliFeatures ? parseList(cliFeatures) : undefined;

  const platform = createSupabaseApiPlatform({
    accessToken,
    apiUrl,
    clientContext,
  });

  // Initialize runtime managers for the new features
  initializeModeManager(readOnly || false, clientContext);
  initializeProjectManager(platform, projectId, clientContext);

  const server = createSupabaseMcpServer({
    platform,
    projectId,
    readOnly,
    features,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
