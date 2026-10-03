import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../state/auth", () => ({
  fetchWithAuth: vi.fn(),
}));

import { fetchWithAuth } from "../state/auth";
import {
  QueueFullError,
  buildPatternsQuery,
  fetchTimeframes,
  fetchUniverses,
  fetchPatternCatalog,
  startScan,
  fetchJob,
  fetchActiveJobs,
  fetchResults,
  fetchSummary,
  fetchSymbolDetail,
  fetchSymbolChart,
} from "./chartPatterns";

const mockedFetch = vi.mocked(fetchWithAuth);

function okResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return { ok: false, status, json: async () => body } as unknown as Response;
}

function queryOf(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : "");
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("catalog endpoints", () => {
  it("fetchTimeframes GETs the registry", async () => {
    const tf = { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 };
    mockedFetch.mockResolvedValue(okResponse({ timeframes: [tf] }));

    await expect(fetchTimeframes()).resolves.toEqual([tf]);
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/chart-patterns/timeframes"));
  });

  it("fetchUniverses returns universes + default", async () => {
    mockedFetch.mockResolvedValue(okResponse({ universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }], default: "nifty500" }));
    await expect(fetchUniverses()).resolves.toEqual({
      universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
      default: "nifty500",
    });
  });

  it("fetchPatternCatalog returns families + patterns", async () => {
    mockedFetch.mockResolvedValue(okResponse({ families: [{ id: "reversal", label: "Reversal" }], patterns: [] }));
    await expect(fetchPatternCatalog()).resolves.toEqual({ families: [{ id: "reversal", label: "Reversal" }], patterns: [] });
  });

  it("throws server detail on catalog failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "boom" }));
    await expect(fetchTimeframes()).rejects.toThrow("boom");
  });
});

describe("startScan", () => {
  it("POSTs universe/timeframe/force as JSON", async () => {
    mockedFetch.mockResolvedValue(okResponse({ job_id: "cpj_1", status: "queued", queue_position: 0, queue_size: 1 }));

    const result = await startScan({ universe: "nifty500", timeframe: "1D", force: true });
    expect(result.job_id).toBe("cpj_1");

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/scan");
    expect(options?.method).toBe("POST");
    expect(JSON.parse(options?.body as string)).toEqual({ universe: "nifty500", timeframe: "1D", force: true });
  });

  it("maps HTTP 429 to QueueFullError with queue metadata", async () => {
    mockedFetch.mockResolvedValue(errorResponse(429, { detail: "queue full", queue_size: 8, max_queue: 8 }));

    const err = await startScan({ universe: "nifty500", timeframe: "1D" }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueFullError);
    expect(err.message).toBe("queue full");
    expect((err as QueueFullError).queueSize).toBe(8);
    expect((err as QueueFullError).maxQueue).toBe(8);
  });

  it("throws a plain error on non-429 failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "bad universe" }));
    await expect(startScan({ universe: "x", timeframe: "1D" })).rejects.toThrow("bad universe");
  });
});

describe("jobs", () => {
  it("fetchJob URL-encodes the id", async () => {
    mockedFetch.mockResolvedValue(okResponse({ job_id: "cpj_1", status: "running" }));
    await fetchJob("cpj_1");
    expect(mockedFetch).toHaveBeenCalledWith(expect.stringContaining("/api/chart-patterns/jobs/cpj_1"));
  });

  it("fetchActiveJobs requests ?active=1", async () => {
    mockedFetch.mockResolvedValue(okResponse({ jobs: [] }));
    await expect(fetchActiveJobs()).resolves.toEqual([]);
    expect(mockedFetch.mock.calls[0][0]).toContain("/api/chart-patterns/jobs?active=1");
  });
});

describe("results + summary query building", () => {
  const summary = { scanned: 10, patterns: 3, in_view: 2, confirmed: 1, bullish: 1, bearish: 1, data_through: "2026-09-30" };

  it("serializes array + scalar filters into repeated query params", async () => {
    mockedFetch.mockResolvedValue(okResponse({ items: [], total: 0, summary, data_through: "2026-09-30" }));

    await fetchResults({
      universe: "nifty500",
      timeframe: "1D",
      family: ["reversal", "curve_cup"],
      direction: ["bullish"],
      status: ["confirmed"],
      quality: "strong",
      formed_within_bars: 5,
      volume_confirmed: true,
      min_rr: 1.5,
      symbol: "IRCON",
      limit: 100,
      offset: 20,
    });

    const params = queryOf(mockedFetch.mock.calls[0][0] as string);
    expect(params.get("universe")).toBe("nifty500");
    expect(params.get("timeframe")).toBe("1D");
    expect(params.getAll("family")).toEqual(["reversal", "curve_cup"]);
    expect(params.getAll("direction")).toEqual(["bullish"]);
    expect(params.getAll("status")).toEqual(["confirmed"]);
    expect(params.get("quality")).toBe("strong");
    expect(params.get("formed_within_bars")).toBe("5");
    expect(params.get("volume_confirmed")).toBe("true");
    expect(params.get("min_rr")).toBe("1.5");
    expect(params.get("symbol")).toBe("IRCON");
    expect(params.get("limit")).toBe("100");
    expect(params.get("offset")).toBe("20");
  });

  it("omits null/empty filters", async () => {
    mockedFetch.mockResolvedValue(okResponse({ items: [], total: 0, summary, data_through: null }));
    await fetchResults({ family: [], direction: [], status: [], quality: null, formed_within_bars: null, volume_confirmed: null, min_rr: null, symbol: null });
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).not.toContain("?");
  });

  it("fetchSummary hits /summary with the same filters", async () => {
    mockedFetch.mockResolvedValue(okResponse(summary));
    await expect(fetchSummary({ universe: "nifty500", timeframe: "1D" })).resolves.toEqual(summary);
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/chart-patterns/summary?");
    expect(queryOf(url).get("universe")).toBe("nifty500");
  });

  it("buildPatternsQuery repeats pattern_id for each selected pattern", () => {
    const query = buildPatternsQuery({ pattern_id: ["a", "b"] });
    expect(query).toContain("pattern_id=a&pattern_id=b");
    expect(new URLSearchParams(query.slice(1)).getAll("pattern_id")).toEqual(["a", "b"]);
  });

  it("buildPatternsQuery returns an empty string for no filters", () => {
    expect(buildPatternsQuery({})).toBe("");
  });

  it("buildPatternsQuery serializes consolidation params", () => {
    const params = new URLSearchParams(buildPatternsQuery({ min_base_days: 90, max_range_pct: 20 }).slice(1));
    expect(params.get("min_base_days")).toBe("90");
    expect(params.get("max_range_pct")).toBe("20");
    expect(buildPatternsQuery({ min_base_days: 90, max_range_pct: 20 })).toContain(
      "min_base_days=90&max_range_pct=20",
    );
  });
});

describe("symbol endpoints", () => {
  it("fetchSymbolDetail encodes the symbol and passes timeframe", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON" }));
    await fetchSymbolDetail("IRCON", "1D");
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/chart-patterns/symbol/IRCON?");
    expect(queryOf(url).get("timeframe")).toBe("1D");
  });

  it("fetchSymbolChart includes limit when provided", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", 300);
    const url = mockedFetch.mock.calls[0][0] as string;
    expect(url).toContain("/api/chart-patterns/symbol/IRCON/chart?");
    expect(queryOf(url).get("timeframe")).toBe("1D");
    expect(queryOf(url).get("limit")).toBe("300");
  });
});
