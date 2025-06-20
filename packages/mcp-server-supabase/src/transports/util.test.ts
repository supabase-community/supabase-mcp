import { describe, expect, test } from 'vitest';
import { parseList } from './util.js';

describe('parseList', () => {
  test('should parse comma-delimited list', () => {
    const result = parseList('item1,item2,item3');
    expect(result).toEqual(['item1', 'item2', 'item3']);
  });

  test('should handle spaces around items', () => {
    const result = parseList('item1, item2 , item3');
    expect(result).toEqual(['item1', 'item2', 'item3']);
  });

  test('should filter out empty items', () => {
    const result = parseList('item1,,item2,');
    expect(result).toEqual(['item1', 'item2']);
  });

  test('should handle custom delimiter', () => {
    const result = parseList('item1|item2|item3', '|');
    expect(result).toEqual(['item1', 'item2', 'item3']);
  });

  test('should handle single item', () => {
    const result = parseList('item1');
    expect(result).toEqual(['item1']);
  });

  test('should handle empty string', () => {
    const result = parseList('');
    expect(result).toEqual([]);
  });

  test('should handle string with only delimiters', () => {
    const result = parseList(',,,');
    expect(result).toEqual([]);
  });

  test('should handle semicolon delimiter', () => {
    const result = parseList('item1; item2; item3', ';');
    expect(result).toEqual(['item1', 'item2', 'item3']);
  });
});
