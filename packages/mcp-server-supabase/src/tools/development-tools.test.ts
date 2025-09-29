/**
 * Tests for enhanced development tools with response management
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDevelopmentTools } from './development-tools.js';
import type { DevelopmentOperations } from '../platform/types.js';
import { limitResponseSize } from '../response/index.js';

// Mock the response processing
vi.mock('../response/index.js', () => ({
  limitResponseSize: vi.fn((data, context, config) => {
    // Simulate the simple limiter behavior
    const jsonStr = JSON.stringify(data, null, 2);
    const tokens = Math.ceil(jsonStr.length / 4);
    const maxTokens = config?.maxTokens || 20000;

    if (tokens > maxTokens) {
      return `${context} (response size reduced from ~${tokens} to ~${maxTokens} tokens)\n\n${jsonStr.substring(0, maxTokens * 4)}...`;
    }
    return `${context}\n\n${jsonStr}`;
  }),
}));

describe('Enhanced Development Tools', () => {
  let mockDevelopmentOps: DevelopmentOperations;
  let tools: ReturnType<typeof getDevelopmentTools>;

  // Mock TypeScript types response (simulating large response)
  const mockLargeTypesResponse = {
    types: `
export interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; email: string; name: string; }
        Insert: { id?: string; email: string; name: string; }
        Update: { id?: string; email?: string; name?: string; }
      }
      auth_users: {
        Row: { id: string; email: string; role: string; }
        Insert: { id?: string; email: string; role: string; }
        Update: { id?: string; email?: string; role?: string; }
      }
      posts: {
        Row: { id: string; title: string; content: string; user_id: string; }
        Insert: { id?: string; title: string; content: string; user_id: string; }
        Update: { id?: string; title?: string; content?: string; user_id?: string; }
      }
    }
    Views: {
      user_posts: {
        Row: { user_name: string; post_title: string; post_content: string; }
      }
    }
    Enums: {
      user_role: 'admin' | 'user' | 'moderator'
    }
  }
  auth: {
    Tables: {
      auth_tokens: {
        Row: { id: string; token: string; user_id: string; }
        Insert: { id?: string; token: string; user_id: string; }
        Update: { id?: string; token?: string; user_id?: string; }
      }
    }
  }
}
`.repeat(10), // Make it large enough to trigger chunking
  };

  beforeEach(() => {
    mockDevelopmentOps = {
      getProjectUrl: vi.fn().mockResolvedValue('https://api.supabase.co'),
      getAnonKey: vi.fn().mockResolvedValue('sb-anon-key'),
      generateTypescriptTypes: vi.fn().mockResolvedValue(mockLargeTypesResponse),
    };

    tools = getDevelopmentTools({
      development: mockDevelopmentOps,
      projectId: 'test-project',
    });
  });

  describe('generate_typescript_types', () => {
    test('should handle schema filtering', async () => {
      const result = await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: ['public'],
        table_filter: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'medium',
      });

      expect(mockDevelopmentOps.generateTypescriptTypes).toHaveBeenCalledWith('test-project');
      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.objectContaining({ types: expect.stringContaining('public') }),
        expect.stringContaining('TypeScript types generated for schemas: public'),
        { maxTokens: 12000 } // medium size default
      );
    });

    test('should handle table filtering', async () => {
      const result = await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: 'user*',
        include_views: true,
        include_enums: true,
        max_response_size: 'medium',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.objectContaining({
          types: expect.stringMatching(/users|auth_users/)
        }),
        expect.stringContaining('(filtered: user*)'),
        { maxTokens: 12000 } // medium size default
      );
    });

    test('should exclude views when requested', async () => {
      const result = await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: undefined,
        include_views: false,
        include_enums: true,
        max_response_size: 'medium',
      });

      // The processed result should not contain view-related content
      const allCalls = vi.mocked(limitResponseSize).mock.calls;
      const processedCall = allCalls[allCalls.length - 1]; // Get the last call
      const processedTypes = processedCall[0].types;
      expect(processedTypes).not.toMatch(/Views:/);
      expect(processedTypes).not.toMatch(/user_posts/);
    });

    test('should exclude enums when requested', async () => {
      const result = await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: undefined,
        include_views: true,
        include_enums: false,
        max_response_size: 'medium',
      });

      const allCalls = vi.mocked(limitResponseSize).mock.calls;
      const processedCall = allCalls[allCalls.length - 1]; // Get the last call
      const processedTypes = processedCall[0].types;
      expect(processedTypes).not.toMatch(/Enums:/);
      expect(processedTypes).not.toMatch(/user_role/);
    });

    test('should use correct response config for small size', async () => {
      await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'small',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        { maxTokens: 5000 } // small size
      );
    });

    test('should use correct response config for large size', async () => {
      await tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'large',
      });

      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        { maxTokens: 18000 } // large size
      );
    });
  });

  describe('generate_typescript_types_summary', () => {
    test('should generate summary without full types', async () => {
      const result = await tools.generate_typescript_types_summary.execute({
        project_id: 'test-project',
        include_counts: true,
      });

      expect(mockDevelopmentOps.generateTypescriptTypes).toHaveBeenCalledWith('test-project');
      expect(limitResponseSize).toHaveBeenCalledWith(
        expect.objectContaining({
          schemas: expect.arrayContaining([
            expect.objectContaining({
              name: expect.any(String),
              table_count: expect.any(Number),
              view_count: expect.any(Number),
              enum_count: expect.any(Number),
            }),
          ]),
          total_types: expect.any(Number),
        }),
        expect.stringContaining('TypeScript types summary'),
        { maxTokens: 3000 } // summary tool uses 3000
      );
    });

    test('should include detailed arrays when include_counts is false', async () => {
      const result = await tools.generate_typescript_types_summary.execute({
        project_id: 'test-project',
        include_counts: false,
      });

      const allCalls = vi.mocked(limitResponseSize).mock.calls;
      const processedCall = allCalls[allCalls.length - 1]; // Get the last call
      const summary = processedCall[0];

      // Should include arrays of table/view/enum names
      expect(summary.schemas[0]).toHaveProperty('tables');
      expect(summary.schemas[0]).toHaveProperty('views');
      expect(summary.schemas[0]).toHaveProperty('enums');
    });
  });

  describe('existing tools', () => {
    test('get_project_url should work unchanged', async () => {
      const result = await tools.get_project_url.execute({
        project_id: 'test-project',
      });

      expect(mockDevelopmentOps.getProjectUrl).toHaveBeenCalledWith('test-project');
      expect(result).toBe('https://api.supabase.co');
    });

    test('get_anon_key should work unchanged', async () => {
      const result = await tools.get_anon_key.execute({
        project_id: 'test-project',
      });

      expect(mockDevelopmentOps.getAnonKey).toHaveBeenCalledWith('test-project');
      expect(result).toBe('sb-anon-key');
    });
  });

  describe('parameter validation', () => {
    test('should handle undefined optional parameters', async () => {
      // Test that undefined optional parameters don't cause issues
      await expect(tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: undefined,
        table_filter: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'medium',
      })).resolves.toBeDefined();
    });

    test('should handle empty schemas array', async () => {
      await expect(tools.generate_typescript_types.execute({
        project_id: 'test-project',
        schemas: [],
        table_filter: undefined,
        include_views: true,
        include_enums: true,
        max_response_size: 'medium',
      })).resolves.toBeDefined();
    });
  });
});