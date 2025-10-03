#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseArgs } from 'node:util';
import packageJson from '../../package.json' with { type: 'json' };
import {
  resolveAccessToken,
  validateAuthenticationSetup,
  detectClientContext,
  resolveTokenFromConfig,
  type ClientInfo,
} from '../auth.js';
import {
  detectProjectContext,
  formatProjectContextForConsole,
  hasValidProjectCredentials,
} from '../config/project-context.js';
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

  // Detect project context from current working directory
  const projectContext = detectProjectContext(undefined, clientContext);

  // Display project context information if found
  if (projectContext.hasProjectConfig) {
    const projectInfo = formatProjectContextForConsole(
      projectContext,
      clientContext
    );
    projectInfo.forEach((line) => console.log(line));
  }

  // Resolve tokens from config file if needed
  const configTokenResult = await resolveTokenFromConfig(clientContext);

  // Display Claude CLI guidance if config file was attempted
  if (
    configTokenResult.claudeCLIGuidance &&
    clientContext.isClaudeCLI &&
    !projectContext.hasProjectConfig
  ) {
    configTokenResult.claudeCLIGuidance.forEach((guidance) =>
      console.log(guidance)
    );
  }

  // Enhanced token resolution with project context and config file fallback
  const tokenResolution = resolveAccessToken({
    cliToken: cliAccessToken,
    envToken: process.env.SUPABASE_ACCESS_TOKEN,
    configFileTokens: configTokenResult.tokens,
    projectContext,
    clientContext,
  });

  // Validate authentication setup
  const authValidation = validateAuthenticationSetup(
    tokenResolution,
    clientContext
  );

  if (!authValidation.isValid) {
    console.error(authValidation.error);
    if (authValidation.claudeCLIGuidance && clientContext.isClaudeCLI) {
      console.log('\n' + authValidation.claudeCLIGuidance.join('\n'));
    }
    process.exit(1);
  }

  // Log warnings if any
  if (authValidation.warnings?.length) {
    authValidation.warnings.forEach((warning) => console.warn(`⚠️  ${warning}`));
  }

  // Show Claude CLI guidance for successful setup if relevant
  if (authValidation.claudeCLIGuidance && clientContext.isClaudeCLI) {
    authValidation.claudeCLIGuidance.forEach((guidance) =>
      console.log(`💡 ${guidance}`)
    );
  }

  // Determine authentication mode and create platform accordingly
  const features = cliFeatures ? parseList(cliFeatures) : undefined;

  let platform;
  let resolvedProjectId = projectId; // CLI flag takes precedence

  if (
    tokenResolution.authMode === 'project-keys' &&
    tokenResolution.projectContext
  ) {
    // Using project-based authentication
    const ctx = tokenResolution.projectContext;

    // Use project ID from context if not explicitly provided via CLI
    if (!resolvedProjectId && ctx.credentials.projectId) {
      resolvedProjectId = ctx.credentials.projectId;
      console.log(`🔗 Auto-detected project ID: ${resolvedProjectId}`);
    }

    // For now, we'll require a personal token even in project mode
    // In future, we can create a project-keys platform implementation
    // that uses the anon/service keys directly
    console.warn(
      '⚠️  Project-based authentication detected but not fully implemented yet.'
    );
    console.warn(
      '   Please set SUPABASE_ACCESS_TOKEN environment variable for now.'
    );

    // Fall back to personal token if available
    const fallbackToken =
      process.env.SUPABASE_ACCESS_TOKEN || configTokenResult.tokens?.[0];
    if (!fallbackToken) {
      console.error(
        '❌ No personal access token found. Project-keys mode not yet supported.'
      );
      process.exit(1);
    }

    platform = createSupabaseApiPlatform({
      accessToken: fallbackToken,
      apiUrl,
      clientContext,
      projectContext,
    });
  } else if (tokenResolution.token) {
    // Using personal token authentication
    platform = createSupabaseApiPlatform({
      accessToken: tokenResolution.token,
      apiUrl,
      clientContext,
      projectContext,
    });
  } else {
    console.error('❌ No valid authentication method found');
    process.exit(1);
  }

  // Initialize runtime managers for the new features
  initializeModeManager(readOnly || false, clientContext);
  initializeProjectManager(
    platform,
    resolvedProjectId,
    clientContext,
    projectContext
  );

  const server = createSupabaseMcpServer({
    platform,
    projectId: resolvedProjectId,
    readOnly,
    features,
  });

  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch(console.error);
