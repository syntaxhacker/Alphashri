/**
 * GoF Iterator Pattern — Provide a way to access elements of an aggregate
 * object sequentially without exposing its underlying representation.
 *
 * ░─ PROBLEM ──────────────────────────────────────────────────────────
 * Many API endpoints return paginated data (trades, positions, history).
 * Callers must manually track page numbers, concatenate results, and
 * decide when to stop fetching. This couples business logic to
 * pagination mechanics.
 *
 * ░─ SOLUTION ─────────────────────────────────────────────────────────
 * A PaginatedIterator wraps a fetch function and abstracts away page
 * tracking, caching, and forward/backward navigation. Callers simply
 * call .next() in a loop (or use `for await`) until `done` is true.
 *
 * ┌──────────────┐  next()/prev()   ┌────────────────────┐
 * │  Caller Code  │ ──────────────> │ PaginatedIterator  │
 * │  (for await)  │ <────────────── │                    │
 * └──────────────┘   IteratorResult │  - page cache      │
 *                                    │  - currentPage     │
 *                                    │  - fetchPage()     │
 *                                    └───────┬────────────┘
 *                                            │
 *                                    ┌───────▼────────────┐
 *                                    │    fetchPage()     │
 *                                    │  (API endpoint)    │
 *                                    └────────────────────┘
 *
 * @module patterns/iterator
 */

/* ─── CORE TYPES ──────────────────────────────────────────────────── */

/** Shape returned by any paginated API endpoint. */
export interface Page<T> {
  data: T[];
  page: number;
  totalPages: number;
  totalItems: number;
  hasNext: boolean;
  hasPrev: boolean;
}

/** Value yielded by the iterator on each step. */
export interface IteratorResult<T> {
  value: T[];
  done: boolean;
  page: number;
}

/**
 * Signature for the function that fetches a single page from the API.
 * Callers provide this; the iterator calls it internally.
 */
export type FetchPageFn<T> = (
  page: number,
  pageSize: number,
) => Promise<Page<T>>;

/* ─── CONFIG ───────────────────────────────────────────────────────── */

export interface PaginatedIteratorOptions {
  /** Number of items per page (default: 50). */
  pageSize?: number;
  /** Page to start from (default: 1). */
  startPage?: number;
}

/* ─── PAGINATED ITERATOR ───────────────────────────────────────────── */

/**
 * Async iterator that walks paginated API results page by page.
 *
 * Keeps an internal LRU-like cache of fetched pages so navigating
 * backward or re-visiting a page never re-fetches.
 *
 * @example
 * ```ts
 * const fetchTrades = (page: number, size: number) =>
 *   api.get(`/trades?page=${page}&pageSize=${size}`).then(r => r.data);
 *
 * const it = new PaginatedIterator(fetchTrades, { pageSize: 20 });
 *
 * for await (const page of it) {
 *   renderTrades(page);
 *   if (page.length === 0) break;
 * }
 * ```
 */
export class PaginatedIterator<T> {
  private fetchPage: FetchPageFn<T>;
  private pageSize: number;
  private currentPage: number;
  private totalPages: number;
  private totalItems: number;
  private cache: Map<number, T[]>;
  private prefetchPromise: Promise<void> | null;

  constructor(fetchPage: FetchPageFn<T>, options?: PaginatedIteratorOptions) {
    this.fetchPage = fetchPage;
    this.pageSize = options?.pageSize ?? 50;
    this.currentPage = options?.startPage ?? 1;
    this.totalPages = 0;
    this.totalItems = 0;
    this.cache = new Map();
    this.prefetchPromise = null;
  }

  /**
   * Fetch and return the next page.
   * Advances the internal page counter.
   */
  async next(): Promise<IteratorResult<T>> {
    const targetPage = this.currentPage + 1;

    if (this.totalPages > 0 && targetPage > this.totalPages) {
      return { value: [], done: true, page: this.currentPage };
    }

    return this.fetchPageData(targetPage);
  }

  /**
   * Fetch and return the previous page.
   * Relies on the page cache — if the page was never fetched, throws.
   */
  async prev(): Promise<IteratorResult<T>> {
    const targetPage = this.currentPage - 1;
    if (targetPage < 1) {
      return { value: [], done: true, page: this.currentPage };
    }

    const cached = this.cache.get(targetPage);
    if (!cached) {
      throw new Error(
        `Page ${targetPage} is not cached. Call next() or goToPage() first.`,
      );
    }

    this.currentPage = targetPage;
    return {
      value: cached,
      done: false,
      page: this.currentPage,
    };
  }

  /**
   * Return the current page data without fetching.
   * Returns `done: true` if no data has been fetched yet.
   */
  async current(): Promise<IteratorResult<T>> {
    const cached = this.cache.get(this.currentPage);
    if (!cached) {
      return { value: [], done: true, page: this.currentPage };
    }
    return {
      value: cached,
      done: false,
      page: this.currentPage,
    };
  }

  /**
   * Jump to an arbitrary page.
   * Fetches from the API if not cached, otherwise returns cached data.
   */
  async goToPage(page: number): Promise<IteratorResult<T>> {
    if (page < 1) {
      return { value: [], done: true, page: this.currentPage };
    }

    if (this.totalPages > 0 && page > this.totalPages) {
      return { value: [], done: true, page: this.currentPage };
    }

    return this.fetchPageData(page);
  }

  /** Reset the iterator back to page 1 and clear the cache. */
  reset(): void {
    this.currentPage = 1;
    this.totalPages = 0;
    this.totalItems = 0;
    this.cache.clear();
    this.prefetchPromise = null;
  }

  /** Human-readable progress string, e.g. "Page 3/15 (200/3000 items)". */
  getProgress(): string {
    const knownTotal = this.totalPages > 0 ? this.totalPages : "?";
    const knownItems = this.totalItems > 0 ? this.totalItems : "?";
    return `Page ${this.currentPage}/${knownTotal} (${this.currentPage * this.pageSize}/${knownItems} items)`;
  }

  /**
   * Eagerly fetch the next page in the background.
   * Call this when the user is likely to advance so the next .next()
   * returns from cache.
   */
  async prefetchNext(): Promise<void> {
    const targetPage = this.currentPage + 1;

    if (this.cache.has(targetPage)) return;
    if (this.totalPages > 0 && targetPage > this.totalPages) return;

    this.prefetchPromise = this.fetchPageData(targetPage).then(() => {});
    await this.prefetchPromise;
  }

  /**
   * Consume all remaining pages and return concatenated data.
   * Resets the iterator afterward.
   */
  async getAll(): Promise<T[]> {
    const allData: T[] = [];

    if (this.totalPages === 0) {
      const first = await this.fetchPageData(1);
      allData.push(...first.value);
    } else {
      for (let p = 1; p <= this.totalPages; p++) {
        const cached = this.cache.get(p);
        if (cached) {
          allData.push(...cached);
        } else {
          const result = await this.fetchPageData(p);
          allData.push(...result.value);
        }
      }
    }

    return allData;
  }

  /* ─── ASYNC ITERATOR ─────────────────────────────────────────────── */

  [Symbol.asyncIterator](): AsyncIterator<T[], IteratorResult<T>> {
    return {
      next: () => this.next().then((r) => ({
        value: r.value,
        done: r.done,
      })),
    };
  }

  /* ─── INTERNALS ──────────────────────────────────────────────────── */

  private async fetchPageData(page: number): Promise<IteratorResult<T>> {
    const cached = this.cache.get(page);
    if (cached) {
      this.currentPage = page;
      return { value: cached, done: false, page };
    }

    const response = await this.fetchPage(page, this.pageSize);

    this.currentPage = response.page;
    this.totalPages = response.totalPages;
    this.totalItems = response.totalItems;
    this.cache.set(response.page, response.data);

    return {
      value: response.data,
      done: !response.hasNext,
      page: response.page,
    };
  }
}

/* ─── FACTORY ──────────────────────────────────────────────────────── */

/**
 * Create a {@link PaginatedIterator} pre-configured for trade data.
 *
 * @param fetchFn - An async function that calls the trades endpoint.
 * @param options - Optional page size / start page overrides.
 *
 * @example
 * ```ts
 * const tradeIterator = createTradeIterator(
 *   (page, size) => api.get(`/paper/trades?page=${page}&pageSize=${size}`),
 *   { pageSize: 100 },
 * );
 *
 * const firstPage = await tradeIterator.next();
 * ```
 */
export function createTradeIterator<T>(
  fetchFn: FetchPageFn<T>,
  options?: PaginatedIteratorOptions,
): PaginatedIterator<T> {
  return new PaginatedIterator<T>(fetchFn, options);
}

/* ─── ARRAY ITERATOR (synchronous) ────────────────────────────────── */

/**
 * Simple synchronous iterator over an in-memory array.
 * Implements `Symbol.iterator` so it works with `for...of`.
 *
 * @example
 * ```ts
 * const iter = new ArrayIterator(["a", "b", "c"]);
 * for (const item of iter) {
 *   console.log(item); // "a", "b", "c"
 * }
 * ```
 */
export class ArrayIterator<T> {
  private index = 0;

  constructor(private items: T[]) {}

  next(): { value: T; done: boolean } {
    if (this.index >= this.items.length) {
      return { value: undefined as unknown as T, done: true };
    }
    return { value: this.items[this.index++], done: false };
  }

  [Symbol.iterator](): this {
    this.index = 0;
    return this;
  }
}
