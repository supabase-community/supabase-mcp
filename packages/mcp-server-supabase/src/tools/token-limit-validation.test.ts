/**
 * Token limit validation tests - ensures all tools stay under 25k token limit
 * This addresses the core problem where tools fail with "tokens exceeds maximum allowed tokens (25000)"
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDevelopmentTools } from './development-tools.js';
import { getDatabaseTools } from './database-operation-tools.js';
import { getDebuggingTools } from './debugging-tools.js';
import type { DevelopmentOperations, DatabaseOperations, DebuggingOperations } from '../platform/types.js';

// Import the real response processing to test actual chunking behavior
import { processResponse, RESPONSE_CONFIGS } from '../response/index.js';

// Track processed responses for analysis
let lastProcessedResponse: any = null;
let lastContext: string = '';

// Create a spy on processResponse to capture inputs while using real implementation
const processResponseSpy = vi.fn().mockImplementation((data, context, config) => {
  lastProcessedResponse = data;
  lastContext = context;
  // Use the real processResponse function
  return processResponse(data, context, config);
});

// Utility to estimate token count (approximately 4 characters per token)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Large test data that could potentially trigger the 25k token limit
const LARGE_TYPESCRIPT_TYPES = `
export interface Database {
  public: {
    Tables: {
      ${Array.from({ length: 50 }, (_, i) => `
      table_${i}: {
        Row: { ${Array.from({ length: 20 }, (_, j) => `field_${j}: string;`).join(' ')} }
        Insert: { ${Array.from({ length: 20 }, (_, j) => `field_${j}?: string;`).join(' ')} }
        Update: { ${Array.from({ length: 20 }, (_, j) => `field_${j}?: string;`).join(' ')} }
      }`).join('')}
    }
    Views: {
      ${Array.from({ length: 25 }, (_, i) => `
      view_${i}: {
        Row: { ${Array.from({ length: 15 }, (_, j) => `view_field_${j}: string;`).join(' ')} }
      }`).join('')}
    }
    Enums: {
      ${Array.from({ length: 20 }, (_, i) => `enum_${i}: ${Array.from({ length: 5 }, (_, j) => `'value_${j}'`).join(' | ')}`).join('\n      ')}
    }
  }
  auth: {
    Tables: {
      ${Array.from({ length: 15 }, (_, i) => `
      auth_table_${i}: {
        Row: { ${Array.from({ length: 12 }, (_, j) => `auth_field_${j}: string;`).join(' ')} }
        Insert: { ${Array.from({ length: 12 }, (_, j) => `auth_field_${j}?: string;`).join(' ')} }
        Update: { ${Array.from({ length: 12 }, (_, j) => `auth_field_${j}?: string;`).join(' ')} }
      }`).join('')}
    }
  }
}`.repeat(3); // Repeat to make it very large

const LARGE_TABLE_LIST = Array.from({ length: 200 }, (_, i) => ({
  id: i + 1,
  schema: i % 3 === 0 ? 'auth' : 'public',
  name: `table_${i}`,
  rls_enabled: i % 2 === 0,
  rls_forced: false,
  replica_identity: 'DEFAULT',
  bytes: 1024 * (i + 1),
  size: `${i + 1} kB`,
  live_rows_estimate: (i + 1) * 100,
  dead_rows_estimate: (i + 1) * 5,
  comment: `Table ${i} for testing large responses with many tables and detailed information`,
  columns: Array.from({ length: 15 }, (_, j) => ({
    id: `${i + 1}.${j + 1}`,
    table: `table_${i}`,
    table_id: i + 1,
    schema: i % 3 === 0 ? 'auth' : 'public',
    name: `column_${j}`,
    data_type: j % 4 === 0 ? 'text' : j % 4 === 1 ? 'bigint' : j % 4 === 2 ? 'boolean' : 'timestamp',
    format: j % 4 === 0 ? 'text' : j % 4 === 1 ? 'int8' : j % 4 === 2 ? 'bool' : 'timestamptz',
    ordinal_position: j + 1,
    default_value: j === 0 ? `nextval('table_${i}_id_seq'::regclass)` : null,
    is_identity: j === 0,
    identity_generation: j === 0 ? 'BY DEFAULT' : null,
    is_generated: false,
    is_nullable: j !== 0,
    is_updatable: true,
    is_unique: j === 0,
    check: null,
    comment: `Column ${j} of table ${i}`,
    enums: [],
  })),
  primary_keys: [{
    schema: i % 3 === 0 ? 'auth' : 'public',
    table_name: `table_${i}`,
    name: `table_${i}_pkey`,
    table_id: i + 1,
  }],
  relationships: i % 5 === 0 ? [{
    id: i,
    constraint_name: `fk_table_${i}_ref`,
    source_schema: 'public',
    source_table_name: `table_${i}`,
    source_column_name: 'ref_id',
    target_table_schema: 'public',
    target_table_name: 'users',
    target_column_name: 'id',
  }] : [],
}));

const LARGE_LOG_ENTRIES = Array.from({ length: 1000 }, (_, i) => ({
  timestamp: new Date(Date.now() - i * 1000).toISOString(),
  level: ['error', 'warn', 'info', 'debug'][i % 4],
  msg: `Log entry ${i} with detailed information about the application state and execution context. This message contains multiple pieces of information including timestamps, user IDs, request details, and performance metrics.`,
  service: ['api', 'postgres', 'auth', 'storage', 'edge-function'][i % 5],
  user_id: `user_${i % 100}`,
  request_id: `req_${i}`,
  duration_ms: i * 10 + 50,
  memory_usage: `${(i % 100) + 10}MB`,
  details: {
    endpoint: `/api/v1/endpoint/${i}`,
    method: ['GET', 'POST', 'PUT', 'DELETE'][i % 4],
    status_code: i % 10 === 0 ? 500 : i % 5 === 0 ? 404 : 200,
    response_size: i * 1024,
    client_ip: `192.168.1.${(i % 254) + 1}`,
    user_agent: 'Mozilla/5.0 (compatible; TestAgent/1.0)',
  },
}));

describe('Token Limit Validation Tests', () => {
  let mockDevelopmentOps: DevelopmentOperations;
  let mockDatabaseOps: DatabaseOperations;
  let mockDebuggingOps: DebuggingOperations;
  let developmentTools: ReturnType<typeof getDevelopmentTools>;
  let databaseTools: ReturnType<typeof getDatabaseTools>;
  let debuggingTools: ReturnType<typeof getDebuggingTools>;

  beforeEach(() => {
    // Set up mocks with large data that could trigger 25k token limit
    mockDevelopmentOps = {
      getProjectUrl: vi.fn().mockResolvedValue('https://api.supabase.co'),
      getAnonKey: vi.fn().mockResolvedValue('sb-anon-key'),
      generateTypescriptTypes: vi.fn().mockResolvedValue({ types: LARGE_TYPESCRIPT_TYPES }),
    };

    mockDatabaseOps = {
      executeSql: vi.fn().mockResolvedValue(LARGE_TABLE_LIST),
      listMigrations: vi.fn().mockResolvedValue([]),
      applyMigration: vi.fn().mockResolvedValue({}),
      listSnippets: vi.fn().mockResolvedValue([]),
      getSnippet: vi.fn().mockResolvedValue({}),
    };

    mockDebuggingOps = {
      getLogs: vi.fn().mockResolvedValue(LARGE_LOG_ENTRIES),
      getSecurityAdvisors: vi.fn().mockResolvedValue([]),
      getPerformanceAdvisors: vi.fn().mockResolvedValue([]),
      getProjectHealth: vi.fn().mockResolvedValue({}),
      getUpgradeStatus: vi.fn().mockResolvedValue({}),
      checkUpgradeEligibility: vi.fn().mockResolvedValue({}),
    };

    developmentTools = getDevelopmentTools({
      development: mockDevelopmentOps,
      projectId: 'test-project',
    });

    databaseTools = getDatabaseTools({
      database: mockDatabaseOps,
      projectId: 'test-project',
    });

    debuggingTools = getDebuggingTools({
      debugging: mockDebuggingOps,
      projectId: 'test-project',
    });

    lastProcessedResponse = null;
    lastContext = '';
    vi.clearAllMocks();
  });

  describe('Development Tools Token Limits', () => {
    test('generate_typescript_types with small response size stays under token limit', async () => {
      const result = await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: ['public'],
        table_filter: 'user*',
        include_views: false,
        include_enums: false,
        max_response_size: 'small',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(2500); // Should be well under conservative limit
    });

    test('generate_typescript_types with medium response size stays under token limit', async () => {
      const result = await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_views: true,
        include_enums: true,
        max_response_size: 'medium',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(5000); // Should be under standard limit
    });

    test('generate_typescript_types with large response size stays under token limit', async () => {
      const result = await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'large',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(10000); // Should be under permissive limit
    });

    test('generate_typescript_types_summary stays under conservative token limit', async () => {
      const result = await developmentTools.generate_typescript_types_summary.execute({
        project_id: 'test-project',
        include_counts: true,
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(2500); // Should be well under conservative limit
    });
  });

  describe('Database Tools Token Limits', () => {
    test('list_tables with names_only format stays under token limit', async () => {
      const result = await databaseTools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        response_format: 'names_only',
        include_columns: false,
        include_relationships: false,
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(5000); // Should be well under limit for names only
    });

    test('list_tables with summary format stays under token limit', async () => {
      const result = await databaseTools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        response_format: 'summary',
        include_columns: false,
        include_relationships: false,
        table_name_pattern: 'user*',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(8000); // Should be under reasonable limit
    });

    test('execute_sql with auto-limit prevents large responses', async () => {
      // Mock large SQL result
      const largeSqlResult = Array.from({ length: 500 }, (_, i) => ({
        id: i,
        name: `Record ${i}`,
        description: `This is a detailed description for record ${i} containing lots of text that could contribute to a large response`,
        data: { complex: 'object', with: 'nested', properties: i },
      }));
      vi.mocked(mockDatabaseOps.executeSql).mockResolvedValueOnce(largeSqlResult);

      const result = await databaseTools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT * FROM large_table',
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);

      // Verify auto-limit was applied
      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: expect.stringContaining('LIMIT 25'),
        read_only: false,
      });
    });
  });

  describe('Debugging Tools Token Limits', () => {
    test('get_logs with compact format stays under token limit', async () => {
      const result = await debuggingTools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '5min',
        log_level_filter: 'all',
        max_entries: 50,
        response_format: 'compact',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(5000); // Should be under standard limit
    });

    test('get_logs with errors_only format stays under conservative token limit', async () => {
      const result = await debuggingTools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1min',
        log_level_filter: 'error',
        max_entries: 20,
        response_format: 'errors_only',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
      expect(tokenCount).toBeLessThan(2500); // Should be well under conservative limit
    });

    test('get_logs with search pattern limits response size', async () => {
      const result = await debuggingTools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '15min',
        log_level_filter: 'all',
        search_pattern: 'very_specific_pattern_that_matches_few_logs',
        max_entries: 100,
        response_format: 'detailed',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);
    });
  });

  describe('Stress Testing with Maximum Parameters', () => {
    test('largest possible generate_typescript_types response stays under limit', async () => {
      const result = await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined, // All schemas
        table_filter: undefined, // No filtering
        include_views: true,
        include_enums: true,
        max_response_size: 'large',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);

      // Log token count for analysis
      console.log(`Largest TypeScript types response: ${tokenCount} tokens`);
    });

    test('largest possible list_tables response stays under limit', async () => {
      const result = await databaseTools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public', 'auth'],
        include_columns: true,
        include_relationships: true,
        response_format: 'detailed',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);

      // Log token count for analysis
      console.log(`Largest list_tables response: ${tokenCount} tokens`);
    });

    test('largest possible get_logs response stays under limit', async () => {
      const result = await debuggingTools.get_logs.execute({
        project_id: 'test-project',
        service: 'api',
        time_window: '1hour',
        log_level_filter: 'all',
        max_entries: 500, // Maximum allowed
        response_format: 'detailed',
      });

      const tokenCount = estimateTokens(result);
      expect(tokenCount).toBeLessThan(25000);

      // Log token count for analysis
      console.log(`Largest get_logs response: ${tokenCount} tokens`);
    });
  });

  describe('Response Processing Effectiveness', () => {
    test('processResponse is being called with appropriate configs', async () => {
      await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        max_response_size: 'small',
      });

      // Verify that processResponse was called and handled the large data
      expect(lastProcessedResponse).toBeDefined();
      expect(lastContext).toContain('TypeScript types generated');

      // The processed response should be significantly smaller than the original
      const originalSize = LARGE_TYPESCRIPT_TYPES.length;
      const processedSize = JSON.stringify(lastProcessedResponse).length;
      expect(processedSize).toBeLessThan(originalSize);
    });

    test('filtering parameters effectively reduce response size', async () => {
      // Test without filtering
      await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        max_response_size: 'large',
      });
      const unfiltered = JSON.stringify(lastProcessedResponse).length;

      // Test with filtering
      await developmentTools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: ['public'],
        table_filter: 'user*',
        include_views: false,
        include_enums: false,
        max_response_size: 'small',
      });
      const filtered = JSON.stringify(lastProcessedResponse).length;

      expect(filtered).toBeLessThan(unfiltered);
      expect(filtered).toBeLessThan(unfiltered * 0.5); // At least 50% reduction
    });
  });
});