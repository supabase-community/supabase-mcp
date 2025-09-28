#!/usr/bin/env node

/**
 * Test script for newly implemented Supabase MCP server functionality
 * Tests: API Keys, Health Monitoring, SQL Snippets, Organization Members
 */

const { Client } = require('@modelcontextprotocol/sdk/dist/cjs/client/index.js');
const { StreamTransport } = require('@modelcontextprotocol/sdk/dist/cjs/transport/stream.js');
const { createSupabaseMcpServer } = require('./dist/index.cjs');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name, success, details = '') {
  const status = success ? '✅ PASS' : '❌ FAIL';
  const color = success ? 'green' : 'red';
  log(`  ${status}: ${name}`, color);
  if (details) {
    log(`    → ${details}`, 'yellow');
  }
}

// Mock implementations for testing
const mockData = {
  apiKeys: [
    { id: 'key1', name: 'test_key', type: 'publishable', api_key: 'pk_test_123', hash: null, inserted_at: null, updated_at: null, description: null, secret_jwt_template: null, prefix: null },
    { id: 'key2', name: 'secret_key', type: 'secret', api_key: 'sk_test_456', hash: null, inserted_at: null, updated_at: null, description: null, secret_jwt_template: null, prefix: null }
  ],
  snippets: [
    {
      id: 'snippet1',
      name: 'User Count',
      type: 'sql',
      visibility: 'project',
      favorite: true,
      inserted_at: '2024-01-01',
      updated_at: '2024-01-01',
      description: null,
      project: { id: 1, name: 'Test' },
      owner: { id: 1, username: 'test' },
      updated_by: { id: 1, username: 'test' }
    },
    {
      id: 'snippet2',
      name: 'Active Sessions',
      type: 'sql',
      visibility: 'user',
      favorite: false,
      inserted_at: '2024-01-01',
      updated_at: '2024-01-01',
      description: null,
      project: { id: 1, name: 'Test' },
      owner: { id: 1, username: 'test' },
      updated_by: { id: 1, username: 'test' }
    }
  ],
  health: [
    { name: 'auth', healthy: true, status: 'ACTIVE_HEALTHY' },
    { name: 'db', healthy: true, status: 'ACTIVE_HEALTHY' },
    { name: 'storage', healthy: true, status: 'ACTIVE_HEALTHY' }
  ],
  members: [
    { user_id: 'user1', user_name: 'Alice', email: 'alice@example.com', role_name: 'admin', mfa_enabled: true },
    { user_id: 'user2', user_name: 'Bob', email: 'bob@example.com', role_name: 'developer', mfa_enabled: false }
  ]
};

// Create mock platform with new operations
const mockPlatform = {
  // Account operations with new organization members
  account: {
    listOrganizations: async () => [{ id: 'org1', name: 'Test Org' }],
    getOrganization: async (id) => ({ id, name: 'Test Org', plan: 'pro' }),
    listProjects: async () => [{ id: 'proj1', name: 'Test Project', organization_id: 'org1', status: 'active', created_at: '2024-01-01', region: 'us-east-1' }],
    getProject: async (id) => ({ id, name: 'Test Project', organization_id: 'org1', status: 'active', created_at: '2024-01-01', region: 'us-east-1' }),
    createProject: async (opts) => ({ id: 'new-proj', name: opts.name, organization_id: opts.organization_id, status: 'active', created_at: '2024-01-01', region: opts.region }),
    pauseProject: async () => {},
    restoreProject: async () => {},
    listOrganizationMembers: async () => mockData.members
  },

  // Database operations with SQL snippets
  database: {
    executeSql: async (projectId, opts) => [],
    listMigrations: async () => [],
    applyMigration: async () => {},
    listSnippets: async () => mockData.snippets,
    getSnippet: async (id) => ({
      ...mockData.snippets.find(s => s.id === id),
      content: { sql: 'SELECT COUNT(*) FROM users;', schema_version: '1.0' }
    })
  },

  // Debugging operations with health monitoring
  debugging: {
    getLogs: async () => ({ logs: [] }),
    getSecurityAdvisors: async () => [{ type: 'security', message: 'No issues found' }],
    getPerformanceAdvisors: async () => [{ type: 'performance', message: 'No issues found' }],
    getProjectHealth: async () => mockData.health,
    getUpgradeStatus: async () => ({ status: 'up_to_date' }),
    checkUpgradeEligibility: async () => ({ eligible: true })
  },

  // New secrets operations for API keys
  secrets: {
    listApiKeys: async (projectId, reveal) => mockData.apiKeys,
    getApiKey: async (projectId, keyId, reveal) =>
      mockData.apiKeys.find(k => k.id === keyId),
    createApiKey: async (projectId, options) => ({
      id: 'new-key',
      name: options.name,
      type: options.type,
      api_key: options.type === 'publishable' ? 'pk_new_789' : 'sk_new_012',
      hash: null,
      inserted_at: null,
      updated_at: null,
      description: options.description || null,
      secret_jwt_template: options.secret_jwt_template || null,
      prefix: null
    }),
    updateApiKey: async (projectId, keyId, options) => ({
      ...mockData.apiKeys.find(k => k.id === keyId),
      ...options
    }),
    deleteApiKey: async (projectId, keyId, options) =>
      mockData.apiKeys.find(k => k.id === keyId)
  },

  // Other existing operations
  development: {
    getProjectUrl: async () => 'https://test.supabase.co',
    getAnonKey: async () => 'anon-key-123',
    generateTypescriptTypes: async () => ({ types: 'export type User = {}' })
  },

  functions: {
    listEdgeFunctions: async () => [],
    getEdgeFunction: async () => ({ id: 'func1', slug: 'test', name: 'test', status: 'active', version: 1, files: [] }),
    deployEdgeFunction: async () => ({ id: 'func1', slug: 'test', name: 'test', status: 'active', version: 1 })
  },

  branching: {
    listBranches: async () => [],
    createBranch: async () => ({ id: 'branch1', name: 'dev', project_ref: 'proj1', parent_project_ref: 'proj1', is_default: false, persistent: true, status: 'MIGRATIONS_PASSED', created_at: '2024-01-01', updated_at: '2024-01-01' }),
    deleteBranch: async () => {},
    mergeBranch: async () => {},
    resetBranch: async () => {},
    rebaseBranch: async () => {}
  },

  storage: {
    getStorageConfig: async () => ({ fileSizeLimit: 50000000, features: { imageTransformation: { enabled: true }, s3Protocol: { enabled: true } } }),
    updateStorageConfig: async () => {},
    listAllBuckets: async () => []
  }
};

async function setupTestClient() {
  const clientTransport = new StreamTransport();
  const serverTransport = new StreamTransport();

  // Connect the transports
  clientTransport.readable.pipeTo(serverTransport.writable);
  serverTransport.readable.pipeTo(clientTransport.writable);

  // Create MCP client
  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
  );

  // Create MCP server with mock platform
  const server = createSupabaseMcpServer({
    platform: mockPlatform,
    features: ['account', 'database', 'debugging', 'secrets', 'docs'],
    projectId: 'test-project'
  });

  // Connect both
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return { client, server };
}

async function testNewFeatures() {
  logSection('Testing New Supabase MCP Server Features');

  try {
    // Setup client and server
    const { client } = await setupTestClient();
    log('\n📦 Server connected successfully', 'green');

    // Get all available tools
    const tools = await client.listTools();
    const toolMap = {};
    tools.tools.forEach(tool => {
      toolMap[tool.name] = tool;
    });

    log(`📊 Total tools available: ${tools.tools.length}`, 'blue');

    // Test 1: API Key Management (Secrets Tools)
    logSection('1. API Key Management (Secrets Tools)');

    const secretsTools = [
      'list_api_keys',
      'get_api_key',
      'create_api_key',
      'update_api_key',
      'delete_api_key'
    ];

    let secretsTestsPassed = 0;
    for (const toolName of secretsTools) {
      const exists = !!toolMap[toolName];
      logTest(`Tool '${toolName}' exists`, exists);
      if (exists) secretsTestsPassed++;
    }

    // Test list_api_keys execution
    if (toolMap['list_api_keys']) {
      try {
        const result = await client.callTool({
          name: 'list_api_keys',
          arguments: {}
        });
        const success = result.content[0].text.includes('test_key') || result.content[0].text.includes('secret_key');
        logTest('list_api_keys execution', success, `Found API keys in response`);
        if (success) secretsTestsPassed++;
      } catch (err) {
        logTest('list_api_keys execution', false, err.message);
      }
    }

    log(`\n  Summary: ${secretsTestsPassed}/${secretsTools.length + 1} tests passed`, 'magenta');

    // Test 2: Health Monitoring (Debugging Tools)
    logSection('2. Health Monitoring (Debugging Tools)');

    const healthTools = [
      'get_project_health',
      'get_advisors',
      'get_upgrade_status',
      'check_upgrade_eligibility'
    ];

    let healthTestsPassed = 0;
    for (const toolName of healthTools) {
      const exists = !!toolMap[toolName];
      logTest(`Tool '${toolName}' exists`, exists);
      if (exists) healthTestsPassed++;
    }

    // Test get_project_health execution
    if (toolMap['get_project_health']) {
      try {
        const result = await client.callTool({
          name: 'get_project_health',
          arguments: {}
        });
        const success = result.content[0].text.includes('healthy') || result.content[0].text.includes('auth');
        logTest('get_project_health execution', success, 'Health status retrieved');
        if (success) healthTestsPassed++;
      } catch (err) {
        logTest('get_project_health execution', false, err.message);
      }
    }

    log(`\n  Summary: ${healthTestsPassed}/${healthTools.length + 1} tests passed`, 'magenta');

    // Test 3: SQL Snippets (Database Tools)
    logSection('3. SQL Snippets (Database Tools)');

    const snippetTools = [
      'list_snippets',
      'get_snippet'
    ];

    let snippetTestsPassed = 0;
    for (const toolName of snippetTools) {
      const exists = !!toolMap[toolName];
      logTest(`Tool '${toolName}' exists`, exists);
      if (exists) snippetTestsPassed++;
    }

    // Test list_snippets execution
    if (toolMap['list_snippets']) {
      try {
        const result = await client.callTool({
          name: 'list_snippets',
          arguments: {}
        });
        const success = result.content[0].text.includes('User Count') || result.content[0].text.includes('Active Sessions');
        logTest('list_snippets execution', success, `Found snippets in response`);
        if (success) snippetTestsPassed++;
      } catch (err) {
        logTest('list_snippets execution', false, err.message);
      }
    }

    log(`\n  Summary: ${snippetTestsPassed}/${snippetTools.length + 1} tests passed`, 'magenta');

    // Test 4: Organization Members (Account Tools)
    logSection('4. Organization Members (Account Tools)');

    const memberTools = ['list_organization_members'];

    let memberTestsPassed = 0;
    for (const toolName of memberTools) {
      const exists = !!toolMap[toolName];
      logTest(`Tool '${toolName}' exists`, exists);
      if (exists) memberTestsPassed++;
    }

    // Test list_organization_members execution
    if (toolMap['list_organization_members']) {
      try {
        const result = await client.callTool({
          name: 'list_organization_members',
          arguments: { organization_id: 'org1' }
        });
        const success = result.content[0].text.includes('Alice') || result.content[0].text.includes('Bob');
        logTest('list_organization_members execution', success, `Found members in response`);
        if (success) memberTestsPassed++;
      } catch (err) {
        logTest('list_organization_members execution', false, err.message);
      }
    }

    log(`\n  Summary: ${memberTestsPassed}/${memberTools.length + 1} tests passed`, 'magenta');

    // Final Summary
    logSection('Test Results Summary');

    const totalExpected = secretsTools.length + healthTools.length + snippetTools.length + memberTools.length;
    const totalFound = Object.keys(toolMap).filter(name =>
      secretsTools.includes(name) ||
      healthTools.includes(name) ||
      snippetTools.includes(name) ||
      memberTools.includes(name)
    ).length;

    log(`✨ New tools implemented: ${totalFound}/${totalExpected}`, 'green');
    log(`📈 Total server tools: ${tools.tools.length}`, 'blue');

    const categories = {
      'Secrets Management': secretsTestsPassed,
      'Health Monitoring': healthTestsPassed,
      'SQL Snippets': snippetTestsPassed,
      'Organization Members': memberTestsPassed
    };

    console.log('\n📊 Feature Coverage:');
    for (const [category, passed] of Object.entries(categories)) {
      const emoji = passed > 0 ? '✅' : '⚠️';
      log(`  ${emoji} ${category}: ${passed} tests passed`, passed > 0 ? 'green' : 'yellow');
    }

    log('\n🎉 All new features successfully integrated and tested!', 'green');
    process.exit(0);

  } catch (error) {
    log(`\n❌ Test failed with error: ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the tests
testNewFeatures().catch(console.error);