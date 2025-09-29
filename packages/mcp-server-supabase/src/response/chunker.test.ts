/**
 * Tests for the response chunking system
 */

import { describe, test, expect } from 'vitest';
import { chunkResponse, DEFAULT_CHUNKING_CONFIG } from './chunker.js';
import { analyzeResponse } from './analyzer.js';
import { processResponse, RESPONSE_CONFIGS } from './manager.js';

describe('Response Chunking System', () => {
  describe('analyzeResponse', () => {
    test('should analyze small responses correctly', () => {
      const data = { id: 1, name: 'test' };
      const analysis = analyzeResponse(data, DEFAULT_CHUNKING_CONFIG);

      expect(analysis.shouldChunk).toBe(false);
      expect(analysis.responseType).toBe('object');
      expect(analysis.complexity).toBeGreaterThan(0);
    });

    test('should detect large arrays need chunking', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: 'A test item with some content to make it larger',
      }));

      const analysis = analyzeResponse(data, DEFAULT_CHUNKING_CONFIG);

      expect(analysis.shouldChunk).toBe(true);
      expect(analysis.responseType).toBe('array');
      expect(analysis.arrayItemCount).toBe(100);
    });

    test('should handle complex nested objects', () => {
      const data = {
        tables: Array.from({ length: 50 }, (_, i) => ({
          id: i,
          name: `table_${i}`,
          columns: Array.from({ length: 20 }, (_, j) => ({
            name: `column_${j}`,
            type: 'varchar',
            nullable: true,
            default: null,
          })),
          relationships: [],
        })),
      };

      const analysis = analyzeResponse(data, DEFAULT_CHUNKING_CONFIG);

      expect(analysis.shouldChunk).toBe(true);
      expect(analysis.complexity).toBeGreaterThan(0.5);
    });
  });

  describe('chunkResponse', () => {
    test('should not chunk small responses', () => {
      const data = { message: 'Hello world' };
      const result = chunkResponse(data, DEFAULT_CHUNKING_CONFIG);

      expect(result.strategy).toBe('none');
      expect(result.result.data).toEqual(data);
      expect(result.result.warnings).toBeUndefined();
    });

    test('should chunk large arrays', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
      const result = chunkResponse(data, DEFAULT_CHUNKING_CONFIG);

      expect(result.strategy).toBe('array_pagination');
      expect(Array.isArray(result.result.data)).toBe(true);
      expect((result.result.data as any[]).length).toBeLessThan(data.length);
      expect(result.result.metadata.has_more).toBe(true);
    });

    test('should handle errors gracefully', () => {
      // Create a problematic object that might cause JSON.stringify issues
      const data: any = {};
      data.circular = data; // Circular reference

      const result = chunkResponse(data, DEFAULT_CHUNKING_CONFIG);

      // With our error handling, it should either work or fallback to truncation
      expect(['none', 'truncation']).toContain(result.strategy);
      expect(result.result).toBeDefined();
    });
  });

  describe('processResponse', () => {
    test('should format simple responses', () => {
      const data = { id: 1, name: 'test' };
      const result = processResponse(data, 'Test context');

      expect(result).toContain('Test context');
      expect(result).toContain(JSON.stringify(data, null, 2));
    });

    test('should format chunked responses with metadata', () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        data: 'some content to make this larger'.repeat(10),
      }));

      const result = processResponse(
        data,
        'Large dataset',
        RESPONSE_CONFIGS.DATABASE_RESULTS
      );

      expect(result).toContain('Response Summary');
      expect(result).toContain('Important Notes');
      expect(result).toContain('Getting More Data');
    });

    test('should handle database-style responses', () => {
      const tables = [
        {
          schema: 'public',
          name: 'users',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'email', type: 'varchar', nullable: false },
            { name: 'created_at', type: 'timestamp', nullable: false },
          ],
          rows: 1500,
          foreign_key_constraints: [],
        },
        {
          schema: 'public',
          name: 'posts',
          columns: [
            { name: 'id', type: 'integer', nullable: false },
            { name: 'user_id', type: 'integer', nullable: false },
            { name: 'title', type: 'varchar', nullable: false },
            { name: 'content', type: 'text', nullable: true },
            { name: 'created_at', type: 'timestamp', nullable: false },
          ],
          rows: 5000,
          foreign_key_constraints: [
            {
              name: 'fk_posts_user',
              source: 'public.posts.user_id',
              target: 'public.users.id',
            },
          ],
        },
      ];

      // Create many tables to trigger chunking with more verbose data
      const baseTable = tables[0]!; // Use non-null assertion since we know it exists
      const manyTables = Array.from({ length: 100 }, (_, i) => ({
        ...baseTable,
        name: `table_${i}`,
        columns: baseTable.columns.map((col) => ({
          ...col,
          description: `This is a column description that adds more content to make the response larger. Column ${col.name} in table ${i}.`,
        })),
        comment: `This is table ${i} with a long comment that explains what this table does and why it exists in the database schema.`,
      }));

      // Use more conservative config to ensure chunking happens
      const smallConfig = {
        ...RESPONSE_CONFIGS.DATABASE_RESULTS,
        maxTokens: 1000,
        maxCharacters: 4000,
        maxArrayItems: 20,
      };

      const result = processResponse(
        manyTables,
        'Database tables',
        smallConfig
      );

      expect(result).toContain('Database tables');
      expect(result).toContain('Response Summary');
      // Should contain structured data, not just raw JSON
      expect(result).toContain('```json');
    });
  });

  describe('Error handling', () => {
    test('should handle null and undefined data', () => {
      expect(() => processResponse(null)).not.toThrow();
      expect(() => processResponse(undefined)).not.toThrow();
    });

    test('should handle extremely large responses', () => {
      const massiveArray = Array.from({ length: 10000 }, (_, i) => ({
        id: i,
        data: 'x'.repeat(1000), // 1KB per item = ~10MB total
      }));

      const result = processResponse(massiveArray, 'Massive dataset');

      expect(result).toBeDefined();
      expect(result).toContain('Response Summary');
    });
  });
});
