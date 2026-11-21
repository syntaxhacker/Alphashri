// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OptionDockError } from "../api/optionsDock";
import { createSingleFlightStore, type SingleFlightFetcher, type SingleFlightStore } from "./createSingleFlightStore";

interface Payload {
  symbol: string;
  spot: number;
}

function payload(symbol: string, spot = 100): Payload {
  return { symbol, spot };
}

describe("createSingleFlightStore", () => {
  let fetcher: ReturnType<typeof vi.fn<SingleFlightFetcher<Payload>>>;
  let store: SingleFlightStore<Payload>;

  beforeEach(() => {
    fetcher = vi.fn(async (symbol: string) => payload(symbol.toUpperCase()));
    store = createSingleFlightStore<Payload>({ cacheSize: 3, fetcher });
  });

  afterEach(() => {
    store.reset();
    vi.useRealTimers();
  });

  describe("single-flight + cache hit", () => {
    it("shares one flight between concurrent opens and serves a cache hit with zero requests", async () => {
      const first = store.load("nifty");
      const second = store.load("NIFTY");
      expect(first).toBe(second);

      await Promise.all([first, second]);
      expect(fetcher).toHaveBeenCalledTimes(1);

      const cached = await store.load("NIFTY");
      expect(cached?.symbol).toBe("NIFTY");
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.state.data?.symbol).toBe("NIFTY");
    });

    it("returns null without fetching for a blank key", async () => {
      expect(await store.load("  ")).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("accepts a per-call fetcher override", async () => {
      const override = vi.fn(async (symbol: string) => payload(symbol.toUpperCase(), 7));
      const data = await store.load("NIFTY", override);

      expect(override).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
      expect(data?.spot).toBe(7);
    });
  });

  describe("LRU cache", () => {
    it("evicts the oldest key past the configured size", async () => {
      for (const symbol of ["A", "B", "C", "D"]) await store.load(symbol);

      expect(fetcher).toHaveBeenCalledTimes(4);
      expect(store.cache.size).toBe(3);
      expect(store.cache.has("A")).toBe(false);
      expect(store.cache.has("B")).toBe(true);
      expect(store.cache.has("D")).toBe(true);
    });

    it("clear() drops the cache and resets the state", async () => {
      await store.load("NIFTY");
      store.clear();

      expect(store.cache.size).toBe(0);
      expect(store.state).toMatchObject({
        symbol: null,
        status: "idle",
        error: null,
        data: null,
        refreshing: false,
      });
    });
  });

  describe("generation / abort", () => {
    it("aborts the stale flight when the symbol switches", async () => {
      let resolveFirst!: (value: Payload) => void;
      let firstSignal!: AbortSignal;
      fetcher.mockImplementationOnce((_symbol: string, signal: AbortSignal) => {
        firstSignal = signal;
        return new Promise<Payload>((resolve) => {
          resolveFirst = resolve;
        });
      });

      const stale = store.load("NIFTY");
      expect(firstSignal.aborted).toBe(false);

      const fresh = store.load("BANKNIFTY");
      expect(firstSignal.aborted).toBe(true);

      await fresh;
      resolveFirst(payload("NIFTY"));
      expect(await stale).toBeNull();

      expect(store.state.symbol).toBe("BANKNIFTY");
      expect(store.state.data?.symbol).toBe("BANKNIFTY");
    });

    it("abort() cancels the in-flight read and retains the last frame and cache", async () => {
      await store.load("NIFTY");
      let signal!: AbortSignal;
      fetcher.mockImplementationOnce((_symbol: string, s: AbortSignal) => {
        signal = s;
        return new Promise<Payload | null>((resolve) => {
          s.addEventListener("abort", () => resolve(null), { once: true });
        });
      });

      const pending = store.refresh();
      expect(store.state.refreshing).toBe(true);

      store.abort();
      expect(signal.aborted).toBe(true);
      expect(await pending).toBeNull();

      expect(store.state.refreshing).toBe(false);
      expect(store.state.status).toBe("ready");
      expect(store.state.data?.symbol).toBe("NIFTY");
      expect(store.cache.get("NIFTY")?.symbol).toBe("NIFTY");
    });
  });

  describe("error preservation", () => {
    it("refresh bypasses the cache once and keeps the painted frame while refreshing", async () => {
      await store.load("NIFTY");
      fetcher.mockImplementationOnce(async (symbol: string) => payload(symbol.toUpperCase(), 101));

      const pending = store.refresh();
      expect(store.state.refreshing).toBe(true);
      expect(store.state.data?.spot).toBe(100);

      await pending;
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(store.state.data?.spot).toBe(101);
      expect(store.state.refreshing).toBe(false);
    });

    it("keeps the last good frame and surfaces a typed error on failure", async () => {
      await store.load("NIFTY");
      fetcher.mockRejectedValueOnce(new OptionDockError("rate_limited", "Rate limited", 429));

      await store.refresh();

      expect(store.state.status).toBe("error");
      expect(store.state.error).toEqual({ kind: "rate_limited", message: "Rate limited" });
      expect(store.state.symbol).toBe("NIFTY");
      expect(store.state.data?.symbol).toBe("NIFTY");
      expect(store.state.refreshing).toBe(false);
    });

    it("drops the previous symbol's frame when the new symbol fails to load", async () => {
      await store.load("NIFTY");
      fetcher.mockRejectedValueOnce(
        new OptionDockError("network", "Could not reach the options service"),
      );

      const result = await store.load("BANKNIFTY");

      expect(result).toBeNull();
      expect(store.state.symbol).toBe("BANKNIFTY");
      expect(store.state.status).toBe("error");
      expect(store.state.error).toEqual({
        kind: "network",
        message: "Could not reach the options service",
      });
      expect(store.state.data).toBeNull();
      expect(store.state.refreshing).toBe(false);
    });

    it("drops the current frame when refreshing a different symbol fails", async () => {
      await store.load("NIFTY");
      fetcher.mockRejectedValueOnce(new OptionDockError("upstream", "Boom", 503));

      await store.refresh("BANKNIFTY");

      expect(store.state.symbol).toBe("BANKNIFTY");
      expect(store.state.status).toBe("error");
      expect(store.state.data).toBeNull();
      expect(store.state.refreshing).toBe(false);
    });

    it("treats a 2xx empty body as a terminal error, not a stuck load", async () => {
      fetcher.mockResolvedValueOnce(null);

      const result = await store.load("BANKNIFTY");

      expect(result).toBeNull();
      expect(store.state.symbol).toBe("BANKNIFTY");
      expect(store.state.status).toBe("error");
      expect(store.state.error?.kind).toBe("empty");
      expect(store.state.data).toBeNull();
      expect(store.state.refreshing).toBe(false);
    });

    it("keeps the same-symbol frame on an empty refresh response", async () => {
      await store.load("NIFTY");
      fetcher.mockResolvedValueOnce(null);

      await store.refresh();

      expect(store.state.status).toBe("error");
      expect(store.state.error?.kind).toBe("empty");
      expect(store.state.data?.symbol).toBe("NIFTY");
      expect(store.state.refreshing).toBe(false);
    });
  });
});
