import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ResponseCache, generateCacheKey } from './index.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxSize: 3, defaultTtl: 1000, enableStats: true });
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      cache.set('key1', { data: 'value1' });
      const result = cache.get('key1');
      expect(result).toEqual({ data: 'value1' });
    });

    it('should return null for missing keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
    });

    it('should delete keys', () => {
      cache.set('key1', 'value1');
      expect(cache.has('key1')).toBe(true);
      cache.delete('key1');
      expect(cache.has('key1')).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      expect(cache.size()).toBe(2);
      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });

  describe('TTL', () => {
    it('should expire entries after TTL', async () => {
      cache.set('key1', 'value1', 100);
      expect(cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(cache.get('key1')).toBeNull();
    });

    it('should use default TTL when not specified', async () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      await new Promise((resolve) => setTimeout(resolve, 1100));

      expect(cache.get('key1')).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      // Access key1 to make it recently used
      cache.get('key1');

      // Add key4, should evict key2 (oldest)
      cache.set('key4', 'value4');

      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });
  });

  describe('pattern invalidation', () => {
    it('should invalidate keys matching string pattern', () => {
      cache.set('user:1', 'data1');
      cache.set('user:2', 'data2');
      cache.set('post:1', 'data3');

      const count = cache.invalidate('user:');
      expect(count).toBe(2);
      expect(cache.has('user:1')).toBe(false);
      expect(cache.has('user:2')).toBe(false);
      expect(cache.has('post:1')).toBe(true);
    });

    it('should invalidate keys matching regex pattern', () => {
      cache.set('list_tables::public', 'data1');
      cache.set('list_tables::auth', 'data2');
      cache.set('list_extensions::', 'data3');

      const count = cache.invalidate(/^list_tables::/);
      expect(count).toBe(2);
      expect(cache.has('list_extensions::')).toBe(true);
    });
  });

  describe('statistics', () => {
    it('should track hits and misses', () => {
      cache.set('key1', 'value1');

      cache.get('key1'); // hit
      cache.get('key2'); // miss
      cache.get('key1'); // hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.667, 2);
    });

    it('should track evictions', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');
      cache.set('key4', 'value4'); // Should evict key1

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 500);

      await new Promise((resolve) => setTimeout(resolve, 150));

      const removed = cache.cleanup();
      expect(removed).toBe(1);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
    });
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys for same params', () => {
    const key1 = generateCacheKey('list_tables', { schemas: ['public'], limit: 10 });
    const key2 = generateCacheKey('list_tables', { schemas: ['public'], limit: 10 });
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different params', () => {
    const key1 = generateCacheKey('list_tables', { schemas: ['public'] });
    const key2 = generateCacheKey('list_tables', { schemas: ['auth'] });
    expect(key1).not.toBe(key2);
  });

  it('should sort parameters for consistency', () => {
    const key1 = generateCacheKey('test', { b: 2, a: 1 });
    const key2 = generateCacheKey('test', { a: 1, b: 2 });
    expect(key1).toBe(key2);
  });
});
