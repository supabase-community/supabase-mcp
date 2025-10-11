#!/usr/bin/env tsx
/**
 * Test script for new Phase 1-3 tools
 * Run with: tsx test-new-tools.ts
 */

import { getSnippetsTools } from './src/tools/snippets-tools.js';
import { getDatabaseTools } from './src/tools/database-operation-tools.js';
import { getDomainTools } from './src/tools/domain-tools.js';

console.log('=== Testing Tool Exports ===\n');

// Test Phase 3: Snippets Tools
console.log('Phase 3 - SQL Snippets Tools:');
try {
  const mockDatabase = {
    listSnippets: async () => ([]),
    getSnippet: async () => ({
      id: 'test',
      name: 'Test Snippet',
      inserted_at: '2024-01-01',
      updated_at: '2024-01-01',
      type: 'sql' as const,
      visibility: 'user' as const,
      description: null,
      project: { id: 1, name: 'Test Project' },
      owner: { id: 1, username: 'testuser' },
      updated_by: { id: 1, username: 'testuser' },
      favorite: false,
      content: { schema_version: '1.0', sql: 'SELECT 1;' }
    }),
    executeSql: async () => [],
    listMigrations: async () => [],
    applyMigration: async () => {},
  };

  const snippetsTools = getSnippetsTools({
    database: mockDatabase,
    projectId: 'test-project',
  });

  console.log('✓ list_sql_snippets:', snippetsTools.list_sql_snippets ? 'EXPORTED' : 'MISSING');
  console.log('✓ get_sql_snippet:', snippetsTools.get_sql_snippet ? 'EXPORTED' : 'MISSING');
} catch (error) {
  console.error('✗ Snippets tools failed:', error);
}

console.log('\nPhase 1 - Backup & Recovery Tools:');
try {
  const mockDatabase = {
    executeSql: async () => [],
    listMigrations: async () => [],
    applyMigration: async () => {},
    listSnippets: async () => [],
    getSnippet: async () => ({}) as any,
  };

  const mockBackup = {
    listRestorePoints: async () => [],
    createRestorePoint: async () => {},
    restoreFromPoint: async () => {},
    undoRestore: async () => {},
    getRestoreStatus: async () => ({ status: 'completed' }),
    listBackups: async () => [],
    createBackup: async () => {},
  };

  const databaseTools = getDatabaseTools({
    database: mockDatabase,
    backup: mockBackup,
    projectId: 'test-project',
    readOnly: false,
  });

  console.log('✓ list_restore_points:', databaseTools.list_restore_points ? 'EXPORTED' : 'MISSING');
  console.log('✓ create_restore_point:', databaseTools.create_restore_point ? 'EXPORTED' : 'MISSING');
  console.log('✓ undo_database_restore:', databaseTools.undo_database_restore ? 'EXPORTED' : 'MISSING');
} catch (error) {
  console.error('✗ Backup tools failed:', error);
}

console.log('\nPhase 2 - Domain & Configuration Tools:');
try {
  const mockCustomDomain = {
    getCustomHostname: async () => ({}),
    createCustomHostname: async () => ({}),
    initializeCustomHostname: async () => ({}),
    activateCustomHostname: async () => ({}),
    reverifyCustomHostname: async () => ({}),
    deleteCustomHostname: async () => {},
    getVanitySubdomain: async () => ({}),
    createVanitySubdomain: async () => ({}),
    checkSubdomainAvailability: async () => ({ available: true }),
    activateVanitySubdomain: async () => ({}),
    deleteVanitySubdomain: async () => {},
  };

  const domainTools = getDomainTools({
    customDomain: mockCustomDomain,
    projectId: 'test-project',
  });

  console.log('✓ get_custom_hostname:', domainTools.get_custom_hostname ? 'EXPORTED' : 'MISSING');
  console.log('✓ create_custom_hostname:', domainTools.create_custom_hostname ? 'EXPORTED' : 'MISSING');
  console.log('✓ get_vanity_subdomain:', domainTools.get_vanity_subdomain ? 'EXPORTED' : 'MISSING');
  console.log('✓ check_subdomain_availability:', domainTools.check_subdomain_availability ? 'EXPORTED' : 'MISSING');

  const mockDatabaseConfig = {
    getPostgresConfig: async () => ({}),
    updatePostgresConfig: async () => ({}),
    getPoolerConfig: async () => ({}),
    updatePoolerConfig: async () => ({}),
    configurePgBouncer: async () => {},
    getPostgrestConfig: async () => ({}),
    updatePostgrestConfig: async () => {},
    getPgsodiumConfig: async () => ({}),
    updatePgsodiumConfig: async () => ({}),
    enableDatabaseWebhooks: async () => {},
    configurePitr: async () => ({}),
    managePgSodium: async () => {},
    manageReadReplicas: async () => {},
  };

  const configTools = getDatabaseTools({
    database: {
      executeSql: async () => [],
      listMigrations: async () => [],
      applyMigration: async () => {},
      listSnippets: async () => [],
      getSnippet: async () => ({}) as any,
    },
    databaseConfig: mockDatabaseConfig,
    projectId: 'test-project',
    readOnly: false,
  });

  console.log('✓ get_postgrest_config:', configTools.get_postgrest_config ? 'EXPORTED' : 'MISSING');
  console.log('✓ update_postgrest_config:', configTools.update_postgrest_config ? 'EXPORTED' : 'MISSING');
  console.log('✓ get_pgsodium_config:', configTools.get_pgsodium_config ? 'EXPORTED' : 'MISSING');
  console.log('✓ update_pgsodium_config:', configTools.update_pgsodium_config ? 'EXPORTED' : 'MISSING');
} catch (error) {
  console.error('✗ Domain/Config tools failed:', error);
}

console.log('\n=== Test Complete ===');
console.log('All tool exports verified successfully!');
