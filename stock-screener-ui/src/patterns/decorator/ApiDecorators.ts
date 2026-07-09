/**
 * Decorator Pattern — GoF: "Attach additional responsibilities to an object dynamically."
 *
 * This is a functional/TypeScript take on the classic pattern.  Instead of wrapping
 * objects in other objects (the OOP approach), we wrap async **functions** with
 * **higher-order functions** that add cross-cutting behaviour such as retry,
 * caching, logging, and request deduplication.
 *
 * ┌──────────┐     ┌──────────────┐     ┌──────────┐     ┌───────────┐
 * │  Client  │ ──→ │ withLogging  │ ──→ │ withCache │ ──→ │ withRetry │ ──→ apiGet
 * └──────────┘     └──────────────┘     └──────────┘     └──────────┘
 *                      ▲                    ▲                ▲
 *                      │  decorator layers  │                │
 *                      └────────────────────┘────────────────┘
 *
 * Each decorator accepts an ApiFn<T> and returns a wrapped ApiFn<T> with the
 * same signature, so layers compose via plain function composition.
 */

/**
 * Base function signature for all API-call functions.
 * Every decorator preserves this type, enabling arbitrary stacking.
 */
export type ApiFn<T> = (...args: any[]) => Promise<T>;

// ──────────────────────────────────────────────
//  1. SimpleCache  — in-memory cache with TTL
// ──────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class SimpleCache {
  private store = new Map<string, CacheEntry<unknown>>();

  /** Retrieve a cached value. Returns `undefined` if missing or expired. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  /** Store a value with a TTL in milliseconds. */
  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /** Check whether a (non-expired) entry exists for `key`. */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Remove a specific key from the cache. */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Remove all entries whose key starts with a given prefix. */
  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Clear the entire cache. */
  clear(): void {
    this.store.clear();
  }

  /** Number of non-expired entries in the cache. */
  get size(): number {
    this._evictStale();
    return this.store.size;
  }

  /** @internal Remove all expired entries. */
  private _evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

// ──────────────────────────────────────────────
//  2. Decorator factories
// ──────────────────────────────────────────────

/**
 * withRetry — Retry on failure with exponential backoff.
 *
 * Only retries on **network errors** (TypeError, or status ≥ 500).
 * 4xx responses are considered client errors and are NOT retried.
 *
 * @param fn          The API function to wrap.
 * @param maxRetries  Maximum number of retry attempts (default 3).
 * @param delayMs     Initial back-off delay in ms (default 1000; doubles each retry).
 */
export function withRetry<T>(
  fn: ApiFn<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
): ApiFn<T> {
  return async (...args: any[]): Promise<T> => {
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastError = err;

        const isNetworkError =
          err instanceof TypeError ||
          err instanceof DOMException ||
          (err instanceof Error && err.message?.includes("Failed to fetch"));

        const isServerError =
          err instanceof Error &&
          (err.message?.includes("5") ||
           err.message?.includes("502") ||
           err.message?.includes("503") ||
           err.message?.includes("504"));

        if (!isNetworkError && !isServerError) {
          throw err;
        }

        if (attempt < maxRetries) {
          const backoff = delayMs * Math.pow(2, attempt);
          console.warn(
            `[ApiDecorator] [withRetry] Attempt ${attempt + 1}/${maxRetries} failed, ` +
            `retrying in ${backoff}ms…`,
            err instanceof Error ? err.message : err,
          );
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    }

    throw lastError;
  };
}

/**
 * withCache — Cache results keyed by stringified arguments.
 *
 * Cache keys are derived via `JSON.stringify(args)`.  The decorator
 * **invalidates** the entire cache when it detects a mutating call (any
 * argument matching `/create|update|delete|post|put|patch/i` in the
 * endpoint string — assumed to be the first argument).
 *
 * @param fn     The API function to wrap.
 * @param ttlMs  Time-to-live in milliseconds (default 60 000).
 * @param cache  Optional shared SimpleCache instance.  If omitted a new one is created.
 */
export function withCache<T>(
  fn: ApiFn<T>,
  ttlMs: number = 60_000,
  cache?: SimpleCache,
): ApiFn<T> {
  const _cache = cache ?? new SimpleCache();

  const isMutation = (args: any[]): boolean => {
    const endpoint = typeof args[0] === "string" ? args[0] : "";
    return /create|update|delete|post|put|patch/i.test(endpoint);
  };

  return async (...args: any[]): Promise<T> => {
    if (isMutation(args)) {
      _cache.clear();
      return fn(...args);
    }

    const key = JSON.stringify(args);
    if (_cache.has(key)) {
      return _cache.get<T>(key)!;
    }

    const result = await fn(...args);
    _cache.set(key, result, ttlMs);
    return result;
  };
}

/**
 * withLogging — Log call start / finish with duration.
 *
 * Uses `console.group` for nested calls so the dev tools render a clean
 * collapsible tree.
 *
 * @param fn    The API function to wrap.
 * @param name  A label used in log output (default "API").
 */
export function withLogging<T>(fn: ApiFn<T>, name: string = "API"): ApiFn<T> {
  return async (...args: any[]): Promise<T> => {
    const label = `[ApiDecorator] [${name}]`;
    console.group(`${label} Calling…`);
    const start = performance.now();

    try {
      const result = await fn(...args);
      const elapsed = (performance.now() - start).toFixed(1);
      console.log(`${label} Completed in ${elapsed}ms`);
      return result;
    } catch (err) {
      const elapsed = (performance.now() - start).toFixed(1);
      console.error(`${label} Failed after ${elapsed}ms`, err);
      throw err;
    } finally {
      console.groupEnd();
    }
  };
}

/**
 * withDedup — Deduplicate concurrent calls with identical arguments.
 *
 * If a call is already in-flight with the same args, return the existing
 * pending promise instead of initiating a new request.
 *
 * @param fn  The API function to wrap.
 */
export function withDedup<T>(fn: ApiFn<T>): ApiFn<T> {
  const inflight = new Map<string, Promise<T>>();

  return async (...args: any[]): Promise<T> => {
    const key = JSON.stringify(args);

    const existing = inflight.get(key);
    if (existing) return existing;

    const promise = fn(...args).finally(() => {
      inflight.delete(key);
    });
    inflight.set(key, promise);
    return promise;
  };
}

// ──────────────────────────────────────────────
//  3. Composite decorator
// ──────────────────────────────────────────────

type DecoratorFactory = <T>(fn: ApiFn<T>) => ApiFn<T>;

/**
 * createCompositeDecorator — Stack multiple decorators into a single wrapper.
 *
 * Decorators are applied in order (left-to-right), so `[withRetry, withCache]`
 * means: first retry, then cache the retry-wrapped function.
 *
 * @param fn         The base API function.
 * @param decorators An array of decorator factories to apply.
 * @returns          A fully wrapped function with the same signature.
 *
 * @example
 * ```ts
 * const get = createCompositeDecorator(apiGet, [
 *   withRetry(3, 2000),
 *   withCache(30000),
 *   withLogging("cachedGet"),
 * ]);
 * ```
 */
export function createCompositeDecorator<T>(
  fn: ApiFn<T>,
  decorators: DecoratorFactory[],
): ApiFn<T> {
  return decorators.reduce((wrapped, decorator) => decorator(wrapped), fn);
}

// ──────────────────────────────────────────────
//  4. Composition examples (commented)
// ──────────────────────────────────────────────

// // Simple: retry + cache
// const cachedGet = withRetry(withCache(apiGet, 30_000), 3);

// // Full stack: logging + cache + retry
// const loggedCachedGet = withLogging(cachedGet, "cachedGet");

// // Using the composite helper
// const compositeGet = createCompositeDecorator(apiGet, [
//   withRetry(3),
//   withCache(30_000),
//   withLogging("get"),
// ]);

// // Dedup on top of everything
// const dedupedGet = withDedup(compositeGet);
