import fs from 'node:fs';
import path from 'node:path';
import { parseKeyValueContent } from './supabase-config.js';
import type { ClientContext } from '../auth.js';

export interface ProjectCredentials {
  supabaseUrl?: string;
  anonKey?: string;
  serviceRoleKey?: string;
  projectId?: string;
}

export interface ProjectContext {
  directory: string;
  credentials: ProjectCredentials;
  configSource:
    | 'env'
    | 'env.local'
    | 'supabase-config'
    | 'supabase-env'
    | 'none';
  hasProjectConfig: boolean;
  warnings?: string[];
}

/**
 * Extract project ID from Supabase URL
 * Format: https://[project-id].supabase.co or similar
 */
export function extractProjectId(supabaseUrl: string): string | undefined {
  try {
    const url = new URL(supabaseUrl);
    const hostname = url.hostname;

    // Match patterns like xxxxxxxxxxxx.supabase.co
    const match = hostname.match(/^([a-z0-9]+)\.supabase\.(co|in|io)$/);
    if (match) {
      return match[1];
    }

    // Handle custom domains - extract from path or subdomain
    const pathMatch = url.pathname.match(/^\/project\/([a-z0-9]+)/);
    if (pathMatch) {
      return pathMatch[1];
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read and parse an environment file
 */
function readEnvFile(filePath: string): Record<string, string> {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    return parseKeyValueContent(content);
  } catch {
    return {};
  }
}

/**
 * Read and parse Supabase CLI config.toml file
 */
function readSupabaseConfigToml(filePath: string): ProjectCredentials {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const credentials: ProjectCredentials = {};

    // Simple TOML parsing for the values we need
    // This is a basic parser - consider using a proper TOML parser if needed
    const lines = content.split('\n');
    let inApiSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      // Check for [api] section
      if (trimmed === '[api]') {
        inApiSection = true;
        continue;
      }

      // Check for other sections
      if (trimmed.startsWith('[') && trimmed !== '[api]') {
        inApiSection = false;
        continue;
      }

      // Parse key-value pairs
      if (inApiSection) {
        const match = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
        if (match && match[1] && match[2]) {
          const key = match[1];
          const value = match[2];
          if (key === 'url') {
            credentials.supabaseUrl = value;
            const projectId = extractProjectId(value);
            if (projectId) {
              credentials.projectId = projectId;
            }
          } else if (key === 'anon_key') {
            credentials.anonKey = value;
          } else if (key === 'service_role_key') {
            credentials.serviceRoleKey = value;
          }
        }
      }
    }

    return credentials;
  } catch {
    return {};
  }
}

/**
 * Extract project credentials from environment variables
 */
function extractCredentialsFromEnv(
  env: Record<string, string>
): ProjectCredentials {
  const credentials: ProjectCredentials = {};

  // Check for Supabase URL (various naming conventions)
  const urlKeys = [
    'SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'VITE_SUPABASE_URL',
    'REACT_APP_SUPABASE_URL',
  ];
  for (const key of urlKeys) {
    if (env[key]) {
      credentials.supabaseUrl = env[key];
      const projectId = extractProjectId(env[key]);
      if (projectId) {
        credentials.projectId = projectId;
      }
      break;
    }
  }

  // Check for anon key
  const anonKeys = [
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'VITE_SUPABASE_ANON_KEY',
    'REACT_APP_SUPABASE_ANON_KEY',
  ];
  for (const key of anonKeys) {
    if (env[key]) {
      credentials.anonKey = env[key];
      break;
    }
  }

  // Check for service role key (less common in client apps)
  const serviceKeys = [
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SECRET_KEY',
  ];
  for (const key of serviceKeys) {
    if (env[key]) {
      credentials.serviceRoleKey = env[key];
      break;
    }
  }

  return credentials;
}

/**
 * Validate and sanitize project credentials
 */
function validateProjectCredentials(credentials: ProjectCredentials): string[] {
  const warnings: string[] = [];

  if (credentials.supabaseUrl && !credentials.supabaseUrl.startsWith('http')) {
    warnings.push('Supabase URL should start with http:// or https://');
  }

  if (credentials.anonKey && !credentials.anonKey.startsWith('eyJ')) {
    warnings.push(
      'Anon key appears to be invalid (should be a JWT starting with "eyJ")'
    );
  }

  if (
    credentials.serviceRoleKey &&
    !credentials.serviceRoleKey.startsWith('eyJ')
  ) {
    warnings.push(
      'Service role key appears to be invalid (should be a JWT starting with "eyJ")'
    );
  }

  return warnings;
}

/**
 * Check file permissions and warn if too permissive
 */
function checkFilePermissions(
  filePath: string,
  clientContext?: ClientContext
): string[] {
  const warnings: string[] = [];

  try {
    const stats = fs.statSync(filePath);
    const mode = stats.mode;

    // Check if file is world-readable (last 3 bits)
    if ((mode & 0o004) !== 0) {
      const fileName = path.basename(filePath);
      warnings.push(
        `${fileName} is world-readable. Consider setting permissions to 600 for security.`
      );

      if (clientContext?.isClaudeCLI) {
        warnings.push(`Run: chmod 600 ${filePath}`);
      }
    }
  } catch {
    // Ignore permission check errors
  }

  return warnings;
}

/**
 * Detect project context from current working directory
 */
export function detectProjectContext(
  cwd?: string,
  clientContext?: ClientContext
): ProjectContext {
  const directory = cwd || process.cwd();
  const warnings: string[] = [];
  let credentials: ProjectCredentials = {};
  let configSource: ProjectContext['configSource'] = 'none';

  // Priority 1: .env file in project root
  const envPath = path.join(directory, '.env');
  if (fs.existsSync(envPath)) {
    const env = readEnvFile(envPath);
    const envCreds = extractCredentialsFromEnv(env);
    if (envCreds.supabaseUrl) {
      credentials = envCreds;
      configSource = 'env';
      warnings.push(...checkFilePermissions(envPath, clientContext));
    }
  }

  // Priority 2: .env.local file (overrides .env)
  const envLocalPath = path.join(directory, '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const env = readEnvFile(envLocalPath);
    const localCreds = extractCredentialsFromEnv(env);
    if (localCreds.supabaseUrl) {
      credentials = { ...credentials, ...localCreds };
      configSource = 'env.local';
      warnings.push(...checkFilePermissions(envLocalPath, clientContext));
    }
  }

  // Priority 3: .supabase/config.toml (Supabase CLI config)
  const supabaseConfigPath = path.join(directory, '.supabase', 'config.toml');
  if (fs.existsSync(supabaseConfigPath)) {
    const configCreds = readSupabaseConfigToml(supabaseConfigPath);
    if (configCreds.supabaseUrl && !credentials.supabaseUrl) {
      credentials = configCreds;
      configSource = 'supabase-config';
    }
  }

  // Priority 4: .supabase/.env or other files in .supabase directory
  const supabaseEnvPath = path.join(directory, '.supabase', '.env');
  if (fs.existsSync(supabaseEnvPath)) {
    const env = readEnvFile(supabaseEnvPath);
    const supabaseDirCreds = extractCredentialsFromEnv(env);
    if (supabaseDirCreds.supabaseUrl && !credentials.supabaseUrl) {
      credentials = supabaseDirCreds;
      configSource = 'supabase-env';
      warnings.push(...checkFilePermissions(supabaseEnvPath, clientContext));
    }
  }

  // Validate credentials if found
  if (credentials.supabaseUrl) {
    warnings.push(...validateProjectCredentials(credentials));
  }

  return {
    directory,
    credentials,
    configSource,
    hasProjectConfig: Boolean(credentials.supabaseUrl),
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Get a user-friendly description of where config was found
 */
export function getConfigSourceDescription(
  source: ProjectContext['configSource']
): string {
  switch (source) {
    case 'env':
      return '.env file';
    case 'env.local':
      return '.env.local file';
    case 'supabase-config':
      return '.supabase/config.toml file';
    case 'supabase-env':
      return '.supabase/.env file';
    case 'none':
      return 'no project configuration found';
    default:
      return 'unknown source';
  }
}

/**
 * Format project context for console output
 */
export function formatProjectContextForConsole(
  context: ProjectContext,
  clientContext?: ClientContext
): string[] {
  const lines: string[] = [];

  if (!context.hasProjectConfig) {
    if (clientContext?.isClaudeCLI) {
      lines.push('📁 No Supabase project detected in current directory');
      lines.push('   Using personal access token mode');
    }
    return lines;
  }

  lines.push(
    `🎯 Detected Supabase project in ${path.basename(context.directory)}`
  );
  lines.push(
    `   Config source: ${getConfigSourceDescription(context.configSource)}`
  );

  if (context.credentials.projectId) {
    lines.push(`   Project ID: ${context.credentials.projectId}`);
  }

  if (context.credentials.supabaseUrl) {
    // Mask the URL for security
    const url = context.credentials.supabaseUrl;
    const masked =
      url.length > 30
        ? url.substring(0, 20) + '...' + url.substring(url.length - 7)
        : url;
    lines.push(`   URL: ${masked}`);
  }

  if (context.credentials.anonKey) {
    lines.push(
      `   Anon key: ${context.credentials.anonKey.substring(0, 10)}...`
    );
  }

  if (context.credentials.serviceRoleKey) {
    lines.push(
      `   Service key: ${context.credentials.serviceRoleKey.substring(0, 10)}... (found)`
    );
  }

  if (context.warnings && context.warnings.length > 0) {
    lines.push('   ⚠️  Warnings:');
    for (const warning of context.warnings) {
      lines.push(`      - ${warning}`);
    }
  }

  return lines;
}

/**
 * Check if project context has sufficient credentials
 */
export function hasValidProjectCredentials(context: ProjectContext): boolean {
  return Boolean(
    context.credentials.supabaseUrl &&
      (context.credentials.anonKey || context.credentials.serviceRoleKey)
  );
}

/**
 * Get project configuration file search paths for documentation
 */
export function getProjectConfigSearchPaths(cwd?: string): string[] {
  const directory = cwd || process.cwd();
  const baseName = path.basename(directory);

  return [
    `${baseName}/.env`,
    `${baseName}/.env.local`,
    `${baseName}/.supabase/config.toml`,
    `${baseName}/.supabase/.env`,
  ];
}
