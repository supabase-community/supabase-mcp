/**
 * Integration tests for response processing system
 * Tests whether tools are actually using response management to stay under token limits
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { processResponse, RESPONSE_CONFIGS } from '../response/index.js';

// Test data that should trigger chunking
const LARGE_TEST_DATA = {
  tables: Array.from({ length: 100 }, (_, i) => ({
    name: `table_${i}`,
    schema: 'public',
    columns: Array.from({ length: 20 }, (_, j) => ({
      name: `column_${j}`,
      type: 'text',
      description: `This is a very long description for column ${j} in table ${i} that contains lots of detailed information about the column's purpose, constraints, and usage patterns`,
    })),
    description: `This is table ${i} which contains lots of detailed information and serves as a comprehensive example of how tables can have extensive metadata`,
  })),
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

describe('Response Processing Integration', () => {
  test('processResponse with CONSERVATIVE config reduces large responses', () => {
    const originalSize = JSON.stringify(LARGE_TEST_DATA).length;
    const originalTokens = estimateTokens(JSON.stringify(LARGE_TEST_DATA));

    console.log(`Original data: ${originalTokens} tokens (${originalSize} chars)`);

    const result = processResponse(
      LARGE_TEST_DATA,
      'Test data for chunking',
      RESPONSE_CONFIGS.CONSERVATIVE
    );

    const processedTokens = estimateTokens(result);
    const processedSize = result.length;

    console.log(`Processed data: ${processedTokens} tokens (${processedSize} chars)`);

    // The processed result should be smaller
    expect(processedTokens).toBeLessThan(originalTokens);
    expect(processedTokens).toBeLessThan(25000);
    expect(processedTokens).toBeLessThan(RESPONSE_CONFIGS.CONSERVATIVE.maxTokens * 2); // Allow some overhead
  });

  test('processResponse with different configs produces different sizes', () => {
    const conservativeResult = processResponse(
      LARGE_TEST_DATA,
      'Conservative test',
      RESPONSE_CONFIGS.CONSERVATIVE
    );

    const standardResult = processResponse(
      LARGE_TEST_DATA,
      'Standard test',
      RESPONSE_CONFIGS.STANDARD
    );

    const permissiveResult = processResponse(
      LARGE_TEST_DATA,
      'Permissive test',
      RESPONSE_CONFIGS.PERMISSIVE
    );

    const conservativeTokens = estimateTokens(conservativeResult);
    const standardTokens = estimateTokens(standardResult);
    const permissiveTokens = estimateTokens(permissiveResult);

    console.log(`Conservative: ${conservativeTokens} tokens`);
    console.log(`Standard: ${standardTokens} tokens`);
    console.log(`Permissive: ${permissiveTokens} tokens`);

    // Conservative should be smallest, permissive should be largest
    expect(conservativeTokens).toBeLessThanOrEqual(standardTokens);
    expect(standardTokens).toBeLessThanOrEqual(permissiveTokens);

    // All should be under 25k tokens
    expect(conservativeTokens).toBeLessThan(25000);
    expect(standardTokens).toBeLessThan(25000);
    expect(permissiveTokens).toBeLessThan(25000);
  });

  test('processResponse handles very large arrays by chunking', () => {
    const veryLargeArray = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      description: `This is a very detailed description for item ${i} that contains extensive information about its properties, usage, and metadata`,
      properties: {
        type: 'example',
        category: `category_${i % 10}`,
        tags: [`tag1_${i}`, `tag2_${i}`, `tag3_${i}`],
        metadata: {
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          version: '1.0.0',
          author: `author_${i % 5}`,
        },
      },
    }));

    const originalTokens = estimateTokens(JSON.stringify(veryLargeArray));
    console.log(`Very large array: ${originalTokens} tokens`);

    const result = processResponse(
      veryLargeArray,
      'Very large array test',
      RESPONSE_CONFIGS.CONSERVATIVE
    );

    const processedTokens = estimateTokens(result);
    console.log(`Processed large array: ${processedTokens} tokens`);

    expect(processedTokens).toBeLessThan(originalTokens);
    expect(processedTokens).toBeLessThan(25000);
  });

  test('processResponse indicates when data was chunked', () => {
    const result = processResponse(
      LARGE_TEST_DATA,
      'Chunking indicator test',
      RESPONSE_CONFIGS.CONSERVATIVE
    );

    // Should include some indication that chunking occurred
    expect(result).toMatch(/\[Response Manager\]|chunks|truncated|summarized/i);
  });
});