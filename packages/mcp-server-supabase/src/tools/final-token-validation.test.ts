/**
 * Final validation test - confirms all tools actually stay under 25k token limit
 * with the new simple limiter implementation
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { getDevelopmentTools } from './development-tools.js';
import type { DevelopmentOperations } from '../platform/types.js';

// Utility to estimate token count
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Very large TypeScript types that previously caused the 25k token limit error
const MASSIVE_TYPESCRIPT_TYPES = `
export interface Database {
  public: {
    Tables: {
      ${Array.from({ length: 100 }, (_, i) => `
      table_${i}: {
        Row: { ${Array.from({ length: 30 }, (_, j) => `field_${j}: string;`).join(' ')} }
        Insert: { ${Array.from({ length: 30 }, (_, j) => `field_${j}?: string;`).join(' ')} }
        Update: { ${Array.from({ length: 30 }, (_, j) => `field_${j}?: string;`).join(' ')} }
      }`).join('')}
    }
    Views: {
      ${Array.from({ length: 50 }, (_, i) => `
      view_${i}: {
        Row: { ${Array.from({ length: 20 }, (_, j) => `view_field_${j}: string;`).join(' ')} }
      }`).join('')}
    }
    Enums: {
      ${Array.from({ length: 30 }, (_, i) => `enum_${i}: ${Array.from({ length: 8 }, (_, j) => `'value_${j}'`).join(' | ')}`).join('\n      ')}
    }
  }
  auth: {
    Tables: {
      ${Array.from({ length: 50 }, (_, i) => `
      auth_table_${i}: {
        Row: { ${Array.from({ length: 25 }, (_, j) => `auth_field_${j}: string;`).join(' ')} }
        Insert: { ${Array.from({ length: 25 }, (_, j) => `auth_field_${j}?: string;`).join(' ')} }
        Update: { ${Array.from({ length: 25 }, (_, j) => `auth_field_${j}?: string;`).join(' ')} }
      }`).join('')}
    }
    Views: {
      ${Array.from({ length: 25 }, (_, i) => `
      auth_view_${i}: {
        Row: { ${Array.from({ length: 15 }, (_, j) => `auth_view_field_${j}: string;`).join(' ')} }
      }`).join('')}
    }
  }
  storage: {
    Tables: {
      ${Array.from({ length: 20 }, (_, i) => `
      storage_table_${i}: {
        Row: { ${Array.from({ length: 20 }, (_, j) => `storage_field_${j}: string;`).join(' ')} }
        Insert: { ${Array.from({ length: 20 }, (_, j) => `storage_field_${j}?: string;`).join(' ')} }
        Update: { ${Array.from({ length: 20 }, (_, j) => `storage_field_${j}?: string;`).join(' ')} }
      }`).join('')}
    }
  }
}`.repeat(5); // Multiply by 5 to make it truly massive

describe('Final Token Limit Validation', () => {
  let mockDevelopmentOps: DevelopmentOperations;
  let developmentTools: ReturnType<typeof getDevelopmentTools>;

  beforeEach(() => {
    mockDevelopmentOps = {
      getProjectUrl: vi.fn().mockResolvedValue('https://api.supabase.co'),
      getAnonKey: vi.fn().mockResolvedValue('sb-anon-key'),
      generateTypescriptTypes: vi.fn().mockResolvedValue({ types: MASSIVE_TYPESCRIPT_TYPES }),
    };

    developmentTools = getDevelopmentTools({
      development: mockDevelopmentOps,
      projectId: 'test-project',
    });

    vi.clearAllMocks();
  });

  test('CRITICAL: generate_typescript_types with massive data stays under 25k token limit', async () => {
    const originalTokens = estimateTokens(MASSIVE_TYPESCRIPT_TYPES);
    console.log(`Original massive TypeScript types: ${originalTokens} tokens`);

    // This would previously fail with "tokens exceeds maximum allowed tokens (25000)"
    const result = await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      schemas: undefined, // No filtering - get everything
      table_filter: undefined, // No filtering
      include_views: true,
      include_enums: true,
      max_response_size: 'large', // Maximum possible response
    });

    const finalTokens = estimateTokens(result);
    console.log(`Final processed response: ${finalTokens} tokens`);

    // THE CRITICAL TEST: Must be under 25k tokens
    expect(finalTokens).toBeLessThan(25000);

    // Should also be significantly smaller than original
    expect(finalTokens).toBeLessThan(originalTokens * 0.5); // At least 50% reduction

    // Should contain meaningful content, not just error messages
    expect(result).toContain('TypeScript types generated');
    expect(result).not.toContain('error');
    expect(result).not.toContain('failed');
  });

  test('generate_typescript_types with small setting stays well under limit', async () => {
    const result = await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      schemas: ['public'],
      table_filter: 'user*',
      include_views: false,
      include_enums: false,
      max_response_size: 'small',
    });

    const finalTokens = estimateTokens(result);
    console.log(`Small response: ${finalTokens} tokens`);

    expect(finalTokens).toBeLessThan(25000);
    expect(finalTokens).toBeLessThan(7000); // Should be quite small
  });

  test('generate_typescript_types with medium setting stays under limit', async () => {
    const result = await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      schemas: ['public', 'auth'],
      include_views: true,
      include_enums: true,
      max_response_size: 'medium',
    });

    const finalTokens = estimateTokens(result);
    console.log(`Medium response: ${finalTokens} tokens`);

    expect(finalTokens).toBeLessThan(25000);
    expect(finalTokens).toBeLessThan(15000); // Should be medium-sized
  });

  test('generate_typescript_types_summary stays under conservative limit', async () => {
    const result = await developmentTools.generate_typescript_types_summary.execute({
      project_id: 'test-project',
      include_counts: true,
    });

    const finalTokens = estimateTokens(result);
    console.log(`Summary response: ${finalTokens} tokens`);

    expect(finalTokens).toBeLessThan(25000);
    expect(finalTokens).toBeLessThan(5000); // Should be quite small for summary
  });

  test('Multiple tool calls in sequence all stay under limit', async () => {
    // Simulate multiple tool calls that could accumulate token usage
    const results = [];

    results.push(await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      max_response_size: 'large',
    }));

    results.push(await developmentTools.generate_typescript_types_summary.execute({
      project_id: 'test-project',
      include_counts: false,
    }));

    results.push(await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      schemas: ['public'],
      max_response_size: 'medium',
    }));

    // Each individual result should be under 25k
    for (let i = 0; i < results.length; i++) {
      const tokens = estimateTokens(results[i]);
      console.log(`Result ${i + 1}: ${tokens} tokens`);
      expect(tokens).toBeLessThan(25000);
    }

    // Combined they should still be reasonable (this tests if we're being too conservative)
    const totalTokens = results.reduce((sum, result) => sum + estimateTokens(result), 0);
    console.log(`Total combined: ${totalTokens} tokens`);
    expect(totalTokens).toBeLessThan(50000); // Reasonable total for multiple calls
  });

  test('Response includes helpful indicators when data was limited', async () => {
    const result = await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      max_response_size: 'small',
    });

    // Should indicate that the response was processed/limited
    expect(result).toMatch(/reduced|limited|showing/i);
  });

  test('Extreme stress test - truly massive data', async () => {
    // Create the largest possible realistic data
    const extremeData = MASSIVE_TYPESCRIPT_TYPES.repeat(10); // 10x massive data
    vi.mocked(mockDevelopmentOps.generateTypescriptTypes).mockResolvedValueOnce({ types: extremeData });

    const originalTokens = estimateTokens(extremeData);
    console.log(`EXTREME test - Original: ${originalTokens} tokens`);

    const result = await developmentTools.generate_typescript_types.execute({
      project_id: 'test-project',
      max_response_size: 'large',
    });

    const finalTokens = estimateTokens(result);
    console.log(`EXTREME test - Final: ${finalTokens} tokens`);

    // Even with extreme data, must stay under 25k
    expect(finalTokens).toBeLessThan(25000);
    expect(finalTokens).toBeLessThan(originalTokens * 0.1); // Massive reduction required
  });
});