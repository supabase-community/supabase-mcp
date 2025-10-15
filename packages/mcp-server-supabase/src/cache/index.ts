/**
 * LRU Cache with TTL support for MCP server responses
 *
 * Reduces latency by caching:
 * - Schema metadata (tables, columns, extensions)
 * - Documentation queries
 * - Project/organization info
 * - Static configuration
 */

export interface CacheOptions {
  /**
   * Maximum number of entries to store
   * @default 1000
   */
  maxSize?: number;

  /**
   * Default time-to-live in milliseconds
   * @default 300000 (5 minutes)
   */
  defaultTtl?: number;

  /**
   * Enable cache statistics
   * @default false
   */
  enableStats?: boolean;
}

export interface CacheEntry<T> {
  data: T;
  expires: number;
  lastAccessed: number;
  hitCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
  hitRate: number;
}

export class ResponseCache {
  private cache = new Map<string, CacheEntry<any>>();
  private maxSize: number;
  private defaultTtl: number;
  private enableStats: boolean;

  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
  };

  constructor(options: CacheOptions = {}) {
    this.maxSize = options.maxSize ?? 1000;
    this.defaultTtl = options.defaultTtl ?? 300000; // 5 minutes
    this.enableStats = options.enableStats ?? false;
  }

  /**
   * Get a value from the cache
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.enableStats) this.stats.misses++;
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      if (this.enableStats) this.stats.misses++;
      return null;
    }

    // Update access info
    entry.lastAccessed = Date.now();
    entry.hitCount++;

    if (this.enableStats) this.stats.hits++;

    return entry.data as T;
  }

  /**
   * Set a value in the cache
   */
  set<T>(key: string, data: T, ttl?: number): void {
    const actualTtl = ttl ?? this.defaultTtl;

    // Evict if at capacity and key is new
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      data,
      expires: Date.now() + actualTtl,
      lastAccessed: Date.now(),
      hitCount: 0,
    };

    this.cache.set(key, entry);
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Invalidate all keys matching a pattern
   */
  invalidate(pattern: string | RegExp): number {
    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern;
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    return count;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    if (this.enableStats) {
      this.stats.hits = 0;
      this.stats.misses = 0;
      this.stats.evictions = 0;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? this.stats.hits / total : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      evictions: this.stats.evictions,
      size: this.cache.size,
      hitRate,
    };
  }

  /**
   * Get all keys in the cache
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.enableStats) this.stats.evictions++;
    }
  }

  /**
   * Clean up expired entries (should be called periodically)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expires) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }
}

/**
 * Helper function to generate cache keys
 */
export function generateCacheKey(
  tool: string,
  params: Record<string, any>
): string {
  const sortedParams = Object.keys(params)
    .sort()
    .map((key) => `${key}:${JSON.stringify(params[key])}`)
    .join('|');

  return `${tool}::${sortedParams}`;
}

/**
 * Decorator to add caching to a function
 */
export function cached<T extends (...args: any[]) => Promise<any>>(
  cache: ResponseCache,
  keyFn: (...args: Parameters<T>) => string,
  ttl?: number
) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: Parameters<T>) {
      const key = keyFn(...args);

      // Try cache first
      const cached = cache.get(key);
      if (cached !== null) {
        return cached;
      }

      // Execute original function
      const result = await originalMethod.apply(this, args);

      // Store in cache
      cache.set(key, result, ttl);

      return result;
    };

    return descriptor;
  };
}
