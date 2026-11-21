// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchDashboard = vi.fn();

vi.mock("../api/optionsDashboard", async () => {
  const actual = await vi.importActual<typeof import("../api/optionsDashboard")>(
    "../api/optionsDashboard",
  );
  return { ...actual, fetchDashboard: (...args: unknown[]) => fetchDashboard(...args) };
});

import { OptionDockError } from "../api/optionsDashboard";
import type { OptionsDashboardData } from "../types/optionsDashboard";
import {
  __dashboardCache,
  __resetDashboard,
  MAX_CACHED_SYMBOLS,
  abortDashboard,
  loadDashboard,
  optionsDashboardState,
  refreshDashboard,
} from "./optionsDashboard";

function payload(symbol: string): OptionsDashboardData {
  return {
    symbol,
    spot: 100,
    asOf: null,
    quotesLive: true,
    marketState: null,
    sessionDate: null,
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
    rv: {
      current: null, rv5: null, rv10: null, rv20: null, rv30: null, source: null,
      cone: { symbol: null, asOf: null, tenors: [], warnings: [] },
      ivVsRv: { rows: [], warnings: [] },
    },
    warnings: [],
    positioning: { deltaOi: [], volume: [] },
    dealer: { gex: [], dex: [], vanna: [], charm: [], theta: [] },
    liquidity: { spread: [], volumeOi: [] },
    realisedVol: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetDashboard();
  fetchDashboard.mockImplementation(async (symbol: string) => payload(symbol.toUpperCase()));
});

afterEach(() => {
  __resetDashboard();
  vi.useRealTimers();
});

describe("loadDashboard", () => {
  it("shares one flight between two opens and serves a cache hit with zero requests", async () => {
    const first = loadDashboard("nifty");
    const second = loadDashboard("NIFTY");
    expect(first).toBe(second);

    await Promise.all([first, second]);
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    expect(optionsDashboardState.status).toBe("ready");

    const cached = await loadDashboard("NIFTY");
    expect(fetchDashboard).toHaveBeenCalledTimes(1);
    expect(cached?.symbol).toBe("NIFTY");
  });

  it("ignores a late response after a symbol switch", async () => {
    let resolveFirst!: (value: OptionsDashboardData) => void;
    fetchDashboard.mockImplementationOnce(
      () => new Promise<OptionsDashboardData>((resolve) => { resolveFirst = resolve; }),
    );

    const stale = loadDashboard("NIFTY");
    const fresh = loadDashboard("BANKNIFTY");
    await fresh;
    resolveFirst(payload("NIFTY"));
    await stale;

    expect(optionsDashboardState.symbol).toBe("BANKNIFTY");
    expect(optionsDashboardState.data?.symbol).toBe("BANKNIFTY");
  });

  it("returns null without fetching for a blank symbol", async () => {
    expect(await loadDashboard("  ")).toBeNull();
    expect(fetchDashboard).not.toHaveBeenCalled();
  });
});

describe("refreshDashboard", () => {
  it("bypasses the cache once and keeps the painted frame while refreshing", async () => {
    await loadDashboard("NIFTY");
    fetchDashboard.mockImplementationOnce(async (symbol: string) => ({
      ...payload(symbol.toUpperCase()),
      spot: 101,
    }));

    const pending = refreshDashboard();
    expect(optionsDashboardState.refreshing).toBe(true);
    expect(optionsDashboardState.data?.spot).toBe(100);
    await pending;

    expect(fetchDashboard).toHaveBeenCalledTimes(2);
    expect(optionsDashboardState.data?.spot).toBe(101);
  });
});

describe("error and abort handling", () => {
  it("maps a typed error to the error band without blanking the last good frame", async () => {
    await loadDashboard("NIFTY");
    fetchDashboard.mockRejectedValueOnce(new OptionDockError("upstream", "Service unavailable", 503));

    await refreshDashboard();

    expect(optionsDashboardState.status).toBe("error");
    expect(optionsDashboardState.error).toMatchObject({ kind: "upstream", message: "Service unavailable" });
    expect(optionsDashboardState.data?.spot).toBe(100);
  });

  it("abortDashboard cancels the in-flight read and keeps cached data", async () => {
    let signal!: AbortSignal;
    fetchDashboard.mockImplementationOnce(
      (_symbol: string, s: AbortSignal) => {
        signal = s;
        return new Promise<OptionsDashboardData | null>((resolve) => {
          s.addEventListener("abort", () => resolve(null), { once: true });
        });
      },
    );

    const pending = loadDashboard("NIFTY");
    expect(signal.aborted).toBe(false);
    abortDashboard();
    expect(signal.aborted).toBe(true);
    expect(await pending).toBeNull();
    expect(optionsDashboardState.status).toBe("idle");
  });

  it("evicts the least-recently used payload past the cache limit", async () => {
    const symbols = ["A", "B", "C", "D", "E", "F", "G"];
    for (const symbol of symbols) await loadDashboard(symbol);
    expect(__dashboardCache.size).toBe(MAX_CACHED_SYMBOLS);
    expect(__dashboardCache.has(symbols[0])).toBe(false);
  });
});
