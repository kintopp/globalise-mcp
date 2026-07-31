/**
 * LRU (Least Recently Used) Cache with TTL support and in-flight dedup
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
   * Loads currently in flight, keyed by cacheKey. Per-instance state, so two
   * caches with a coincidentally-equal key never collide. Cleared on settle.
   */
  private inFlight = new Map<string, Promise<T>>();

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
   * Return the cached value, join an in-flight load for the same key, or
   * invoke `loader` once and cache its result. Concurrent misses share one
   * upstream request (family cache-seam contract; see ub-sgbr
   * src/lib/cache.js#fetchCached — the abort/waiter machinery there is
   * deliberately not ported: no GLOBALISE caller threads a cancel signal).
   * A rejected load caches nothing and is cleared, so the next caller
   * retries; `!== undefined` keeps a legitimately-cached falsy value a hit
   * (finding 13).
   */
  async getOrFetch(key: string, loader: () => Promise<T>): Promise<T> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const existing = this.inFlight.get(key);
    if (existing) {
      return existing;
    }
    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        // Identity guard: only the entry that owns this slot may clear it.
        if (this.inFlight.get(key) === promise) {
          this.inFlight.delete(key);
        }
      });
    this.inFlight.set(key, promise);
    return promise;
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

  // clear()/size()/delete() and a has() were removed as zero-caller dead code
  // (CODE-REVIEW finding 18). has() in particular delegated to get(), which
  // mutates LRU recency — a passive existence check would have silently
  // reordered eviction. Re-add deliberately (and make has() a non-mutating
  // peek) if a caller ever needs them.
}
