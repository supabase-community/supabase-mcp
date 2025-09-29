import { z } from 'zod';
import {
  parseSupabaseConfig,
  getSupabaseConfigDir,
  tryTokensSequentially,
  type ConfigParseResult,
} from './config/supabase-config.js';
import type { ProjectContext } from './config/project-context.js';

/**
 * Supabase personal access token validation schema
 * Format: sbp_[base64-encoded-data]
 */
export const supabaseTokenSchema = z
  .string()
  .min(1, 'Access token cannot be empty')
  .regex(
    /^sbp_[A-Za-z0-9+/=_-]+$/,
    'Invalid Supabase access token format. Expected format: sbp_[alphanumeric-characters]'
  )
  .refine((token) => {
    // Basic length validation - Supabase tokens should be at least 20 characters
    return token.length >= 20;
  }, 'Access token appears to be too short');

/**
 * Enhanced access token validation and sanitization
 */
export function validateAndSanitizeToken(token: string | undefined): {
  isValid: boolean;
  sanitizedToken?: string;
  error?: string;
  suggestions?: string[];
} {
  if (!token) {
    return {
      isValid: false,
      error: 'No access token provided',
      suggestions: [
        'Set the SUPABASE_ACCESS_TOKEN environment variable',
        'Pass --access-token flag to the MCP server',
        'Create a personal access token at https://supabase.com/dashboard/account/tokens',
      ],
    };
  }

  // Trim whitespace and remove potential quotes
  const sanitizedToken = token.trim().replace(/^["']|["']$/g, '');

  const result = supabaseTokenSchema.safeParse(sanitizedToken);

  if (!result.success) {
    const error = result.error.issues[0]?.message || 'Invalid token format';

    // Provide specific suggestions based on the error
    const suggestions: string[] = [];

    if (!sanitizedToken.startsWith('sbp_')) {
      suggestions.push('Supabase access tokens must start with "sbp_"');
      suggestions.push(
        "Ensure you're using a Personal Access Token, not an API key"
      );
    }

    if (sanitizedToken.length < 40) {
      suggestions.push('Token appears to be incomplete or truncated');
      suggestions.push('Copy the full token from your Supabase dashboard');
    }

    suggestions.push(
      'Generate a new token at https://supabase.com/dashboard/account/tokens'
    );

    return {
      isValid: false,
      error,
      suggestions,
    };
  }

  return {
    isValid: true,
    sanitizedToken,
  };
}

/**
 * Client information detection
 */
export interface ClientInfo {
  name: string;
  version: string;
}

export interface ClientContext {
  isClaudeCLI: boolean;
  clientInfo?: ClientInfo;
  userAgent?: string;
}

/**
 * Detect if the client is Claude CLI and provide context-specific guidance
 */
export function detectClientContext(
  clientInfo?: ClientInfo,
  userAgent?: string
): ClientContext {
  const isClaudeCLI = Boolean(
    clientInfo?.name?.toLowerCase().includes('claude') ||
      userAgent?.toLowerCase().includes('claude')
  );

  return {
    isClaudeCLI,
    clientInfo,
    userAgent,
  };
}

/**
 * Generate context-aware error messages for authentication failures
 */
export function generateAuthErrorMessage(
  originalError: string,
  clientContext: ClientContext,
  tokenValidation?: { error?: string; suggestions?: string[] }
): string {
  const baseError = originalError;
  const suggestions: string[] = [];

  if (clientContext.isClaudeCLI) {
    suggestions.push('For Claude CLI users:');
    suggestions.push(
      '1. Ensure SUPABASE_ACCESS_TOKEN is set in your environment'
    );
    suggestions.push(
      '2. Restart Claude CLI after setting the environment variable'
    );
    suggestions.push(
      '3. Check your MCP server configuration in Claude CLI settings'
    );
  } else {
    suggestions.push('For MCP client users:');
    suggestions.push(
      '1. Set SUPABASE_ACCESS_TOKEN in your MCP client configuration'
    );
    suggestions.push(
      '2. Alternatively, pass --access-token flag to the server'
    );
  }

  // Add token-specific suggestions if available
  if (tokenValidation?.suggestions) {
    suggestions.push('Token validation issues:');
    suggestions.push(...tokenValidation.suggestions.map((s) => `- ${s}`));
  }

  // Add general troubleshooting
  suggestions.push('General troubleshooting:');
  suggestions.push(
    '- Verify the token at https://supabase.com/dashboard/account/tokens'
  );
  suggestions.push('- Ensure the token has not expired');
  suggestions.push('- Check that the token has appropriate permissions');

  return [baseError, '', ...suggestions].join('\n');
}

/**
 * Authentication mode for the MCP server
 */
export type AuthMode = 'personal-token' | 'project-keys' | 'none';

/**
 * Enhanced token resolution with multiple fallback strategies including config file and project support
 */
export interface TokenResolutionOptions {
  cliToken?: string;
  envToken?: string;
  configFileTokens?: string[];
  projectContext?: ProjectContext;
  clientContext?: ClientContext;
}

export interface TokenResolutionResult {
  token?: string;
  source: 'cli' | 'env' | 'project' | 'config' | 'none';
  authMode: AuthMode;
  validation: ReturnType<typeof validateAndSanitizeToken>;
  projectContext?: ProjectContext;
  configGuidance?: string[];
  claudeCLIWarnings?: string[];
}

export function resolveAccessToken(
  options: TokenResolutionOptions
): TokenResolutionResult {
  const {
    cliToken,
    envToken,
    configFileTokens,
    projectContext,
    clientContext,
  } = options;
  const claudeCLIWarnings: string[] = [];

  // Priority order:
  // 1. CLI flag (personal token)
  // 2. Environment variable (personal token)
  // 3. Project directory config (project keys)
  // 4. ~/.supabase config file (personal token)
  // 5. None

  // Priority 1: CLI flag
  if (cliToken) {
    const validation = validateAndSanitizeToken(cliToken);

    if (clientContext?.isClaudeCLI && validation.isValid) {
      claudeCLIWarnings.push(
        'Claude CLI: Using CLI token. Consider using environment variables for better integration.'
      );
    }

    return {
      token: validation.sanitizedToken,
      source: 'cli',
      authMode: 'personal-token',
      validation,
      claudeCLIWarnings:
        claudeCLIWarnings.length > 0 ? claudeCLIWarnings : undefined,
    };
  }

  // Priority 2: Environment variable (Claude CLI preferred method)
  if (envToken) {
    const validation = validateAndSanitizeToken(envToken);

    if (clientContext?.isClaudeCLI && validation.isValid) {
      console.log(
        '✅ Claude CLI: Using environment variable SUPABASE_ACCESS_TOKEN (recommended)'
      );
    }

    return {
      token: validation.sanitizedToken,
      source: 'env',
      authMode: 'personal-token',
      validation,
    };
  }

  // Priority 3: Project directory config (NEW)
  if (projectContext?.hasProjectConfig) {
    // For project-based auth, we don't use personal tokens
    // Instead, we'll use project keys directly in the platform
    if (clientContext?.isClaudeCLI) {
      console.log('📁 Using project configuration from current directory');
    }

    return {
      source: 'project',
      authMode: 'project-keys',
      projectContext,
      validation: { isValid: true }, // Project keys are validated differently
    };
  }

  // Priority 4: Config file tokens (with Claude CLI warnings)
  if (configFileTokens && configFileTokens.length > 0) {
    if (clientContext?.isClaudeCLI) {
      claudeCLIWarnings.push(
        'Claude CLI: Using ~/.supabase config file.',
        'For better Claude CLI integration, set SUPABASE_ACCESS_TOKEN environment variable instead.',
        'Example: export SUPABASE_ACCESS_TOKEN="' +
          (configFileTokens[0]?.substring(0, 10) ?? '') +
          '..."'
      );
    }

    // Try the first valid token from config file
    for (const token of configFileTokens) {
      const validation = validateAndSanitizeToken(token);
      if (validation.isValid) {
        return {
          token: validation.sanitizedToken,
          source: 'config',
          authMode: 'personal-token',
          validation,
          claudeCLIWarnings:
            claudeCLIWarnings.length > 0 ? claudeCLIWarnings : undefined,
        };
      }
    }

    // If no valid tokens found in config
    const validation = validateAndSanitizeToken(undefined);
    return {
      source: 'config',
      authMode: 'none',
      validation: {
        ...validation,
        error: 'No valid tokens found in config file',
        suggestions: [
          'Verify tokens in ~/.supabase file start with "sbp_"',
          'Generate new token at https://supabase.com/dashboard/account/tokens',
          ...(clientContext?.isClaudeCLI
            ? ['Consider using environment variables for Claude CLI']
            : []),
        ],
      },
      claudeCLIWarnings:
        claudeCLIWarnings.length > 0 ? claudeCLIWarnings : undefined,
    };
  }

  // Priority 5: No token found
  const validation = validateAndSanitizeToken(undefined);
  const configGuidance = clientContext?.isClaudeCLI
    ? [
        'Claude CLI Setup Options:',
        '1. Environment variable (recommended): export SUPABASE_ACCESS_TOKEN="sbp_your_token"',
        '2. Create project config: Add .env with SUPABASE_URL and keys to your project',
        '3. Config file: Add token to ~/.supabase/access-token file',
        '4. Get token at: https://supabase.com/dashboard/account/tokens',
      ]
    : undefined;

  return {
    source: 'none',
    authMode: 'none',
    validation,
    configGuidance,
  };
}

/**
 * Resolves token from config file with Claude CLI optimizations
 */
export async function resolveTokenFromConfig(
  clientContext?: ClientContext
): Promise<{
  tokens: string[];
  configResult?: ConfigParseResult;
  claudeCLIGuidance?: string[];
}> {
  const configDir = getSupabaseConfigDir();
  const configResult = parseSupabaseConfig(configDir, clientContext);

  if (!configResult.success) {
    return {
      tokens: [],
      configResult,
      claudeCLIGuidance: configResult.claudeCLIGuidance,
    };
  }

  return {
    tokens: configResult.tokens || [],
    configResult,
    claudeCLIGuidance: configResult.claudeCLIGuidance,
  };
}

/**
 * Authentication startup validation with enhanced config file support
 */
export function validateAuthenticationSetup(
  tokenResolution: TokenResolutionResult,
  clientContext: ClientContext
): {
  isValid: boolean;
  error?: string;
  warnings?: string[];
  claudeCLIGuidance?: string[];
} {
  const {
    validation,
    source,
    authMode,
    claudeCLIWarnings,
    configGuidance,
    projectContext,
  } = tokenResolution;
  const warnings: string[] = [];

  // Handle project-based authentication separately
  if (authMode === 'project-keys') {
    if (!projectContext?.hasProjectConfig) {
      return {
        isValid: false,
        error: 'Project configuration found but incomplete',
        claudeCLIGuidance: [
          'Project configuration requires:',
          '- SUPABASE_URL: The project URL',
          '- SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY: Authentication key',
        ],
      };
    }

    // Project-based auth is valid if we have config
    return {
      isValid: true,
      warnings: projectContext.warnings,
    };
  }

  // Handle personal token authentication
  if (!validation.isValid) {
    return {
      isValid: false,
      error: generateAuthErrorMessage(
        validation.error || 'Authentication setup failed',
        clientContext,
        validation
      ),
      claudeCLIGuidance: configGuidance,
    };
  }

  // Add warnings for potentially problematic setups
  if (source === 'cli' && clientContext.isClaudeCLI) {
    warnings.push(
      'Consider setting SUPABASE_ACCESS_TOKEN environment variable for Claude CLI'
    );
  }

  if (source === 'config' && clientContext.isClaudeCLI) {
    warnings.push('Using ~/.supabase config file with Claude CLI');
    warnings.push(
      'Environment variables are recommended for better Claude CLI integration'
    );
  }

  // Add Claude CLI specific warnings if present
  if (claudeCLIWarnings) {
    warnings.push(...claudeCLIWarnings);
  }

  return {
    isValid: true,
    warnings: warnings.length > 0 ? warnings : undefined,
    claudeCLIGuidance: configGuidance,
  };
}
