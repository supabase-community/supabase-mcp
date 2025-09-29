const fs = require('fs');
const path = require('path');

console.log('=== Testing Project Context Detection ===');

// Test different project types
const testProjects = [
  'test_projects/nextjs_app',
  'test_projects/react_app',
  'test_projects/supabase_cli_project',
  'test_projects/priority_test', // Test priority system
  '.', // Current directory (should have no config)
];

function extractProjectId(supabaseUrl) {
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

function parseKeyValueContent(content) {
  const result = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) continue;

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match) {
      const key = match[1];
      let value = match[2];

      // Remove quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      result[key] = value;
    }
  }

  return result;
}

function readEnvFile(filePath) {
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

function extractCredentialsFromEnv(env) {
  const credentials = {};

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

  // Check for service role key
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

function readSupabaseConfigToml(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const credentials = {};

    const lines = content.split('\n');
    let inApiSection = false;

    for (const line of lines) {
      const trimmed = line.trim();

      if (trimmed === '[api]') {
        inApiSection = true;
        continue;
      }

      if (trimmed.startsWith('[') && trimmed !== '[api]') {
        inApiSection = false;
        continue;
      }

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

function detectProjectContext(directory) {
  let credentials = {};
  let configSource = 'none';

  // Priority 1: .env file
  const envPath = path.join(directory, '.env');
  if (fs.existsSync(envPath)) {
    const env = readEnvFile(envPath);
    const envCreds = extractCredentialsFromEnv(env);
    if (envCreds.supabaseUrl) {
      credentials = envCreds;
      configSource = 'env';
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
    }
  }

  // Priority 3: .supabase/config.toml
  const supabaseConfigPath = path.join(directory, '.supabase', 'config.toml');
  if (fs.existsSync(supabaseConfigPath)) {
    const configCreds = readSupabaseConfigToml(supabaseConfigPath);
    if (configCreds.supabaseUrl && !credentials.supabaseUrl) {
      credentials = configCreds;
      configSource = 'supabase-config';
    }
  }

  return {
    directory,
    credentials,
    configSource,
    hasProjectConfig: Boolean(credentials.supabaseUrl),
  };
}

// Test each project
testProjects.forEach((projectPath) => {
  console.log(`\n--- Testing: ${projectPath} ---`);

  if (!fs.existsSync(projectPath)) {
    console.log('❌ Directory does not exist');
    return;
  }

  const context = detectProjectContext(projectPath);

  console.log(`Config found: ${context.hasProjectConfig ? '✅' : '❌'}`);
  console.log(`Config source: ${context.configSource}`);

  if (context.hasProjectConfig) {
    console.log(`Project ID: ${context.credentials.projectId || 'N/A'}`);
    console.log(`Supabase URL: ${context.credentials.supabaseUrl || 'N/A'}`);
    console.log(`Anon key: ${context.credentials.anonKey ? 'Found' : 'Not found'}`);
    console.log(`Service key: ${context.credentials.serviceRoleKey ? 'Found' : 'Not found'}`);
  }
});

console.log('\n=== Project Detection Test Complete ===');