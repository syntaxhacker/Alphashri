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

  it("passes refresh:true through to the scan body", async () => {
    mockedFetch.mockResolvedValue(okResponse({ job_id: "cpj_3", status: "queued", queue_position: 0, queue_size: 1 }));

    await startScan({ universe: "nifty500", timeframe: "1D", refresh: true });

    const [, options] = mockedFetch.mock.calls[0];
    expect(JSON.parse(options?.body as string)).toEqual({
      universe: "nifty500",
      timeframe: "1D",
      refresh: true,
    });
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

  it("buildPatternsQuery repeats symbol for each symbol and sets q", () => {
    const query = buildPatternsQuery({ symbols: ["SBIN", "TCS"], q: "bank" });
    const params = new URLSearchParams(query.slice(1));
    expect(params.getAll("symbol")).toEqual(["SBIN", "TCS"]);
    expect(params.get("q")).toBe("bank");
    expect(query).toContain("symbol=SBIN&symbol=TCS");
    expect(query).toContain("q=bank");
  });

  it("buildPatternsQuery omits empty symbols and q", () => {
    const query = buildPatternsQuery({ symbols: [], q: "" });
    expect(query).not.toContain("symbol");
    expect(query).not.toContain("q=");
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

  it("buildPatternsQuery serializes sort=newest and omits the default", () => {
    expect(buildPatternsQuery({ sort: "newest" })).toContain("sort=newest");
    expect(buildPatternsQuery({ sort: "confidence" })).not.toContain("sort");
    expect(buildPatternsQuery({})).not.toContain("sort");
  });

  it("buildPatternsQuery serializes lookback_bars and omits null/undefined", () => {
    expect(new URLSearchParams(buildPatternsQuery({ lookback_bars: 250 }).slice(1)).get("lookback_bars")).toBe("250");
    expect(buildPatternsQuery({ lookback_bars: 250 })).toContain("lookback_bars=250");
    expect(buildPatternsQuery({})).not.toContain("lookback_bars");
    expect(buildPatternsQuery({ lookback_bars: null })).not.toContain("lookback_bars");
  });

  it("buildPatternsQuery serializes compute_trendlines=0 only when false", () => {
    expect(
      new URLSearchParams(buildPatternsQuery({ compute_trendlines: false }).slice(1)).get(
        "compute_trendlines",
      ),
    ).toBe("0");
    expect(buildPatternsQuery({ compute_trendlines: false })).toContain("compute_trendlines=0");
    expect(buildPatternsQuery({ compute_trendlines: true })).not.toContain("compute_trendlines");
    expect(buildPatternsQuery({})).not.toContain("compute_trendlines");
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

  it("fetchSymbolChart sends lookback_bars only when provided", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { lookbackBars: 250 });
    let url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("lookback_bars")).toBe("250");
    expect(queryOf(url).get("limit")).toBeNull();

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D");
    url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("lookback_bars")).toBeNull();

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { limit: 500, lookbackBars: 120 });
    url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("limit")).toBe("500");
    expect(queryOf(url).get("lookback_bars")).toBe("120");

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { lookbackBars: null });
    url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("lookback_bars")).toBeNull();
  });

  it("fetchSymbolChart sends compute_trendlines=0 only when computeTrendlines is false", async () => {
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { computeTrendlines: false });
    let url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("compute_trendlines")).toBe("0");

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { computeTrendlines: true });
    url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("compute_trendlines")).toBeNull();

    mockedFetch.mockClear();
    mockedFetch.mockResolvedValue(okResponse({ symbol: "IRCON", candles: [], overlays: [] }));
    await fetchSymbolChart("IRCON", "1D", { lookbackBars: 120, computeTrendlines: false });
    url = mockedFetch.mock.calls[0][0] as string;
    expect(queryOf(url).get("lookback_bars")).toBe("120");
    expect(queryOf(url).get("compute_trendlines")).toBe("0");
  });
});

describe("buildPatternsQuery missing serialization", () => {
  it("serializes universe/timeframe/job_id", () => {
    const params = new URLSearchParams(
      buildPatternsQuery({ universe: "nifty500", timeframe: "1D", job_id: "cpj_9" }).slice(1),
    );
    expect(params.get("universe")).toBe("nifty500");
    expect(params.get("timeframe")).toBe("1D");
    expect(params.get("job_id")).toBe("cpj_9");
  });

  it("serializes family/direction/status arrays + scalar filters + singular symbol", () => {
    const query = buildPatternsQuery({
      family: ["reversal"],
      direction: ["bullish", "bearish"],
      status: ["confirmed", "forming"],
      quality: "strong",
      formed_within_bars: 5,
      volume_confirmed: true,
      min_rr: 2,
      symbol: "SBIN",
    });
    const params = new URLSearchParams(query.slice(1));
    expect(params.getAll("family")).toEqual(["reversal"]);
    expect(params.getAll("direction")).toEqual(["bullish", "bearish"]);
    expect(params.getAll("status")).toEqual(["confirmed", "forming"]);
    expect(params.get("quality")).toBe("strong");
    expect(params.get("formed_within_bars")).toBe("5");
    expect(params.get("volume_confirmed")).toBe("true");
    expect(params.get("min_rr")).toBe("2");
    expect(params.get("symbol")).toBe("SBIN");
  });

  it("serializes limit/offset and omits them when absent", () => {
    const params = new URLSearchParams(
      buildPatternsQuery({ limit: 50, offset: 10 }).slice(1),
    );
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("10");
    expect(buildPatternsQuery({})).not.toContain("limit");
    expect(buildPatternsQuery({})).not.toContain("offset");
  });

  it("serializes volume_confirmed=false (explicit opt-out is kept)", () => {
    const params = new URLSearchParams(
      buildPatternsQuery({ volume_confirmed: false }).slice(1),
    );
    expect(params.get("volume_confirmed")).toBe("false");
  });
});

describe("results/summary/symbol error messages", () => {
  it("fetchResults throws the server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "results boom" }));
    await expect(fetchResults({ universe: "nifty500" })).rejects.toThrow("results boom");
  });

  it("fetchResults falls back when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(fetchResults({})).rejects.toThrow("Failed to fetch pattern results");
  });

  it("fetchResults defaults missing items/total/data_through", async () => {
    mockedFetch.mockResolvedValue(okResponse({ summary: { scanned: 1 } }));
    const result = await fetchResults({});
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.data_through).toBeNull();
  });

  it("fetchSummary throws the server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "summary boom" }));
    await expect(fetchSummary({})).rejects.toThrow("summary boom");
  });

  it("fetchSummary falls back when the error body is not JSON", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(fetchSummary({})).rejects.toThrow("Failed to fetch pattern summary");
  });

  it("fetchSymbolDetail throws the server detail and encodes special chars", async () => {
    mockedFetch.mockResolvedValue(errorResponse(404, { detail: "no such symbol" }));
    await expect(fetchSymbolDetail("M&M", "1D")).rejects.toThrow("no such symbol");
    expect(mockedFetch.mock.calls[0][0]).toContain("/symbol/M%26M?");
  });

  it("fetchSymbolDetail falls back to Failed to load <symbol> on non-JSON errors", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(fetchSymbolDetail("SBIN", "1D")).rejects.toThrow("Failed to load SBIN");
  });

  it("fetchSymbolChart throws the server detail on failure", async () => {
    mockedFetch.mockResolvedValue(errorResponse(500, { detail: "chart boom" }));
    await expect(fetchSymbolChart("SBIN", "1D")).rejects.toThrow("chart boom");
  });

  it("fetchSymbolChart falls back to Failed to load <symbol> chart on non-JSON errors", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(fetchSymbolChart("SBIN", "1D")).rejects.toThrow(
      "Failed to load SBIN chart",
    );
  });
});

describe("startScan extended body + 429 fallbacks", () => {
  it("POSTs lookback_bars/symbols/compute_trendlines through untouched", async () => {
    mockedFetch.mockResolvedValue(
      okResponse({ job_id: "cpj_2", status: "queued", queue_position: 1, queue_size: 2 }),
    );

    await startScan({
      universe: "custom",
      timeframe: "1D",
      symbols: ["SBIN", "TCS"],
      lookback_bars: 250,
      compute_trendlines: false,
    });

    const [url, options] = mockedFetch.mock.calls[0];
    expect(url).toContain("/api/chart-patterns/scan");
    expect(JSON.parse(options?.body as string)).toEqual({
      universe: "custom",
      timeframe: "1D",
      symbols: ["SBIN", "TCS"],
      lookback_bars: 250,
      compute_trendlines: false,
    });
  });

  it("maps 429 without queue metadata to null sizes", async () => {
    mockedFetch.mockResolvedValue(errorResponse(429, { detail: "queue full" }));
    const err = await startScan({ universe: "nifty500", timeframe: "1D" }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueFullError);
    expect((err as QueueFullError).queueSize).toBeNull();
    expect((err as QueueFullError).maxQueue).toBeNull();
  });

  it("maps 429 with non-JSON body to the fallback detail", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    const err = await startScan({ universe: "nifty500", timeframe: "1D" }).catch((e) => e);
    expect(err).toBeInstanceOf(QueueFullError);
    expect((err as QueueFullError).message).toBe("Pattern scan queue is full");
    expect((err as QueueFullError).queueSize).toBeNull();
  });

  it("falls back to Failed to start scan (<status>) on non-JSON non-429 errors", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    await expect(startScan({ universe: "x", timeframe: "1D" })).rejects.toThrow(
      "Failed to start scan (502)",
    );
  });

  it("QueueFullError defaults to null metadata", () => {
    const err = new QueueFullError("full");
    expect(err.name).toBe("QueueFullError");
    expect(err.queueSize).toBeNull();
    expect(err.maxQueue).toBeNull();
  });
});
