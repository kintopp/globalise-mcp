/**
 * LRU (Least Recently Used) Cache with TTL support
 *
 * Provides a simple in-memory cache with automatic eviction of:
 * - Least recently used entries when cache is full
 * - Expired entries based on TTL (time-to-live)
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export class LRUCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private maxSize: number;
  private ttlMs: number;

  /**
   * Create a new LRU cache
   * @param maxSize Maximum number of entries (default: 100)
   * @param ttlMs Time-to-live in milliseconds (default: 300000 = 5 minutes)
   */
  constructor(maxSize = 100, ttlMs = 300000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  /**
   * Get a value from the cache
   * Returns undefined if key not found or expired
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry.value;
  }

  /**
   * Set a value in the cache
   * Purges expired entries first, then evicts LRU if still full
   */
  set(key: string, value: T): void {
    // Purge expired entries before adding new ones
    this.purgeExpired();

    // Remove if exists
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }
    // Evict least recently used if at capacity
    else if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value!;  // Safe: cache.size >= maxSize ensures at least one entry
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Remove all expired entries from the cache
   */
  purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get the current number of entries in the cache
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Delete a specific entry from the cache
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }
}
