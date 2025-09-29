/**
 * Tests for simple token limiter - should actually work unlike the complex chunker
 */

import { describe, test, expect } from 'vitest';
import { limitResponseSize } from './simple-limiter.js';

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Large test data
const LARGE_ARRAY = Array.from({ length: 500 }, (_, i) => ({
  id: i,
  name: `Item ${i}`,
  description: `This is a very detailed description for item ${i} that contains extensive information about its properties and usage`,
  properties: {
    type: 'example',
    category: `category_${i % 10}`,
    tags: [`tag1_${i}`, `tag2_${i}`, `tag3_${i}`],
  },
}));

const LARGE_OBJECT = {
  users: Array.from({ length: 200 }, (_, i) => ({
    id: i,
    email: `user${i}@example.com`,
    profile: {
      name: `User ${i}`,
      bio: `This is a detailed biography for user ${i} containing lots of personal information and background details`,
      preferences: {
        theme: 'dark',
        notifications: true,
        privacy: 'public',
      },
    },
  })),
  posts: Array.from({ length: 300 }, (_, i) => ({
    id: i,
    title: `Post ${i}`,
    content: `This is the content of post ${i} which contains a lot of text and detailed information about various topics`,
    author: i % 50,
    tags: [`tag${i % 20}`, `tag${(i + 1) % 20}`, `tag${(i + 2) % 20}`],
  })),
};

describe('Simple Token Limiter', () => {
  test('should limit large arrays to stay under token limit', () => {
    const originalTokens = estimateTokens(JSON.stringify(LARGE_ARRAY));
    console.log(`Original array: ${originalTokens} tokens`);

    const result = limitResponseSize(LARGE_ARRAY, 'Test large array', { maxTokens: 10000 });
    const limitedTokens = estimateTokens(result);

    console.log(`Limited array: ${limitedTokens} tokens`);

    expect(limitedTokens).toBeLessThan(15000); // Well under 25k
    expect(limitedTokens).toBeLessThan(originalTokens); // Actually smaller
    expect(result).toContain('showing'); // Should indicate limitation
  });

  test('should limit large objects to stay under token limit', () => {
    const originalTokens = estimateTokens(JSON.stringify(LARGE_OBJECT));
    console.log(`Original object: ${originalTokens} tokens`);

    const result = limitResponseSize(LARGE_OBJECT, 'Test large object', { maxTokens: 8000 });
    const limitedTokens = estimateTokens(result);

    console.log(`Limited object: ${limitedTokens} tokens`);

    expect(limitedTokens).toBeLessThan(12000); // Well under 25k
    expect(limitedTokens).toBeLessThan(originalTokens); // Actually smaller
  });

  test('should handle very aggressive token limits', () => {
    const result = limitResponseSize(LARGE_ARRAY, 'Aggressive test', { maxTokens: 1000 });
    const limitedTokens = estimateTokens(result);

    console.log(`Aggressively limited: ${limitedTokens} tokens`);

    expect(limitedTokens).toBeLessThan(2000); // Should be close to 1000 target
    expect(result).toContain('showing'); // Should indicate limitation
  });

  test('should not modify small responses', () => {
    const smallData = [{ id: 1, name: 'test' }, { id: 2, name: 'test2' }];
    const result = limitResponseSize(smallData, 'Small test', { maxTokens: 10000 });

    const originalString = JSON.stringify(smallData, null, 2);
    expect(result).toContain(originalString); // Should contain original data
    expect(estimateTokens(result)).toBeLessThan(1000); // Should be very small
  });

  test('should handle string truncation', () => {
    const veryLongString = 'x'.repeat(100000); // 100k characters
    const originalTokens = estimateTokens(veryLongString);

    const result = limitResponseSize(veryLongString, 'String test', { maxTokens: 1000 });
    const limitedTokens = estimateTokens(result);

    expect(limitedTokens).toBeLessThan(2000);
    expect(limitedTokens).toBeLessThan(originalTokens);
    expect(result).toContain('...');
  });

  test('should work with maximum realistic MCP data', () => {
    // Create the largest possible realistic response
    const maxRealisticData = {
      tables: Array.from({ length: 100 }, (_, i) => ({
        name: `table_${i}`,
        schema: 'public',
        columns: Array.from({ length: 30 }, (_, j) => ({
          name: `column_${j}`,
          type: j % 3 === 0 ? 'text' : j % 3 === 1 ? 'integer' : 'boolean',
          description: `Column ${j} description`,
        })),
        indexes: Array.from({ length: 5 }, (_, k) => ({
          name: `idx_${i}_${k}`,
          columns: [`column_${k}`],
        })),
      })),
      functions: Array.from({ length: 50 }, (_, i) => ({
        name: `function_${i}`,
        arguments: Array.from({ length: 8 }, (_, j) => ({
          name: `arg_${j}`,
          type: 'text',
        })),
      })),
    };

    const originalTokens = estimateTokens(JSON.stringify(maxRealisticData));
    console.log(`Max realistic data: ${originalTokens} tokens`);

    const result = limitResponseSize(maxRealisticData, 'Max realistic test', { maxTokens: 20000 });
    const limitedTokens = estimateTokens(result);

    console.log(`Limited realistic data: ${limitedTokens} tokens`);

    expect(limitedTokens).toBeLessThan(25000); // Must be under MCP limit
    expect(limitedTokens).toBeLessThan(originalTokens); // Must be smaller
  });
});