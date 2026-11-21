// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach } from "vitest";
import {
  buildMarketSnapshotUrl,
  decodeColumnarSnapshot,
  fetchMarketSnapshot,
  fetchQuotes,
  MARKET_UNIVERSES,
  mapMarketRow,
  mapMarketSnapshot,
  readCachedMarketSnapshot,
  writeCachedMarketSnapshot,
} from "./marketScreener";
import { MARKET_ROW_CAP, MARKET_SYMBOL_CAP } from "../config/apiLimits";
import { MARKET_UNIVERSE_DESCRIPTORS } from "../config/marketUniverses";
import type { MarketSnapshot } from "../types/marketScreener";
import { fetchWithAuth } from "../state/auth";
import { ApiError } from "./apiError";

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
    expect(url).toContain(`limit=${MARKET_ROW_CAP}`);
    expect(url).not.toContain("force=");
  });

  test("passes an explicit universe and limit", () => {
    const url = buildMarketSnapshotUrl({ universe: "nifty500", limit: 500 });
    expect(url).toContain("universe=nifty500");
    expect(url).toContain("limit=500");
  });

  test("supports every universe value", () => {
    for (const universe of ["all_equity", "nifty500", "nifty50", "nse_fo", "us"]) {
      expect(buildMarketSnapshotUrl({ universe: universe as never })).toContain(
        `universe=${universe}`,
      );
    }
  });

  test("the first Market dropdown offers USA alongside every registered NSE universe", () => {
    // The dropdown is a projection of the canonical registry: assert that
    // contract, not a frozen list, so adding a universe cannot break this test
    // but silently dropping one still can.
    const dropdownValues = MARKET_UNIVERSES.map((option) => option.value);
    const registryValues = MARKET_UNIVERSE_DESCRIPTORS.map((descriptor) => descriptor.value);

    expect(new Set(dropdownValues).size).toBe(dropdownValues.length); // no duplicate ids
    expect([...dropdownValues].sort()).toEqual([...registryValues].sort()); // no dropped/extra ids
    for (const descriptor of MARKET_UNIVERSE_DESCRIPTORS) {
      expect(MARKET_UNIVERSES).toContainEqual({
        value: descriptor.value,
        label: descriptor.label,
      });
    }

    // Original intent: USA is offered alongside the NSE universes.
    expect(MARKET_UNIVERSES).toContainEqual({ value: "us", label: "USA" });
  });

  test("force=true is only sent when requested", () => {
    expect(buildMarketSnapshotUrl({ force: true })).toContain("force=true");
    expect(buildMarketSnapshotUrl({ force: false })).not.toContain("force=");
  });

  test("symbols are sent comma-separated only when present", () => {
    expect(buildMarketSnapshotUrl()).not.toContain("symbols=");
    expect(buildMarketSnapshotUrl({ symbols: [] })).not.toContain("symbols=");
    expect(buildMarketSnapshotUrl({ symbols: ["KAYNES", "IRCON"] })).toContain(
      "symbols=KAYNES%2CIRCON",
    );
  });

  test("format=columns is only sent when requested", () => {
    expect(buildMarketSnapshotUrl()).not.toContain("format=");
    expect(buildMarketSnapshotUrl({ format: "columns" })).toContain("format=columns");
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
    for (const field of ["industry", "volume", "marketCap", "atr", "perf3m"]) {
      expect(row).not.toHaveProperty(field);
    }
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
      "currency",
      "currentRatio",
      "debtToEquity",
      "dividendYield",
      "epsYoy",
      "etf",
      "exchange",
      "fcfYield",
      "fno",
      "grossMargin",
      "high52w",
      "low52w",
      "marketCapCr",
      "marketCapUsdB",
      "name",
      "netIncome",
      "operatingMargin",
      "pbRatio",
      "peRatio",
      "perf1m",
      "perfW",
      "pos52w",
      "psRatio",
      "relativeVolume",
      "revenue",
      "revYoy",
      "roe",
      "rsi",
      "sector",
      "sma20",
      "sma200",
      "sma50",
      "symbol",
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

describe("decodeColumnarSnapshot", () => {
  /** Three columns deliberately carry null / float / boolean edge values. */
  function columnarPayload() {
    return {
      format: "columns-v1",
      meta: {
        as_of: "2026-11-06T15:30:00+05:30",
        universe: "nifty50",
        total: 3,
        update_mode: "streaming",
      },
      fields: [
        "symbol",
        "name",
        "close",
        "change",
        "fno",
        "etf",
        "market_cap_cr",
        "currency",
        "marketCapUsdB",
        "cap_tier",
        "rsi",
      ],
      columns: {
        symbol: ["RELIANCE", "AAPL", "NOPE"],
        name: ["Reliance Industries", "Apple Inc", "No Coverage"],
        close: [2946, 189.5, null],
        change: [0.82, -1.25, null],
        fno: [true, false, null],
        etf: [false, true, 1],
        market_cap_cr: [199000, null, null],
        currency: ["INR", "USD", "INR"],
        marketCapUsdB: [null, 46200.7, null],
        cap_tier: ["Large", "Large", null],
        rsi: [61.2, null, 44],
      },
    };
  }

  test("empty columns decode to an empty row set", () => {
    const snapshot = decodeColumnarSnapshot({
      format: "columns-v1",
      meta: {
        as_of: "2026-11-06T15:30:00+05:30",
        universe: "nifty50",
        total: 0,
        update_mode: "streaming",
      },
      fields: [],
      columns: {},
    });
    expect(snapshot.rows).toEqual([]);
    expect(snapshot.total).toBe(0);
  });

  test("reconstructs the exact rows, preserving null/float/boolean values", () => {
    const snapshot = decodeColumnarSnapshot(columnarPayload());
    expect(snapshot.asOf).toBe("2026-11-06T15:30:00+05:30");
    expect(snapshot.universe).toBe("nifty50");
    expect(snapshot.total).toBe(3);
    expect(snapshot.updateMode).toBe("streaming");
    expect(snapshot.rows).toHaveLength(3);

    expect(snapshot.rows[0]).toEqual({
      symbol: "RELIANCE",
      name: "Reliance Industries",
      sector: null,
      exchange: null,
      close: 2946,
      change: 0.82,
      relativeVolume: null,
      marketCapCr: 199000,
      marketCapUsdB: null,
      currency: "INR",
      capTier: "large",
      rsi: 61.2,
      adx: null,
      sma20: null,
      sma50: null,
      sma200: null,
      perfW: null,
      perf1m: null,
      high52w: null,
      low52w: null,
      pos52w: null,
      peRatio: null,
      pbRatio: null,
      dividendYield: null,
      roe: null,
      psRatio: null,
      fcfYield: null,
      revenue: null,
      netIncome: null,
      debtToEquity: null,
      currentRatio: null,
      grossMargin: null,
      operatingMargin: null,
      revYoy: null,
      epsYoy: null,
      fno: true,
      etf: false,
    });

    const usd = snapshot.rows[1];
    expect(usd.currency).toBe("USD");
    expect(usd.marketCapUsdB).toBe(46200.7);
    expect(usd.marketCapCr).toBeNull();
    expect(usd.fno).toBe(false);
    expect(usd.etf).toBe(true);

    const sparse = snapshot.rows[2];
    expect(sparse.close).toBeNull();
    expect(sparse.change).toBeNull();
    expect(sparse.rsi).toBe(44);
    expect(sparse.capTier).toBeNull();
    // A null boolean column value is "unknown", never true.
    expect(sparse.fno).toBe(false);
    expect(sparse.etf).toBe(true);
  });

  test("field order drives reconstruction, not the columns' own key order", () => {
    const payload = columnarPayload();
    const columns: Record<string, unknown[]> = {};
    for (const field of [...payload.fields].reverse()) {
      columns[field] = payload.columns[field as keyof typeof payload.columns];
    }
    expect(Object.keys(columns)).toEqual([...payload.fields].reverse());
    expect(decodeColumnarSnapshot({ ...payload, columns }).rows.map((row) => row.symbol)).toEqual([
      "RELIANCE",
      "AAPL",
      "NOPE",
    ]);
  });

  test("rejects a non-object payload", () => {
    expect(() => decodeColumnarSnapshot(null)).toThrow(/expected a JSON object/);
    expect(() => decodeColumnarSnapshot([])).toThrow(/expected a JSON object/);
    expect(() => decodeColumnarSnapshot("columns-v1")).toThrow(/expected a JSON object/);
  });

  test("rejects an unsupported format", () => {
    expect(() =>
      decodeColumnarSnapshot({ ...columnarPayload(), format: "columns-v2" }),
    ).toThrow(/unsupported format/);
    const noFormat: Record<string, unknown> = { ...columnarPayload() };
    delete noFormat.format;
    expect(() => decodeColumnarSnapshot(noFormat)).toThrow(/unsupported format/);
  });

  test("rejects malformed meta, fields and columns", () => {
    const payload = columnarPayload();
    expect(() => decodeColumnarSnapshot({ ...payload, meta: null })).toThrow(
      /meta must be an object/,
    );
    expect(() => decodeColumnarSnapshot({ ...payload, fields: [] })).toThrow(
      /columns must be empty when fields is empty/,
    );
    expect(() => decodeColumnarSnapshot({ ...payload, fields: ["symbol", ""] })).toThrow(
      /non-empty strings/,
    );
    expect(() => decodeColumnarSnapshot({ ...payload, fields: ["symbol", "symbol"] })).toThrow(
      /duplicate field "symbol"/,
    );
    expect(() => decodeColumnarSnapshot({ ...payload, columns: null })).toThrow(
      /columns must be an object/,
    );
  });

  test("rejects a missing or non-array column", () => {
    const payload = columnarPayload();
    const withoutRsi: Record<string, unknown> = { ...payload.columns };
    delete withoutRsi.rsi;
    expect(() => decodeColumnarSnapshot({ ...payload, columns: withoutRsi })).toThrow(
      /missing column "rsi"/,
    );
    expect(() =>
      decodeColumnarSnapshot({
        ...payload,
        columns: { ...payload.columns, rsi: "not-an-array" },
      }),
    ).toThrow(/column "rsi" must be an array/);
  });

  test("rejects ragged columns instead of shifting values across rows", () => {
    const payload = columnarPayload();
    expect(() =>
      decodeColumnarSnapshot({
        ...payload,
        columns: { ...payload.columns, close: [2946, 189.5] },
      }),
    ).toThrow(/column "close" has 2 values, expected 3/);
    expect(() =>
      decodeColumnarSnapshot({
        ...payload,
        columns: { ...payload.columns, rsi: [61.2, null, 44, 12] },
      }),
    ).toThrow(/column "rsi" has 4 values, expected 3/);
  });
});

describe("currency-aware row mapping", () => {
  test("USD rows normalize the backend's camelCase cap and currency", () => {
    const snapshot = mapMarketSnapshot({
      universe: "us",
      rows: [
        {
          symbol: "NVDA",
          exchange: "NASDAQ",
          close: 189.5,
          currency: "usd",
          marketCapUsdB: 46200.7,
          cap_tier: "Large",
        },
      ],
    });
    const row = snapshot.rows[0];
    expect(row.currency).toBe("USD");
    expect(row.marketCapUsdB).toBe(46200.7);
    // The backend emits null for the rupee field on US rows — never fabricate one.
    expect(row.marketCapCr).toBeNull();
    expect(row.capTier).toBe("large");
  });

  test("the snake_case cap spelling is accepted too", () => {
    expect(mapMarketRow({ currency: "USD", market_cap_usd_b: "1234.5" }).marketCapUsdB).toBe(
      1234.5,
    );
  });

  test("legacy and INR rows stay INR with a null dollar cap", () => {
    expect(mapMarketRow({ market_cap_cr: 199000 }).currency).toBe("INR");
    expect(mapMarketRow({ currency: "INR", marketCapUsdB: 42 }).marketCapUsdB).toBeNull();
    expect(mapMarketRow({ currency: null }).marketCapUsdB).toBeNull();
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

  test("default request has no format param and parses plain rows", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, { rows: [{ symbol: "RELIANCE", close: 2946 }] }),
    );
    const result = await fetchMarketSnapshot();
    expect(mockFetchWithAuth.mock.calls[0][0] as string).not.toContain("format=");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].close).toBe(2946);
  });

  test("format=columns requests the columnar wire format and decodes it", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        format: "columns-v1",
        meta: { as_of: "2026-11-06T15:30:00+05:30", universe: "us", total: 2, update_mode: "cached" },
        fields: ["symbol", "close", "change", "fno"],
        columns: {
          symbol: ["AAPL", "NOPE"],
          close: [189.5, null],
          change: [-1.25, null],
          fno: [true, null],
        },
      }),
    );
    const result = await fetchMarketSnapshot({ universe: "us", format: "columns" });
    expect(mockFetchWithAuth.mock.calls[0][0] as string).toContain("format=columns");
    expect(result.universe).toBe("us");
    expect(result.total).toBe(2);
    expect(result.updateMode).toBe("cached");
    expect(result.rows.map((row) => [row.symbol, row.close, row.change, row.fno])).toEqual([
      ["AAPL", 189.5, -1.25, true],
      ["NOPE", null, null, false],
    ]);
  });

  test("a columnar body is decoded even when the caller did not request it", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        format: "columns-v1",
        meta: { total: 1, update_mode: "streaming" },
        fields: ["symbol", "close"],
        columns: { symbol: ["TCS"], close: [3100] },
      }),
    );
    const result = await fetchMarketSnapshot({ universe: "nifty50" });
    expect(mockFetchWithAuth.mock.calls[0][0] as string).not.toContain("format=");
    expect(result.rows).toEqual([expect.objectContaining({ symbol: "TCS", close: 3100 })]);
  });

  test("format=columns falls back to the plain envelope from an older backend", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        as_of: "2026-11-06T15:30:00+05:30",
        universe: "nifty50",
        total: 1,
        update_mode: "cached",
        rows: [{ symbol: "RELIANCE", close: 2946 }],
      }),
    );
    const result = await fetchMarketSnapshot({ format: "columns" });
    expect(mockFetchWithAuth.mock.calls[0][0] as string).toContain("format=columns");
    expect(result.updateMode).toBe("cached");
    expect(result.rows).toEqual([expect.objectContaining({ symbol: "RELIANCE", close: 2946 })]);
  });

  test("format=columns with neither shape is still a decode error", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(mockResponse(true, { detail: "nope" }));
    await expect(fetchMarketSnapshot({ format: "columns" })).rejects.toThrow(
      /Malformed columnar market snapshot/,
    );
  });

  test("format=columns with an unsupported columnar version still throws", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        format: "columns-v2",
        meta: {},
        fields: ["symbol"],
        columns: { symbol: ["RELIANCE"] },
      }),
    );
    await expect(fetchMarketSnapshot({ format: "columns" })).rejects.toThrow(
      /unsupported format/,
    );
  });

  test("format=columns with a ragged body rejects the response", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        format: "columns-v1",
        meta: {},
        fields: ["symbol", "close"],
        columns: { symbol: ["A", "B"], close: [1] },
      }),
    );
    await expect(fetchMarketSnapshot({ format: "columns" })).rejects.toThrow(
      /column "close" has 1 values, expected 2/,
    );
  });
});

describe("fetchQuotes", () => {
  test("requests the snapshot symbols filter and returns only the needed fields", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        rows: [
          { symbol: "KAYNES", close: 2986, change: -12.94, name: "Kaynes Technology" },
          { symbol: "IRCON", close: 3430, change: -1.55 },
        ],
      }),
    );
    const quotes = await fetchQuotes(["KAYNES", "IRCON"]);
    expect(mockFetchWithAuth.mock.calls[0][0]).toContain("symbols=KAYNES%2CIRCON");
    expect(quotes).toEqual([
      { symbol: "KAYNES", close: 2986, change: -12.94 },
      { symbol: "IRCON", close: 3430, change: -1.55 },
    ]);
  });

  test("an empty symbol list short-circuits with no network call", async () => {
    expect(await fetchQuotes([])).toEqual([]);
    expect(await fetchQuotes(["  ", ""])).toEqual([]);
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  test("maps missing numerics to null", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, { rows: [{ symbol: "NOPE" }] }),
    );
    expect(await fetchQuotes(["NOPE"])).toEqual([
      { symbol: "NOPE", close: null, change: null },
    ]);
  });

  test("throws the server detail on !ok", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(false, { detail: "symbols accepts at most 20 symbols" }, 400),
    );
    await expect(fetchQuotes(["A"])).rejects.toThrow("at most 20");
  });

  test("one failed batch does not reject the whole set; returns the partial set", async () => {
    const batch1 = Array.from({ length: MARKET_SYMBOL_CAP }, (_, i) => `SYM${i + 1}`);
    mockFetchWithAuth
      .mockResolvedValueOnce(
        mockResponse(
          true,
          { rows: batch1.map((s) => ({ symbol: s, close: 100, change: 1 })) },
        ),
      )
      .mockRejectedValueOnce(new Error("batch 2 down"));
    const quotes = await fetchQuotes([...batch1, "SYM21"]);
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
    expect(quotes).toHaveLength(MARKET_SYMBOL_CAP);
    expect(quotes.map((q) => q.symbol)).toEqual(batch1);
  });

  test("all batches fail rethrows the first error", async () => {
    const symbols = Array.from({ length: MARKET_SYMBOL_CAP + 1 }, (_, i) => `SYM${i + 1}`);
    mockFetchWithAuth
      .mockRejectedValueOnce(new Error("first batch down"))
      .mockRejectedValueOnce(new Error("second batch down"));
    await expect(fetchQuotes(symbols)).rejects.toThrow("first batch down");
  });

  test("a single symbol still makes exactly one request", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, { rows: [{ symbol: "KAYNES", close: 2986, change: -12.94 }] }),
    );
    const quotes = await fetchQuotes(["KAYNES"]);
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    expect((mockFetchWithAuth.mock.calls[0][0] as string)).toContain("symbols=KAYNES");
    expect(quotes).toEqual([{ symbol: "KAYNES", close: 2986, change: -12.94 }]);
  });

  test("cap+1 symbols are deduped, chunked into cap-sized batches, and merged in input order", async () => {
    const symbols = Array.from({ length: MARKET_SYMBOL_CAP + 1 }, (_, i) => `SYM${i + 1}`);
    const batch1 = symbols.slice(0, MARKET_SYMBOL_CAP);
    const batch2 = symbols.slice(MARKET_SYMBOL_CAP);
    mockFetchWithAuth
      .mockResolvedValueOnce(
        mockResponse(true, { rows: batch1.map((s) => ({ symbol: s, close: 100, change: 1 })) }),
      )
      .mockResolvedValueOnce(
        mockResponse(true, { rows: batch2.map((s) => ({ symbol: s, close: 200, change: -1 })) }),
      );
    const quotes = await fetchQuotes(symbols);
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
    expect((mockFetchWithAuth.mock.calls[0][0] as string)).toContain(
      `symbols=${batch1.join("%2C")}`,
    );
    expect((mockFetchWithAuth.mock.calls[1][0] as string)).toContain(
      `symbols=${batch2.join("%2C")}`,
    );
    expect(quotes).toHaveLength(MARKET_SYMBOL_CAP + 1);
    expect(quotes.map((q) => q.symbol)).toEqual(symbols);
    expect(quotes[0]).toEqual({ symbol: "SYM1", close: 100, change: 1 });
    expect(quotes[MARKET_SYMBOL_CAP]).toEqual({ symbol: "SYM21", close: 200, change: -1 });
  });

  test("dedupes case-insensitively and keeps first-occurrence casing", async () => {
    mockFetchWithAuth.mockResolvedValueOnce(
      mockResponse(true, {
        rows: [
          { symbol: "RELIANCE", close: 2946, change: 0.82 },
          { symbol: "TCS", close: 3100, change: -1.5 },
          { symbol: "KAYNES", close: 2986, change: -12.94 },
        ],
      }),
    );
    const quotes = await fetchQuotes(["RELIANCE", "reliance", "  ", "TCS", "tcs", "KAYNES"]);
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    expect((mockFetchWithAuth.mock.calls[0][0] as string)).toContain(
      "symbols=RELIANCE%2CTCS%2CKAYNES",
    );
    expect(quotes).toEqual([
      { symbol: "RELIANCE", close: 2946, change: 0.82 },
      { symbol: "TCS", close: 3100, change: -1.5 },
      { symbol: "KAYNES", close: 2986, change: -12.94 },
    ]);
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

describe("fetchMarketSnapshot typed errors", () => {
  test("a 401 throws an ApiError with status and unauthorized kind", async () => {
    mockFetchWithAuth.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Not authenticated" }), { status: 401 }),
    );

    const error = await fetchMarketSnapshot().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).kind).toBe("unauthorized");
    expect((error as ApiError).message).toBe("Not authenticated");
  });

  test("a 429 carries retryAfterMs from the Retry-After header", async () => {
    mockFetchWithAuth.mockResolvedValue(
      new Response(JSON.stringify({ detail: "Slow down" }), {
        status: 429,
        headers: { "Retry-After": "15" },
      }),
    );

    const error = await fetchMarketSnapshot().catch((e: unknown) => e);
    expect((error as ApiError).status).toBe(429);
    expect((error as ApiError).kind).toBe("rate_limited");
    expect((error as ApiError).retryAfterMs).toBe(15_000);
  });
});
