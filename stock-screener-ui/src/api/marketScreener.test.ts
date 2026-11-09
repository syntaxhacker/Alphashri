// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  buildMarketSnapshotUrl,
  fetchMarketSnapshot,
  mapMarketRow,
  mapMarketSnapshot,
  readCachedMarketSnapshot,
  writeCachedMarketSnapshot,
} from "./marketScreener";
import type { MarketSnapshot } from "../types/marketScreener";
import { fetchWithAuth } from "../state/auth";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

const mockFetchWithAuth = vi.mocked(fetchWithAuth);

function mockResponse(ok: boolean, body: unknown, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

describe("buildMarketSnapshotUrl", () => {
  test("defaults to all_equity with the 4000 row cap", () => {
    const url = buildMarketSnapshotUrl();
    expect(url).toContain("/api/market/snapshot?");
    expect(url).toContain("universe=all_equity");
    expect(url).toContain("limit=4000");
    expect(url).not.toContain("force=");
  });

  test("passes an explicit universe and limit", () => {
    const url = buildMarketSnapshotUrl({ universe: "nifty500", limit: 500 });
    expect(url).toContain("universe=nifty500");
    expect(url).toContain("limit=500");
  });

  test("supports every universe value", () => {
    for (const universe of ["all_equity", "nifty500", "nifty50", "nse_fo"]) {
      expect(buildMarketSnapshotUrl({ universe: universe as never })).toContain(
        `universe=${universe}`,
      );
    }
  });

  test("force=true is only sent when requested", () => {
    expect(buildMarketSnapshotUrl({ force: true })).toContain("force=true");
    expect(buildMarketSnapshotUrl({ force: false })).not.toContain("force=");
  });
});

describe("mapMarketSnapshot", () => {
  test("maps snake_case fields to camelCase", () => {
    const snapshot = mapMarketSnapshot({
      as_of: "2026-11-06T15:30:00+05:30",
      universe: "nifty50",
      total: 50,
      update_mode: "streaming",
      rows: [
        {
          symbol: "RELIANCE",
          name: "Reliance Industries",
          sector: "Energy",
          exchange: "NSE",
          close: 2946,
          change: 0.82,
          relative_volume: 1.4,
          market_cap_cr: 199000,
          cap_tier: "Large",
          rsi: 61.2,
          adx: 24.1,
          sma20: 2880,
          sma50: 2800,
          sma200: 2600,
          perf_w: 2.1,
          perf_1m: 4.6,
          high_52w: 3000,
          low_52w: 1800,
          pos_52w: 95,
          fno: true,
          etf: false,
        },
      ],
    });
    expect(snapshot.asOf).toBe("2026-11-06T15:30:00+05:30");
    expect(snapshot.universe).toBe("nifty50");
    expect(snapshot.total).toBe(50);
    expect(snapshot.updateMode).toBe("streaming");
    const row = snapshot.rows[0];
    expect(row).toMatchObject({
      symbol: "RELIANCE",
      name: "Reliance Industries",
      sector: "Energy",
      exchange: "NSE",
      close: 2946,
      change: 0.82,
      relativeVolume: 1.4,
      marketCapCr: 199000,
      capTier: "large",
      rsi: 61.2,
      adx: 24.1,
      sma20: 2880,
      sma50: 2800,
      sma200: 2600,
      perfW: 2.1,
      perf1m: 4.6,
      high52w: 3000,
      low52w: 1800,
      pos52w: 95,
      fno: true,
      etf: false,
    });
  });

  test("mapped row excludes the unused snapshot fields (payload shrink)", () => {
    const snapshot = mapMarketSnapshot({
      as_of: "2026-11-06T15:30:00+05:30",
      universe: "nifty50",
      total: 1,
      update_mode: "streaming",
      rows: [
        {
          symbol: "RELIANCE",
          name: "Reliance Industries",
          sector: "Energy",
          exchange: "NSE",
          close: 2946,
          change: 0.82,
          relative_volume: 1.4,
          market_cap_cr: 199000,
          cap_tier: "large",
          rsi: 61.2,
          adx: 24.1,
          sma20: 2880,
          sma50: 2800,
          sma200: 2600,
          perf_w: 2.1,
          perf_1m: 4.6,
          high_52w: 3000,
          low_52w: 1800,
          pos_52w: 95,
          fno: true,
          etf: false,
        },
      ],
    });
    const row = snapshot.rows[0];
    // The five fields dropped from the backend response must not reach components.
    for (const field of ["industry", "volume", "marketCap", "atr", "perf3m"]) {
      expect(row).not.toHaveProperty(field);
    }
    // Serialized row is smaller than an equivalent row carrying the dropped fields.
    const before = JSON.stringify({
      ...row,
      industry: "Oil & Gas",
      volume: 1234567,
      marketCap: 1990000000000,
      atr: 45,
      perf3m: 8.2,
    });
    const after = JSON.stringify(row);
    expect(after.length).toBeLessThan(before.length);
    expect(Object.keys(row).sort()).toEqual([
      "adx",
      "capTier",
      "change",
      "close",
      "etf",
      "exchange",
      "fno",
      "high52w",
      "low52w",
      "name",
      "perf1m",
      "perfW",
      "pos52w",
      "relativeVolume",
      "rsi",
      "sector",
      "sma20",
      "sma200",
      "sma50",
      "symbol",
      "marketCapCr",
    ].sort());
  });

  test("null and missing numeric fields map to null", () => {
    const row = mapMarketRow({ symbol: "XYZ", close: null, rsi: undefined as never });
    expect(row.close).toBeNull();
    expect(row.rsi).toBeNull();
    expect(row.marketCapCr).toBeNull();
    expect(row.pos52w).toBeNull();
    expect(row.fno).toBe(false);
    expect(row.etf).toBe(false);
    expect(row.capTier).toBeNull();
  });

  test("garbage numerics and empty text map to null", () => {
    const row = mapMarketRow({
      symbol: "  " as never,
      close: "not-a-number" as never,
      change: Number.NaN as never,
      rsi: "" as never,
      sector: 42 as never,
    });
    expect(row.symbol).toBe("");
    expect(row.close).toBeNull();
    expect(row.change).toBeNull();
    expect(row.rsi).toBeNull();
    expect(row.sector).toBeNull();
  });

  test("numeric strings are coerced, booleans loosened", () => {
    const row = mapMarketRow({
      symbol: "ABC",
      close: "123.45" as never,
      fno: 1 as never,
      etf: "true" as never,
    });
    expect(row.close).toBe(123.45);
    expect(row.fno).toBe(true);
    expect(row.etf).toBe(true);
  });

  test("snapshot without rows yields an empty list and sane defaults", () => {
    const snapshot = mapMarketSnapshot({});
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.total).toBe(0);
    expect(snapshot.updateMode).toBe("unknown");
    expect(snapshot.asOf).toBeNull();
    expect(snapshot.universe).toBe("all_equity");
  });

  test("total falls back to the row count when absent", () => {
    const snapshot = mapMarketSnapshot({ rows: [{ symbol: "A" }, { symbol: "B" }] });
    expect(snapshot.total).toBe(2);
  });
});

describe("fetchMarketSnapshot", () => {
  test("requests the snapshot url and maps the payload", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        as_of: "2026-11-06T15:30:00+05:30",
        universe: "nifty50",
        total: 1,
        update_mode: "streaming",
        rows: [{ symbol: "RELIANCE", close: 2946, market_cap_cr: 199000 }],
      }),
    );
    const result = await fetchMarketSnapshot({ universe: "nifty50", force: true });
    const calledUrl = mockFetchWithAuth.mock.calls[0][0] as string;
    expect(calledUrl).toContain("universe=nifty50");
    expect(calledUrl).toContain("force=true");
    expect(result.updateMode).toBe("streaming");
    expect(result.rows[0].marketCapCr).toBe(199000);
  });

  test("throws the server detail on !ok", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, { detail: "bad universe" }, 400));
    await expect(fetchMarketSnapshot({ universe: "nse_fo" })).rejects.toThrow("bad universe");
  });

  test("throws HTTP status when no detail is present", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(false, {}, 503));
    await expect(fetchMarketSnapshot()).rejects.toThrow("503");
  });

  test("forwards AbortSignal via init", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, { rows: [] }));
    const controller = new AbortController();
    await fetchMarketSnapshot({}, { signal: controller.signal });
    expect(mockFetchWithAuth.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});

describe("snapshot cache (sessionStorage)", () => {
  function cachedSnapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
    return {
      asOf: "2026-11-06T15:30:00+05:30",
      universe: "all_equity",
      total: 2,
      updateMode: "streaming",
      rows: [
        mapMarketRow({ symbol: "RELIANCE", close: 2946 }),
        mapMarketRow({ symbol: "TCS", close: 3100 }),
      ],
      ...overrides,
    };
  }

  test("write then read round-trips the snapshot per universe", () => {
    writeCachedMarketSnapshot("all_equity", cachedSnapshot({ total: 123 }));
    writeCachedMarketSnapshot("nifty500", cachedSnapshot({ universe: "nifty500", total: 500 }));
    expect(readCachedMarketSnapshot("all_equity")?.total).toBe(123);
    expect(readCachedMarketSnapshot("nifty500")?.total).toBe(500);
    expect(readCachedMarketSnapshot("nifty50")).toBeNull();
  });

  test("read returns null for malformed JSON and clears the key", () => {
    window.sessionStorage.setItem("alphashri.market_snapshot.v1.all_equity", "{oops");
    expect(readCachedMarketSnapshot("all_equity")).toBeNull();
    expect(window.sessionStorage.getItem("alphashri.market_snapshot.v1.all_equity")).toBeNull();
  });

  test("read returns null for a universe mismatch", () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify(cachedSnapshot({ universe: "nifty50" })),
    );
    expect(readCachedMarketSnapshot("all_equity")).toBeNull();
  });

  test("read returns null when a row has no usable symbol", () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify({ ...cachedSnapshot(), rows: [{ name: "ghost" }] }),
    );
    expect(readCachedMarketSnapshot("all_equity")).toBeNull();
  });

  test("read returns null when total is not a finite number", () => {
    window.sessionStorage.setItem(
      "alphashri.market_snapshot.v1.all_equity",
      JSON.stringify({ ...cachedSnapshot(), total: "lots" }),
    );
    expect(readCachedMarketSnapshot("all_equity")).toBeNull();
  });

  test("an oversized payload is not written", () => {
    const fat = mapMarketRow({ symbol: "FAT" });
    const hugeRows = Array.from({ length: 4000 }, () => ({
      ...fat,
      name: "x".repeat(900),
    }));
    writeCachedMarketSnapshot("all_equity", cachedSnapshot({ rows: hugeRows, total: 4000 }));
    expect(readCachedMarketSnapshot("all_equity")).toBeNull();
  });

  test("cache never stores filters — payload has exactly the snapshot keys", () => {
    writeCachedMarketSnapshot("all_equity", cachedSnapshot());
    const raw = window.sessionStorage.getItem("alphashri.market_snapshot.v1.all_equity");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["asOf", "rows", "total", "universe", "updateMode"]);
  });
});
