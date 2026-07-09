/**
 * Virtual Proxy Pattern — GoF Proxy
 *
 * Provide a surrogate or placeholder for another object to control access to it.
 *
 * This implementation uses JavaScript's built-in `Proxy` object to create a
 * virtual proxy that defers loading of expensive state (API data) until it is
 * actually accessed. The caller calls `.load()` once, then reads properties
 * transparently — the proxy intercepts the get trap and routes reads to the
 * cached state object.
 *
 * @see BotStatus  – types/bots.ts
 * @see PaperPosition, PaperTrade, AnalyticsData – types/paperTrading.ts
 */

import type { BotStatus } from "../../types/bots";
import type { PaperPosition } from "../../types/paperTrading";

// ─── Lazy State Proxy ────────────────────────────────────────────────────────

/**
 * Virtual proxy that wraps state fetched asynchronously via a loader function.
 *
 * The proxy exposes a management API ({@link load}, {@link loaded},
 * {@link invalidate}) alongside transparent read access to the underlying
 * state object's properties — no manual `.get("key")` calls required.
 *
 * @example
 * ```ts
 * const proxy = new LazyStateProxy(() => fetch("/api/bots/abc/status").then(r => r.json()));
 * const tp = proxy.createProxy();
 *
 * await tp.load();
 * console.log(tp.running);   // true — no explicit get()
 * console.log(tp.status);    // "running"
 *
 * tp.invalidate();           // force re-fetch on next load()
 * ```
 */
export class LazyStateProxy<T extends object> {
  /** @internal cached state result — null until first successful load */
  private state: T | null = null;

  /** @internal deduplication promise so concurrent calls share one request */
  private loadingPromise: Promise<T> | null = null;

  /**
   * @param loader  A factory that returns a promise for the state object.
   *                Called at most once per {@link load} call (cached after
   *                first resolve). Pass a new loader per proxy instance.
   */
  constructor(private readonly loader: () => Promise<T>) {}

  // ── Management API ────────────────────────────────────────────────────────

  /** Whether the state has been fetched and cached. */
  get loaded(): boolean {
    return this.state !== null;
  }

  /**
   * Fetch (or retrieve cached) state.
   *
   * Subsequent calls while a previous load is in-flight share the same promise
   * (deduplication). After resolution, cached state is returned synchronously.
   */
  async load(): Promise<T> {
    if (this.state) return this.state;

    if (!this.loadingPromise) {
      this.loadingPromise = this.loader().then((data) => {
        this.state = data;
        this.loadingPromise = null; // allow retry after invalidate
        return data;
      });
    }

    return this.loadingPromise;
  }

  /**
   * Synchronously access a single key from the loaded state.
   *
   * @throws {Error} If the state has not been loaded yet.
   */
  get<K extends keyof T>(key: K): T[K] {
    if (!this.state) {
      throw new Error("State not loaded. Call .load() first");
    }
    return this.state[key];
  }

  /**
   * Clear the cached state so the next call to {@link load} re-fetches data.
   */
  invalidate(): void {
    this.state = null;
    this.loadingPromise = null;
  }

  // ── Transparent Proxy Access ──────────────────────────────────────────────

  /**
   * Return a `Proxy` that wraps this instance for transparent property access.
   *
   * Properties that belong to the management API (`load`, `loaded`,
   * `invalidate`) are forwarded to the proxy instance itself. Every other
   * property access is forwarded to the underlying cached state — or throws
   * if the state has not been loaded yet.
   */
  createProxy(): T & { load: () => Promise<T>; loaded: boolean; invalidate: () => void } {
    return new Proxy(this, {
      get: (target, prop: string | symbol) => {
        if (prop === "load") return target.load.bind(target);
        if (prop === "loaded") return target.loaded;
        if (prop === "invalidate") return target.invalidate.bind(target);

        if (!target.state) {
          throw new Error("State not loaded. Call .load() first");
        }
        return Reflect.get(target.state, prop, target.state);
      },
    }) as unknown as T & { load: () => Promise<T>; loaded: boolean; invalidate: () => void };
  }
}

// ─── Factory Functions ───────────────────────────────────────────────────────

/**
 * Create a virtual proxy that lazy-loads bot status from the API.
 *
 * @example
 * ```ts
 * const proxy = createBotStateProxy("abc-123");
 * const tp = proxy.createProxy();
 * await tp.load();
 * console.log(tp.status, tp.running);
 * ```
 */
export function createBotStateProxy(botId: string): LazyStateProxy<BotStatus> {
  return new LazyStateProxy<BotStatus>(() =>
    fetch(`/api/bots/${botId}/status`).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch bot status: ${res.statusText}`);
      return res.json();
    }),
  );
}

/**
 * Create a virtual proxy that lazy-loads paper trading positions from the API.
 *
 * @example
 * ```ts
 * const proxy = createPositionsProxy("abc-123");
 * const tp = proxy.createProxy();
 * await tp.load();
 * console.log(tp.length, tp[0]?.symbol);
 * ```
 */
export function createPositionsProxy(botId: string): LazyStateProxy<PaperPosition[]> {
  return new LazyStateProxy<PaperPosition[]>(() =>
    fetch(`/api/paper/positions?bot_id=${botId}`).then((res) => {
      if (!res.ok) throw new Error(`Failed to fetch positions: ${res.statusText}`);
      return res.json();
    }),
  );
}

// ─── Type Guard ──────────────────────────────────────────────────────────────

/**
 * Check whether a {@link LazyStateProxy} has finished loading its state.
 *
 * Works with the raw proxy instance (not the transparent wrapper from
 * {@link LazyStateProxy.createProxy}).
 *
 * @example
 * ```ts
 * const proxy = createBotStateProxy("abc");
 * await proxy.load();
 * if (isLoaded(proxy)) {
 *   console.log(proxy.get("status"));
 * }
 * ```
 */
export function isLoaded<T extends object>(proxy: LazyStateProxy<T>): boolean {
  return proxy.loaded;
}
