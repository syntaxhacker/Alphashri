/**
 * Generic single-flight + LRU cache store for one payload per key (a symbol).
 *
 * Every consumer (options analytics, options dashboard, …) shares the same
 * timing rules: a repeat open of the same key is a zero-request cache hit, two
 * concurrent opens share one in-flight request, a symbol switch or abort bumps
 * a generation so a late response cannot paint stale data, and a failed fetch
 * keeps the last good frame — only when it belongs to the same symbol.
 *
 * This module owns only the mechanism. Callers keep their own DTO type, exported
 * names, cache size and default error message via `createSingleFlightStore<T>`.
 */

import { createStore, produce, type SetStoreFunction } from "solid-js/store";
import { OptionDockError } from "../api/optionsDock";

export type SingleFlightStatus = "idle" | "loading" | "ready" | "error";

export interface SingleFlightError {
  kind: string;
  message: string;
}

export interface SingleFlightState<T> {
  symbol: string | null;
  status: SingleFlightStatus;
  error: SingleFlightError | null;
  data: T | null;
  refreshing: boolean;
}

export type SingleFlightFetcher<T> = (symbol: string, signal: AbortSignal) => Promise<T | null>;

interface CreateSingleFlightOptions<T> {
  /** Max payloads kept in the module LRU. Default 5. */
  cacheSize?: number;
  /** Default read path; `load(key, fetcher)` may override it per call. */
  fetcher: SingleFlightFetcher<T>;
  /** Fallback message when the thrown value is not a typed dock error. */
  fallbackErrorMessage?: string;
  /** Override the thrown-error → typed-state mapping. */
  mapError?: (error: unknown) => SingleFlightError;
}

export interface SingleFlightStore<T> {
  /** Reactive store object (status / error / data / refreshing live here). */
  state: SingleFlightState<T>;
  /** Raw `createStore` setter — kept so callers can address fields by path. */
  setState: SetStoreFunction<SingleFlightState<T>>;
  /** Test/introspection hook — no UI reads this directly. */
  cache: Map<string, T>;
  load: (key: string, fetcher?: SingleFlightFetcher<T>) => Promise<T | null>;
  refresh: (key?: string) => Promise<T | null>;
  abort: () => void;
  clear: () => void;
  /** Test-only alias of `clear`; preserves the `__resetX` convention. */
  reset: () => void;
}

const DEFAULT_CACHE_SIZE = 5;
const DEFAULT_FALLBACK_MESSAGE = "Could not load the options analytics";

// A 2xx with no body is not a usable frame. Without a terminal state the panel
// would paint the previous symbol behind a spinner that never resolves.
function emptyPayload(): SingleFlightError {
  return { kind: "empty", message: "The service returned an empty response" };
}

function defaultMapError(error: unknown, fallbackMessage: string): SingleFlightError {
  if (error instanceof OptionDockError) return { kind: error.kind, message: error.message };
  if (error instanceof Error) return { kind: "unknown", message: error.message };
  return { kind: "unknown", message: fallbackMessage };
}

function initialState<T>(): SingleFlightState<T> {
  return { symbol: null, status: "idle", error: null, data: null, refreshing: false };
}

function normalizeKey(key: string): string {
  return String(key ?? "").trim().toUpperCase();
}

export function createSingleFlightStore<T>(
  options: CreateSingleFlightOptions<T>,
): SingleFlightStore<T> {
  const max = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  const defaultFetcher = options.fetcher;
  const fallbackMessage = options.fallbackErrorMessage ?? DEFAULT_FALLBACK_MESSAGE;
  const mapError = options.mapError ?? ((error: unknown) => defaultMapError(error, fallbackMessage));

  const [state, setState] = createStore<SingleFlightState<T>>(initialState<T>());
  const cache = new Map<string, T>();

  interface Flight {
    controller: AbortController;
    symbol: string;
    promise: Promise<T | null>;
  }
  let flight: Flight | null = null;
  let generation = 0;

  function remember(symbol: string, data: T): void {
    cache.delete(symbol);
    cache.set(symbol, data);
    while (cache.size > max) {
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest == null) break;
      cache.delete(oldest);
    }
  }

  type Snapshot<T> = { symbol: string | null; data: T | null };

  /**
   * A failed request may only fall back to a frame painted for the same symbol.
   * Restoring across symbols is what made BANKNIFTY render NIFTY charts after a
   * failed switch, so the requested symbol is left untouched here too.
   */
  function keepFrame(
    draft: SingleFlightState<T>,
    snapshot: Snapshot<T>,
    symbol: string,
  ): void {
    if (snapshot.symbol !== symbol || snapshot.data == null) return;
    draft.data = snapshot.data;
  }

  function startRequest(
    symbol: string,
    keepData: boolean,
    fetcher: SingleFlightFetcher<T>,
  ): Promise<T | null> {
    const token = ++generation;
    const controller = new AbortController();
    const snapshot: Snapshot<T> = { symbol: state.symbol, data: state.data };
    // `refresh(other)` must not keep the current frame either — it belongs to a
    // different symbol.
    const preserveFrame = keepData && snapshot.symbol === symbol;

    setState(
      produce((draft: SingleFlightState<T>) => {
        draft.symbol = symbol;
        draft.error = null;
        draft.refreshing = true;
        draft.status = preserveFrame && draft.data ? "ready" : "loading";
        if (!preserveFrame) draft.data = null;
      }),
    );

    const promise = (async () => {
      try {
        const data = await fetcher(symbol, controller.signal);
        if (controller.signal.aborted || token !== generation) return null;
        if (!data) {
          setState(
            produce((draft: SingleFlightState<T>) => {
              draft.status = "error";
              draft.error = emptyPayload();
              draft.refreshing = false;
              keepFrame(draft, snapshot, symbol);
            }),
          );
          return null;
        }
        remember(symbol, data);
        setState({ status: "ready", error: null, data, refreshing: false });
        return data;
      } catch (error) {
        if (controller.signal.aborted || token !== generation) return null;
        setState(
          produce((draft: SingleFlightState<T>) => {
            draft.status = "error";
            draft.error = mapError(error);
            draft.refreshing = false;
            keepFrame(draft, snapshot, symbol);
          }),
        );
        return null;
      } finally {
        if (flight?.controller === controller) flight = null;
      }
    })();

    flight = { controller, symbol, promise };
    return promise;
  }

  function cancelFlight(): void {
    if (flight) {
      flight.controller.abort();
      flight = null;
    }
  }

  function load(key: string, fetcher: SingleFlightFetcher<T> = defaultFetcher): Promise<T | null> {
    const upper = normalizeKey(key);
    if (!upper) return Promise.resolve(null);
    if (flight && flight.symbol === upper) return flight.promise;

    generation += 1;
    cancelFlight();

    const cached = cache.get(upper);
    if (cached) {
      setState({ symbol: upper, status: "ready", error: null, data: cached, refreshing: false });
      return Promise.resolve(cached);
    }
    return startRequest(upper, false, fetcher);
  }

  function refresh(key?: string): Promise<T | null> {
    const symbol = key === undefined ? state.symbol : normalizeKey(key);
    if (!symbol) return Promise.resolve(null);
    generation += 1;
    cancelFlight();
    return startRequest(symbol, true, defaultFetcher);
  }

  function abort(): void {
    generation += 1;
    cancelFlight();
    setState(
      produce((draft: SingleFlightState<T>) => {
        draft.refreshing = false;
        draft.status = draft.data ? "ready" : "idle";
      }),
    );
  }

  function clear(): void {
    generation += 1;
    cancelFlight();
    cache.clear();
    setState(initialState<T>());
  }

  return { state, setState, cache, load, refresh, abort, clear, reset: clear };
}
