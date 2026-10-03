import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { JobDTO, PatternSummary } from "../types/chartPatterns";

vi.mock("../api/chartPatterns", async () => {
  const actual = await vi.importActual<typeof import("../api/chartPatterns")>("../api/chartPatterns");
  return {
    QueueFullError: actual.QueueFullError,
    buildPatternsQuery: actual.buildPatternsQuery,
    fetchTimeframes: vi.fn(),
    fetchUniverses: vi.fn(),
    fetchPatternCatalog: vi.fn(),
    startScan: vi.fn(),
    fetchJob: vi.fn(),
    fetchActiveJobs: vi.fn(),
    fetchResults: vi.fn(),
    fetchSummary: vi.fn(),
    fetchSymbolDetail: vi.fn(),
    fetchSymbolChart: vi.fn(),
  };
});

import {
  QueueFullError,
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
} from "../api/chartPatterns";
import {
  POLL_INTERVAL_MS,
  DEFAULT_PATTERN_FILTERS,
  getChartPatternsState,
  subscribe,
  resetChartPatternsState,
  setTimeframe,
  selectTimeframe,
  setUniverse,
  selectUniverse,
  setFilter,
  resetFilters,
  loadCatalog,
  loadResults,
  loadSummary,
  triggerScan,
  pollJob,
  setScanning,
  loadSymbolDetail,
} from "./chartPatterns";

const mocked = {
  fetchTimeframes: vi.mocked(fetchTimeframes),
  fetchUniverses: vi.mocked(fetchUniverses),
  fetchPatternCatalog: vi.mocked(fetchPatternCatalog),
  startScan: vi.mocked(startScan),
  fetchJob: vi.mocked(fetchJob),
  fetchActiveJobs: vi.mocked(fetchActiveJobs),
  fetchResults: vi.mocked(fetchResults),
  fetchSummary: vi.mocked(fetchSummary),
  fetchSymbolDetail: vi.mocked(fetchSymbolDetail),
  fetchSymbolChart: vi.mocked(fetchSymbolChart),
};

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 4,
  bearish: 1,
  data_through: "2026-09-30",
};

function makeJob(overrides: Partial<JobDTO> = {}): JobDTO {
  return {
    job_id: "cpj_1",
    universe: "nifty500",
    timeframe: "1D",
    status: "running",
    total: 500,
    done: 10,
    failed: 0,
    skipped: 0,
    queue_position: null,
    started_at: null,
    finished_at: null,
    data_through: null,
    error: null,
    ...overrides,
  };
}

function mockDefaults() {
  mocked.fetchTimeframes.mockResolvedValue([]);
  mocked.fetchUniverses.mockResolvedValue({ universes: [], default: "nifty500" });
  mocked.fetchPatternCatalog.mockResolvedValue({ families: [], patterns: [] });
  mocked.fetchActiveJobs.mockResolvedValue([]);
  mocked.fetchResults.mockResolvedValue({ items: [], total: 0, summary: SUMMARY, data_through: "2026-09-30" });
  mocked.fetchSummary.mockResolvedValue(SUMMARY);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetChartPatternsState();
  mockDefaults();
});

afterEach(() => {
  resetChartPatternsState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("initial state", () => {
  it("starts empty with the default timeframe", () => {
    const state = getChartPatternsState();
    expect(state.timeframes).toEqual([]);
    expect(state.universes).toEqual([]);
    expect(state.patterns).toEqual([]);
    expect(state.timeframe).toBe("1D");
    expect(state.universe).toBe("");
    expect(state.filters).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(state.job).toBeNull();
    expect(state.scanning).toBe(false);
    expect(state.results).toEqual([]);
    expect(state.total).toBe(0);
    expect(state.detail).toBeNull();
    expect(state.error).toBeNull();
  });
});

describe("setters + notification", () => {
  it("setTimeframe updates state and notifies subscribers", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    setTimeframe("1h");
    expect(getChartPatternsState().timeframe).toBe("1h");
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("setUniverse updates state", () => {
    setUniverse("nifty50");
    expect(getChartPatternsState().universe).toBe("nifty50");
  });

  it("setFilter updates one key without touching the others", () => {
    setFilter("family", ["reversal"]);
    expect(getChartPatternsState().filters.family).toEqual(["reversal"]);
    expect(getChartPatternsState().filters.direction).toEqual([]);
  });
});

describe("selectTimeframe / selectUniverse", () => {
  it("selectTimeframe reloads results + summary", () => {
    selectTimeframe("1h");
    expect(getChartPatternsState().timeframe).toBe("1h");
    expect(mocked.fetchResults).toHaveBeenCalledWith(expect.objectContaining({ timeframe: "1h" }));
    expect(mocked.fetchSummary).toHaveBeenCalledWith(expect.objectContaining({ timeframe: "1h" }));
  });

  it("selectTimeframe is a no-op reload when unchanged", () => {
    selectTimeframe("1D");
    expect(mocked.fetchResults).not.toHaveBeenCalled();
  });

  it("selectUniverse reloads with the new universe", () => {
    selectUniverse("nifty50");
    expect(getChartPatternsState().universe).toBe("nifty50");
    expect(mocked.fetchResults).toHaveBeenCalledWith(expect.objectContaining({ universe: "nifty50" }));
  });
});

describe("filters", () => {
  it("setFilter persists the value and reloads", () => {
    setFilter("min_rr", 1.5);
    expect(getChartPatternsState().filters.min_rr).toBe(1.5);
    expect(mocked.fetchResults).toHaveBeenCalled();
    expect(mocked.fetchSummary).toHaveBeenCalled();
  });

  it("resetFilters restores defaults and reloads", () => {
    setFilter("family", ["reversal"]);
    mocked.fetchResults.mockClear();
    resetFilters();
    expect(getChartPatternsState().filters).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(mocked.fetchResults).toHaveBeenCalled();
  });
});

describe("loaders", () => {
  it("loadResults populates items, total and dataThrough", async () => {
    mocked.fetchResults.mockResolvedValue({
      items: [{ id: 1, symbol: "IRCON", pattern_id: "falling_wedge" } as never],
      total: 42,
      summary: SUMMARY,
      data_through: "2026-09-30",
    });

    await loadResults();
    const state = getChartPatternsState();
    expect(state.results).toHaveLength(1);
    expect(state.total).toBe(42);
    expect(state.dataThrough).toBe("2026-09-30");
    expect(state.loading).toBe(false);
  });

  it("loadSummary populates the summary", async () => {
    await loadSummary();
    expect(getChartPatternsState().summary).toEqual(SUMMARY);
  });

  it("stores an error when loadResults fails", async () => {
    mocked.fetchResults.mockRejectedValue(new Error("network down"));
    await loadResults();
    expect(getChartPatternsState().error).toBe("network down");
    expect(getChartPatternsState().loading).toBe(false);
  });

  it("loadCatalog sets catalog, default universe, then loads data", async () => {
    mocked.fetchTimeframes.mockResolvedValue([
      { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
    ]);
    mocked.fetchUniverses.mockResolvedValue({ universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }], default: "nifty500" });
    mocked.fetchPatternCatalog.mockResolvedValue({ families: [{ id: "reversal", label: "Reversal" }], patterns: [{ pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "" }] });

    await loadCatalog();
    const state = getChartPatternsState();
    expect(state.timeframes).toHaveLength(1);
    expect(state.universes).toHaveLength(1);
    expect(state.defaultUniverse).toBe("nifty500");
    expect(state.universe).toBe("nifty500");
    expect(state.families).toHaveLength(1);
    expect(state.patterns).toHaveLength(1);
    expect(mocked.fetchResults).toHaveBeenCalled();
    expect(mocked.fetchSummary).toHaveBeenCalled();
  });
});

describe("pollJob", () => {
  it("transitions through running → completed and stops, then refreshes results", async () => {
    mocked.fetchJob.mockResolvedValueOnce(makeJob({ status: "running", queue_position: 1 })).mockResolvedValueOnce(makeJob({ status: "completed", queue_position: null }));
    setScanning(true);

    await pollJob("cpj_1");
    expect(getChartPatternsState().job?.status).toBe("running");
    expect(getChartPatternsState().scanning).toBe(true);

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    expect(mocked.fetchJob).toHaveBeenCalledTimes(2);
    expect(getChartPatternsState().job?.status).toBe("completed");
    expect(getChartPatternsState().scanning).toBe(false);
    expect(mocked.fetchResults).toHaveBeenCalled();
    expect(mocked.fetchSummary).toHaveBeenCalled();
  });

  it("stops and surfaces the error when a job fails", async () => {
    mocked.fetchJob.mockResolvedValue(makeJob({ status: "failed", error: "detector crashed" }));
    setScanning(true);

    await pollJob("cpj_1");
    expect(getChartPatternsState().scanning).toBe(false);
    expect(getChartPatternsState().error).toBe("detector crashed");
    expect(mocked.fetchResults).not.toHaveBeenCalled();
  });

  it("stops polling when fetchJob rejects", async () => {
    mocked.fetchJob.mockRejectedValue(new Error("connection lost"));
    setScanning(true);

    await pollJob("cpj_1");
    expect(getChartPatternsState().scanning).toBe(false);
    expect(getChartPatternsState().error).toBe("connection lost");
  });
});

describe("triggerScan", () => {
  it("starts a job and begins scanning", async () => {
    mocked.startScan.mockResolvedValue({ job_id: "cpj_9", status: "queued", queue_position: 2, queue_size: 8 });
    // Keep polling pending so no interval work runs during the assertion.
    mocked.fetchJob.mockImplementation(() => new Promise(() => {}));

    await triggerScan();
    const state = getChartPatternsState();
    expect(state.job?.job_id).toBe("cpj_9");
    expect(state.scanning).toBe(true);
  });

  it("maps a full queue (429) to an error without scanning", async () => {
    mocked.startScan.mockRejectedValue(new QueueFullError("queue full", 8, 8));

    await triggerScan();
    const state = getChartPatternsState();
    expect(state.scanning).toBe(false);
    expect(state.error).toBe("queue full");
  });
});

describe("loadSymbolDetail", () => {
  it("loads detail + chart for the selected symbol", async () => {
    mocked.fetchSymbolDetail.mockResolvedValue({ symbol: "IRCON" } as never);
    mocked.fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });

    await loadSymbolDetail("IRCON");
    const state = getChartPatternsState();
    expect(state.selectedSymbol).toBe("IRCON");
    expect(state.detail).toEqual({ symbol: "IRCON" });
    expect(state.detailChart?.symbol).toBe("IRCON");
  });
});
