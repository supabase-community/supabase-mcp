/**
 * Tests for enhanced database operation tools with auto-LIMIT and response management
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDatabaseTools } from './database-operation-tools.js';
import type { DatabaseOperations } from '../platform/types.js';
import { limitResponseSize } from '../response/index.js';
import { listTablesSql } from '../pg-meta/index.js';

// Mock the response processing
vi.mock('../response/index.js', () => ({
  limitResponseSize: vi.fn((data, context, config) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const tokens = Math.ceil(jsonStr.length / 4);
    const maxTokens = config?.maxTokens || 20000;

    if (tokens > maxTokens) {
      return `${context} (response size reduced from ~${tokens} to ~${maxTokens} tokens)\n\n${jsonStr.substring(0, maxTokens * 4)}...`;
    }
    return `${context}\n\n${jsonStr}`;
  }),
}));

// Mock pg-meta
vi.mock('../pg-meta/index.js', () => ({
  listTablesSql: vi.fn((schemas) => `SELECT * FROM tables WHERE schema IN ('${schemas.join('\', \'')}')`),
}));

describe('Enhanced Database Operation Tools', () => {
  let mockDatabaseOps: DatabaseOperations;
  let tools: ReturnType<typeof getDatabaseTools>;

  beforeEach(() => {
    mockDatabaseOps = {
      executeSql: vi.fn().mockResolvedValue([{ sum: 2 }]),
      applyMigration: vi.fn().mockResolvedValue({ success: true }),
    };

    tools = getDatabaseTools({
      database: mockDatabaseOps,
      projectId: 'test-project',
      readOnly: false,
    });

    // Clear mocks
    vi.clearAllMocks();
  });

  describe('execute_sql auto-LIMIT injection', () => {
    test('should add LIMIT to SELECT * queries', async () => {
      const result = await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT * FROM users',
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      // Check that the query was modified with LIMIT
      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users LIMIT 25;',
        read_only: false,
      });

      // Check that warnings were included
      expect(result).toContain('⚠️ Query Modifications:');
      expect(result).toContain('Query may return large result set. Auto-applying LIMIT 25.');
      expect(result).toContain('Original query modified. Use disable_auto_limit=true to override.');
    });

    test('should add LIMIT to SELECT with JOINs', async () => {
      const query = 'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 50,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id LIMIT 50;',
        read_only: false,
      });
    });

    test('should add LIMIT after ORDER BY clause', async () => {
      const query = 'SELECT * FROM users ORDER BY created_at DESC';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 10,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users ORDER BY created_at DESC LIMIT 10',
        read_only: false,
      });
    });

    test('should not modify queries that already have LIMIT', async () => {
      const query = 'SELECT * FROM users LIMIT 100';

      const result = await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users LIMIT 100',
        read_only: false,
      });

      expect(result).not.toContain('⚠️ Query Modifications:');
    });

    test('should not modify non-SELECT queries', async () => {
      const queries = [
        'INSERT INTO users (name) VALUES (\'test\')',
        'UPDATE users SET name = \'updated\' WHERE id = 1',
        'DELETE FROM users WHERE id = 1',
        'CREATE TABLE test (id SERIAL PRIMARY KEY)',
      ];

      for (const query of queries) {
        await tools.execute_sql.execute({
          project_id: 'test-project',
          query,
          auto_limit: 25,
          disable_auto_limit: false,
          response_size: 'medium',
        });

        expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
          query: query.trim(),
          read_only: false,
        });
      }
    });

    test('should not modify queries when disable_auto_limit is true', async () => {
      const query = 'SELECT * FROM users';

      const result = await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: true,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users',
        read_only: false,
      });

      expect(result).not.toContain('⚠️ Query Modifications:');
    });

    test('should not add warnings for SELECT with WHERE clause and no risky patterns', async () => {
      const query = 'SELECT name, email FROM users WHERE active = true';

      const result = await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT name, email FROM users WHERE active = true LIMIT 25;',
        read_only: false,
      });

      // Should still modify and warn about the modification, but not about large result set
      expect(result).toContain('Original query modified');
      expect(result).not.toContain('Query may return large result set');
    });

    test('should use custom auto_limit value', async () => {
      await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT * FROM users',
        auto_limit: 100,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users LIMIT 100;',
        read_only: false,
      });
    });
  });

  describe('response size management', () => {
    test('should use CONSERVATIVE config for small response size', async () => {
      await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT id FROM users',
        auto_limit: 25,
        disable_auto_limit: true,
        response_size: 'small',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [{ sum: 2 }],
        'SQL query result',
        { maxTokens: 2000 } // small size for execute_sql
      );
    });

    test('should use PERMISSIVE config for large response size', async () => {
      await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT id FROM users',
        auto_limit: 25,
        disable_auto_limit: true,
        response_size: 'large',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [{ sum: 2 }],
        'SQL query result',
        { maxTokens: 8000 } // large size for execute_sql
      );
    });

    test('should use DATABASE_RESULTS config for medium response size', async () => {
      await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT id FROM users',
        auto_limit: 25,
        disable_auto_limit: true,
        response_size: 'medium',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [{ sum: 2 }],
        'SQL query result',
        { maxTokens: 5000 } // medium size for SQL results
      );
    });

    test('should include auto-limited context when warnings present', async () => {
      await tools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT * FROM users',
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        [{ sum: 2 }],
        'SQL query result (auto-limited)',
        { maxTokens: 5000 } // medium size for SQL results
      );
    });
  });

  describe('edge cases and validation', () => {
    test('should handle queries with semicolons correctly', async () => {
      const query = 'SELECT * FROM users;';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users LIMIT 25;',
        read_only: false,
      });
    });

    test('should handle queries with mixed case', async () => {
      const query = 'select * from Users WHERE id > 10';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'select * from Users WHERE id > 10 LIMIT 25;',
        read_only: false,
      });
    });

    test('should handle complex ORDER BY clauses', async () => {
      const query = 'SELECT * FROM users ORDER BY created_at DESC, name ASC';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users ORDER BY created_at DESC, name ASC LIMIT 25',
        read_only: false,
      });
    });

    test('should handle subqueries correctly (not modify them)', async () => {
      const query = 'SELECT (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count FROM users u';

      await tools.execute_sql.execute({
        project_id: 'test-project',
        query,
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count FROM users u LIMIT 25;',
        read_only: false,
      });
    });
  });

  describe('read-only mode', () => {
    test('should pass read-only flag to database operation', async () => {
      const readOnlyTools = getDatabaseTools({
        database: mockDatabaseOps,
        projectId: 'test-project',
        readOnly: true,
      });

      await readOnlyTools.execute_sql.execute({
        project_id: 'test-project',
        query: 'SELECT * FROM users',
        auto_limit: 25,
        disable_auto_limit: false,
        response_size: 'medium',
      });

      expect(mockDatabaseOps.executeSql).toHaveBeenCalledWith('test-project', {
        query: 'SELECT * FROM users LIMIT 25;',
        read_only: true,
      });
    });
  });

  describe('list_tables filtering and response management', () => {
    const mockTablesData = [
      {
        id: 1,
        schema: 'public',
        name: 'users',
        rls_enabled: true,
        rls_forced: false,
        replica_identity: 'DEFAULT',
        bytes: 102400,
        size: '100 kB',
        live_rows_estimate: 1500,
        dead_rows_estimate: 10,
        comment: 'User accounts table',
        columns: [
          {
            id: '1.1',
            table: 'users',
            table_id: 1,
            schema: 'public',
            name: 'id',
            data_type: 'bigint',
            format: 'int8',
            ordinal_position: 1,
            default_value: 'nextval(\'users_id_seq\'::regclass)',
            is_identity: true,
            identity_generation: 'BY DEFAULT',
            is_generated: false,
            is_nullable: false,
            is_updatable: true,
            is_unique: true,
            check: null,
            comment: null,
            enums: [],
          },
          {
            id: '1.2',
            table: 'users',
            table_id: 1,
            schema: 'public',
            name: 'email',
            data_type: 'text',
            format: 'text',
            ordinal_position: 2,
            default_value: null,
            is_identity: false,
            identity_generation: null,
            is_generated: false,
            is_nullable: false,
            is_updatable: true,
            is_unique: true,
            check: null,
            comment: 'User email address',
            enums: [],
          },
        ],
        primary_keys: [{
          schema: 'public',
          table_name: 'users',
          name: 'users_pkey',
          table_id: 1,
        }],
        relationships: [
          {
            id: 1,
            constraint_name: 'fk_user_profile',
            source_schema: 'public',
            source_table_name: 'profiles',
            source_column_name: 'user_id',
            target_table_schema: 'public',
            target_table_name: 'users',
            target_column_name: 'id',
          },
        ],
      },
      {
        id: 2,
        schema: 'public',
        name: 'user_logs',
        rls_enabled: false,
        rls_forced: false,
        replica_identity: 'DEFAULT',
        bytes: 5242880,
        size: '5 MB',
        live_rows_estimate: 50000,
        dead_rows_estimate: 100,
        comment: null,
        columns: [
          {
            id: '2.1',
            table: 'user_logs',
            table_id: 2,
            schema: 'public',
            name: 'id',
            data_type: 'bigint',
            format: 'int8',
            ordinal_position: 1,
            default_value: 'nextval(\'user_logs_id_seq\'::regclass)',
            is_identity: true,
            identity_generation: 'BY DEFAULT',
            is_generated: false,
            is_nullable: false,
            is_updatable: true,
            is_unique: true,
            check: null,
            comment: null,
            enums: [],
          },
        ],
        primary_keys: [{
          schema: 'public',
          table_name: 'user_logs',
          name: 'user_logs_pkey',
          table_id: 2,
        }],
        relationships: [],
      },
      {
        id: 3,
        schema: 'auth',
        name: 'auth_users',
        rls_enabled: true,
        rls_forced: true,
        replica_identity: 'DEFAULT',
        bytes: 81920,
        size: '80 kB',
        live_rows_estimate: 100,
        dead_rows_estimate: 5,
        comment: 'Authentication users',
        columns: [
          {
            id: '3.1',
            table: 'auth_users',
            table_id: 3,
            schema: 'auth',
            name: 'id',
            data_type: 'uuid',
            format: 'uuid',
            ordinal_position: 1,
            default_value: 'uuid_generate_v4()',
            is_identity: false,
            identity_generation: null,
            is_generated: false,
            is_nullable: false,
            is_updatable: true,
            is_unique: true,
            check: null,
            comment: null,
            enums: [],
          },
        ],
        primary_keys: [{
          schema: 'auth',
          table_name: 'auth_users',
          name: 'auth_users_pkey',
          table_id: 3,
        }],
        relationships: [],
      },
    ];

    beforeEach(() => {
      vi.mocked(mockDatabaseOps.executeSql).mockResolvedValue(mockTablesData);
    });

    test('should filter tables by name pattern', async () => {
      // Mock data with only public schema tables for this test
      const publicSchemaTablesData = mockTablesData.filter(table => table.schema === 'public');
      vi.mocked(mockDatabaseOps.executeSql).mockResolvedValueOnce(publicSchemaTablesData);

      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        table_name_pattern: 'user*',
        include_columns: true,
        include_relationships: true,
        response_format: 'detailed',
      });

      // Check that listTablesSql was called with correct schemas
      expect(listTablesSql).toHaveBeenCalledWith(['public']);

      // Check that processResponse was called with filtered data
      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      // Should include 'users' and 'user_logs' (both start with 'user')
      expect(processedTables).toHaveLength(2);
      expect(processedTables.map((t: any) => t.name)).toEqual(['users', 'user_logs']);
    });

    test('should filter tables by row count range', async () => {
      // Mock data with only public schema tables for this test
      const publicSchemaTablesData = mockTablesData.filter(table => table.schema === 'public');
      vi.mocked(mockDatabaseOps.executeSql).mockResolvedValueOnce(publicSchemaTablesData);

      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        min_row_count: 1000,
        max_row_count: 10000,
        include_columns: true,
        include_relationships: true,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      // Should only include 'users' (1500 rows) - user_logs has 50000 rows (too many)
      expect(processedTables).toHaveLength(1);
      expect(processedTables[0].name).toBe('users');
    });

    test('should return names_only format', async () => {
      // Mock data with only public schema tables for this test
      const publicSchemaTablesData = mockTablesData.filter(table => table.schema === 'public');
      vi.mocked(mockDatabaseOps.executeSql).mockResolvedValueOnce(publicSchemaTablesData);

      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_columns: true,
        include_relationships: true,
        response_format: 'names_only',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      // Should only include schema, name, and rows
      expect(processedTables[0]).toEqual({
        schema: 'public',
        name: 'users',
        rows: 1500,
      });

      expect(processedTables[0]).not.toHaveProperty('columns');
      expect(processedTables[0]).not.toHaveProperty('relationships');

      // Should use CONSERVATIVE config for names_only
      expect(limitResponseSize).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.stringContaining('(format: names_only)'),
        { maxTokens: 3000 } // names_only
      );
    });

    test('should return summary format', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_columns: true,
        include_relationships: true,
        response_format: 'summary',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      const usersTable = processedTables.find((t: any) => t.name === 'users');
      expect(usersTable).toMatchObject({
        schema: 'public',
        name: 'users',
        rows: 1500,
        column_count: 2,
        has_primary_key: true,
        relationship_count: 1,
        comment: 'User accounts table',
      });

      expect(usersTable).not.toHaveProperty('columns');
      expect(usersTable).not.toHaveProperty('primary_keys');

      // Should use STANDARD config for summary
      expect(limitResponseSize).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.stringContaining('(format: summary)'),
        { maxTokens: 8000 } // summary or medium size
      );
    });

    test('should return detailed format with all data', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_columns: true,
        include_relationships: true,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      const usersTable = processedTables.find((t: any) => t.name === 'users');
      expect(usersTable).toHaveProperty('columns');
      expect(usersTable).toHaveProperty('foreign_key_constraints');
      expect(usersTable.columns).toHaveLength(2);
      expect(usersTable.foreign_key_constraints).toHaveLength(1);

      // Should use DATABASE_RESULTS config for detailed
      expect(limitResponseSize).toHaveBeenLastCalledWith(
        expect.any(Array),
        expect.stringContaining('(format: detailed)'),
        { maxTokens: 5000 } // medium size for SQL results
      );
    });

    test('should exclude columns when include_columns is false', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_columns: false,
        include_relationships: true,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      const usersTable = processedTables.find((t: any) => t.name === 'users');
      expect(usersTable.columns).toBeUndefined();
    });

    test('should exclude relationships when include_relationships is false', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        include_columns: true,
        include_relationships: false,
        response_format: 'detailed',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const processedTables = processedCall[0];

      const usersTable = processedTables.find((t: any) => t.name === 'users');
      expect(usersTable.foreign_key_constraints).toBeUndefined();
    });

    test('should handle multiple schemas', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public', 'auth'],
        include_columns: true,
        include_relationships: true,
        response_format: 'detailed',
      });

      expect(listTablesSql).toHaveBeenCalledWith(['public', 'auth']);

      // Check context message includes both schemas
      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const contextMessage = processedCall[1];

      expect(contextMessage).toContain('public, auth');
    });

    test('should build correct context message with filters', async () => {
      await tools.list_tables.execute({
        project_id: 'test-project',
        schemas: ['public'],
        table_name_pattern: 'user*',
        min_row_count: 100,
        max_row_count: 10000,
        include_columns: true,
        include_relationships: true,
        response_format: 'summary',
      });

      const allCalls = vi.mocked(processResponse).mock.calls;
      const processedCall = allCalls[allCalls.length - 1];
      const contextMessage = processedCall[1];

      expect(contextMessage).toBe(
        'Database tables in schemas: public (filtered: user*) (min rows: 100) (max rows: 10000) (format: summary)'
      );
    });
  });
});