// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchAnalytics = vi.fn();

vi.mock("../api/optionsAnalytics", async () => {
  const actual = await vi.importActual<typeof import("../api/optionsAnalytics")>(
    "../api/optionsAnalytics",
  );
  return {
    ...actual,
    fetchAnalytics: (...args: unknown[]) => fetchAnalytics(...args),
  };
});

import { OptionDockError, type OptionsAnalytics } from "../api/optionsAnalytics";
import {
  __analyticsCache,
  __resetAnalytics,
  abortAnalytics,
  clearAnalytics,
  loadAnalytics,
  optionsAnalyticsState,
  refreshAnalytics,
} from "./optionsAnalytics";

function payload(symbol: string, spot = 100): OptionsAnalytics {
  return {
    symbol,
    spot,
    asOf: null,
    quotesLive: true,
    expiries: [],
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetAnalytics();
  fetchAnalytics.mockImplementation(async (symbol: string) => payload(symbol.toUpperCase()));
});

afterEach(() => {
  __resetAnalytics();
  vi.useRealTimers();
});

describe("loadAnalytics", () => {
  it("shares one flight between two opens and serves a cache hit with zero requests", async () => {
    const first = loadAnalytics("nifty");
    const second = loadAnalytics("NIFTY");
    expect(first).toBe(second);

    await Promise.all([first, second]);
    expect(fetchAnalytics).toHaveBeenCalledTimes(1);
    expect(optionsAnalyticsState.symbol).toBe("NIFTY");
    expect(optionsAnalyticsState.status).toBe("ready");

    const cached = await loadAnalytics("NIFTY");
    expect(fetchAnalytics).toHaveBeenCalledTimes(1);
    expect(cached?.symbol).toBe("NIFTY");
    expect(optionsAnalyticsState.data?.symbol).toBe("NIFTY");
  });

  it("costs exactly one request for a new symbol", async () => {
    await loadAnalytics("NIFTY");
    await loadAnalytics("BANKNIFTY");

    expect(fetchAnalytics).toHaveBeenCalledTimes(2);
    expect(optionsAnalyticsState.symbol).toBe("BANKNIFTY");
    expect(__analyticsCache.size).toBe(2);
  });

  it("ignores a late response after a symbol switch", async () => {
    let resolveFirst!: (value: OptionsAnalytics) => void;
    fetchAnalytics.mockImplementationOnce(
      () => new Promise<OptionsAnalytics>((resolve) => { resolveFirst = resolve; }),
    );

    const stale = loadAnalytics("NIFTY");
    const fresh = loadAnalytics("BANKNIFTY");
    await fresh;
    resolveFirst(payload("NIFTY"));
    await stale;

    expect(optionsAnalyticsState.symbol).toBe("BANKNIFTY");
    expect(optionsAnalyticsState.data?.symbol).toBe("BANKNIFTY");
  });
});

describe("refreshAnalytics", () => {
  it("bypasses the cache once and keeps the painted frame while refreshing", async () => {
    await loadAnalytics("NIFTY");
    fetchAnalytics.mockImplementationOnce(async () => payload("NIFTY", 101));

    const pending = refreshAnalytics();
    expect(optionsAnalyticsState.refreshing).toBe(true);
    expect(optionsAnalyticsState.data?.spot).toBe(100);
    await pending;

    expect(fetchAnalytics).toHaveBeenCalledTimes(2);
    expect(optionsAnalyticsState.data?.spot).toBe(101);
    expect(optionsAnalyticsState.refreshing).toBe(false);
  });

  it("keeps the last data and surfaces a typed error on failure", async () => {
    await loadAnalytics("NIFTY");
    fetchAnalytics.mockRejectedValueOnce(new OptionDockError("rate_limited", "Rate limited", 429));

    await refreshAnalytics();

    expect(optionsAnalyticsState.status).toBe("error");
    expect(optionsAnalyticsState.error).toEqual({ kind: "rate_limited", message: "Rate limited" });
    expect(optionsAnalyticsState.data?.symbol).toBe("NIFTY");
    expect(optionsAnalyticsState.refreshing).toBe(false);
  });
});

describe("abortAnalytics", () => {
  it("cancels an in-flight refresh and retains the cache and last frame", async () => {
    await loadAnalytics("NIFTY");
    fetchAnalytics.mockImplementationOnce(() => new Promise<OptionsAnalytics>(() => {}));

    void refreshAnalytics();
    expect(optionsAnalyticsState.refreshing).toBe(true);
    abortAnalytics();

    expect(optionsAnalyticsState.refreshing).toBe(false);
    expect(optionsAnalyticsState.status).toBe("ready");
    expect(optionsAnalyticsState.data?.symbol).toBe("NIFTY");
    expect(__analyticsCache.get("NIFTY")?.symbol).toBe("NIFTY");
  });
});

describe("cache lifecycle", () => {
  it("evicts the oldest symbol past five entries", async () => {
    for (const symbol of ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"]) {
      await loadAnalytics(symbol);
    }

    expect(fetchAnalytics).toHaveBeenCalledTimes(6);
    expect(__analyticsCache.size).toBe(5);
    expect(__analyticsCache.has("AAA")).toBe(false);
    expect(__analyticsCache.has("FFF")).toBe(true);
  });

  it("clearAnalytics drops the cache and resets the state", async () => {
    await loadAnalytics("NIFTY");
    clearAnalytics();

    expect(__analyticsCache.size).toBe(0);
    expect(optionsAnalyticsState).toMatchObject({
      symbol: null,
      status: "idle",
      error: null,
      data: null,
      refreshing: false,
    });
  });
});
