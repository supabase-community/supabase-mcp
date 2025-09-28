import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ClientContext } from '../auth.js';

export interface SupabaseConfig {
  [key: string]: string;
}

export interface ConfigParseResult {
  success: boolean;
  config?: SupabaseConfig;
  tokens?: string[];
  error?: string;
  claudeCLIGuidance?: string[];
}

export function getSupabaseConfigDir(): string {
  return path.join(os.homedir(), '.supabase');
}

export function parseSupabaseConfig(configDir?: string, clientContext?: ClientContext): ConfigParseResult {
  const supabaseDir = configDir || getSupabaseConfigDir();

  try {
    if (!fs.existsSync(supabaseDir)) {
      const guidance = clientContext?.isClaudeCLI ? [
        'For Claude CLI users: Environment variables are recommended over config files',
        'Set SUPABASE_ACCESS_TOKEN in your environment instead',
        'Example: export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"'
      ] : undefined;

      return {
        success: false,
        error: `Supabase config directory not found at ${supabaseDir}`,
        claudeCLIGuidance: guidance
      };
    }

    const stats = fs.statSync(supabaseDir);

    if (!stats.isDirectory()) {
      const guidance = clientContext?.isClaudeCLI ? [
        'Claude CLI troubleshooting:',
        '~/.supabase should be a directory, not a file',
        'Remove the file and let Supabase CLI recreate the directory',
        'Or use environment variables: export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"'
      ] : undefined;

      return {
        success: false,
        error: `${supabaseDir} exists but is not a directory`,
        claudeCLIGuidance: guidance
      };
    }

    // Look for common Supabase config files
    const configFiles = [
      'access-token',  // Supabase CLI stores access token here
      'config.toml',   // Alternative config file format
      'config',        // Plain config file
      '.env'           // Environment file
    ];

    let allTokens: string[] = [];
    let allConfigs: SupabaseConfig = {};

    for (const configFile of configFiles) {
      const configPath = path.join(supabaseDir, configFile);

      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf-8').trim();

          // If it's just a token (like access-token file), treat it as a token
          if (configFile === 'access-token' && content.startsWith('sbp_')) {
            allTokens.push(content);
          } else {
            // Parse as KEY=value format
            const config = parseKeyValueContent(content);
            Object.assign(allConfigs, config);
            const tokens = findSupabaseTokens(config);
            allTokens.push(...tokens);
          }

          // Security check: warn about file permissions
          if (clientContext?.isClaudeCLI) {
            const fileStats = fs.statSync(configPath);
            if ((fileStats.mode & 0o077) !== 0) {
              console.warn(`⚠️  Claude CLI Warning: ${configPath} has overly permissive permissions. Consider setting to 600.`);
            }
          }
        } catch (fileError) {
          // Continue with other files if one fails
          if (clientContext?.isClaudeCLI) {
            console.warn(`⚠️  Claude CLI Warning: Could not read ${configPath}: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`);
          }
        }
      }
    }

    // Remove duplicates while preserving order
    const uniqueTokens = Array.from(new Set(allTokens));

    // Claude CLI specific guidance
    const claudeCLIGuidance = clientContext?.isClaudeCLI ? [
      'Claude CLI users: Consider using environment variables instead of config files',
      'Environment variables are more secure and integrate better with Claude CLI',
      'Run: export SUPABASE_ACCESS_TOKEN="your_token_here"'
    ] : undefined;

    return {
      success: true,
      config: allConfigs,
      tokens: uniqueTokens,
      claudeCLIGuidance
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error parsing config directory';

    const claudeCLIGuidance = clientContext?.isClaudeCLI ? [
      'Claude CLI troubleshooting:',
      '1. Check directory permissions: chmod 700 ~/.supabase',
      '2. Check file permissions: chmod 600 ~/.supabase/*',
      '3. Verify file format: KEY=value (one per line)',
      '4. Consider using environment variables instead',
      '5. Example format:',
      '   SUPABASE_ACCESS_TOKEN=sbp_your_token_here',
      '   SUPABASE_PROJECT_REF=your_project_ref'
    ] : undefined;

    return {
      success: false,
      error: `Failed to parse config directory: ${errorMessage}`,
      claudeCLIGuidance
    };
  }
}

export function parseKeyValueContent(content: string): SupabaseConfig {
  const config: SupabaseConfig = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    // Parse KEY=value format
    const equalIndex = trimmedLine.indexOf('=');
    if (equalIndex === -1) {
      continue; // Skip malformed lines
    }

    const key = trimmedLine.substring(0, equalIndex).trim();
    let value = trimmedLine.substring(equalIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      config[key] = value;
    }
  }

  return config;
}

export function findSupabaseTokens(config: SupabaseConfig): string[] {
  const tokens: string[] = [];

  // Common token key patterns
  const tokenKeys = [
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_TOKEN',
    'ACCESS_TOKEN',
    'TOKEN',
    'SUPABASE_API_KEY', // Less common but possible
    'API_KEY'
  ];

  // Find tokens in order of preference
  for (const key of tokenKeys) {
    if (config[key] && config[key].startsWith('sbp_')) {
      tokens.push(config[key]);
    }
  }

  // Also check for any other values that look like Supabase tokens
  for (const [key, value] of Object.entries(config)) {
    if (!tokenKeys.includes(key) && value.startsWith('sbp_')) {
      tokens.push(value);
    }
  }

  return tokens;
}

export function validateConfigForClaudeCLI(config: SupabaseConfig): {
  isValid: boolean;
  warnings: string[];
  recommendations: string[];
} {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  let isValid = true;

  // Check for tokens
  const tokens = findSupabaseTokens(config);
  if (tokens.length === 0) {
    warnings.push('No valid Supabase tokens found in config file');
    isValid = false;
  }

  // Claude CLI specific recommendations
  recommendations.push(
    'For Claude CLI users, environment variables are preferred:',
    '1. Set SUPABASE_ACCESS_TOKEN environment variable',
    '2. Restart Claude CLI after setting environment variables',
    '3. Remove ~/.supabase file once environment variables are set',
    '4. Environment variables are more secure and integrate better with Claude CLI'
  );

  if (Object.keys(config).length > 5) {
    warnings.push('Config file contains many entries - consider using environment variables for Claude CLI');
  }

  return {
    isValid,
    warnings,
    recommendations
  };
}

export function generateClaudeCLIConfigGuidance(): string[] {
  return [
    '🚀 Claude CLI Setup Guidance:',
    '',
    'Recommended approach (environment variables):',
    '1. export SUPABASE_ACCESS_TOKEN="sbp_your_token_here"',
    '2. Restart Claude CLI',
    '3. Test connection',
    '',
    'Alternative approach (config directory):',
    '1. Create ~/.supabase directory',
    '2. Add token to ~/.supabase/access-token file',
    '3. Set permissions: chmod 700 ~/.supabase && chmod 600 ~/.supabase/access-token',
    '',
    'Get your token at: https://supabase.com/dashboard/account/tokens',
    '',
    'Need help? The MCP server will guide you through any issues.'
  ];
}

export async function tryTokensSequentially(
  tokens: string[],
  validateTokenFn: (token: string) => Promise<boolean>,
  clientContext?: ClientContext
): Promise<{ token?: string; index?: number; error?: string }> {
  if (tokens.length === 0) {
    return { error: 'No tokens to try' };
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token) {
      continue; // Skip undefined/empty tokens
    }

    if (clientContext?.isClaudeCLI && i > 0) {
      console.log(`Claude CLI: Trying fallback token ${i + 1}/${tokens.length}...`);
    }

    try {
      const isValid = await validateTokenFn(token);
      if (isValid) {
        if (clientContext?.isClaudeCLI) {
          console.log(`✅ Claude CLI: Successfully authenticated with token ${i + 1}`);
          if (i > 0) {
            console.log('💡 Consider setting the working token as SUPABASE_ACCESS_TOKEN environment variable');
          }
        }
        return { token, index: i };
      }
    } catch (error) {
      if (clientContext?.isClaudeCLI) {
        console.log(`❌ Claude CLI: Token ${i + 1} failed - ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  const guidance = clientContext?.isClaudeCLI ?
    'All tokens from ~/.supabase file failed. Check https://supabase.com/dashboard/account/tokens for valid tokens.' :
    'All provided tokens failed validation.';

  return { error: guidance };
}