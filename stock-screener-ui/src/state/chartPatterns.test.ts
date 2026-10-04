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
  STALE_SCAN_MINUTES,
  getChartPatternsState,
  subscribe,
  resetChartPatternsState,
  setTimeframe,
  selectTimeframe,
  setUniverse,
  selectUniverse,
  selectSymbols,
  CUSTOM_UNIVERSE,
  setFilter,
  setLookbackBars,
  resetFilters,
  applyFilters,
  loadCatalog,
  loadResults,
  loadSummary,
  loadActiveJobs,
  triggerScan,
  pollJob,
  setScanning,
  setJob,
  loadSymbolDetail,
  hasRestrictiveFilter,
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
  // Auto-scan may fire when results are empty; keep the scan queue happy and
  // its poll pending so no timer work runs unexpectedly.
  mocked.startScan.mockResolvedValue({ job_id: "cpj_auto", status: "queued", queue_position: null, queue_size: 8 });
  mocked.fetchJob.mockImplementation(() => new Promise(() => {}));
}

/** Flush the microtask chain produced by the async loaders/auto-scan. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
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
    expect(DEFAULT_PATTERN_FILTERS.pattern_id).toEqual([]);
    expect(DEFAULT_PATTERN_FILTERS.symbols).toEqual([]);
    expect(DEFAULT_PATTERN_FILTERS.q).toBe("");
    expect(DEFAULT_PATTERN_FILTERS.min_base_days).toBeNull();
    expect(DEFAULT_PATTERN_FILTERS.max_range_pct).toBeNull();
    expect(DEFAULT_PATTERN_FILTERS.sort).toBe("confidence");
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

describe("custom symbol scope", () => {
  it("selectSymbols switches to the custom universe and queries by symbol", () => {
    setUniverse("nifty500");
    mocked.fetchResults.mockClear();
    selectSymbols(["bse", " infy ", "BSE"]);
    const state = getChartPatternsState();
    expect(state.universe).toBe(CUSTOM_UNIVERSE);
    expect(state.filters.symbols).toEqual(["BSE", "INFY"]);
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ universe: null, symbols: ["BSE", "INFY"] }),
    );
  });

  it("selecting a preset universe clears the custom symbols", () => {
    selectSymbols(["BSE"]);
    mocked.fetchResults.mockClear();
    selectUniverse("nifty50");
    const state = getChartPatternsState();
    expect(state.universe).toBe("nifty50");
    expect(state.filters.symbols).toEqual([]);
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ universe: "nifty50", symbols: [] }),
    );
  });

  it("a custom scan sends the symbol scope to startScan", async () => {
    selectSymbols(["BSE", "INFY"]);
    await flush();
    mocked.startScan.mockClear();
    await triggerScan(true);
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ universe: "custom", symbols: ["BSE", "INFY"], force: true }),
    );
  });

  it("an empty custom scope neither queries nor auto-scans", async () => {
    selectUniverse(CUSTOM_UNIVERSE);
    await flush();
    expect(getChartPatternsState().universe).toBe(CUSTOM_UNIVERSE);
    expect(mocked.fetchResults).not.toHaveBeenCalled();
    expect(mocked.startScan).not.toHaveBeenCalled();
  });
});

describe("auto-scan on empty universe|timeframe", () => {
  it("auto-scans once per universe|timeframe and not again for the same combo", async () => {
    setUniverse("nifty500");

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(1);

    // Simulate the first scan finishing, then switch to a new timeframe.
    setScanning(false);
    setJob(null);
    selectTimeframe("1D");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(2);

    // Returning to an already-requested combo must not rescan.
    setScanning(false);
    setJob(null);
    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(2);
  });

  it("does not auto-scan while a scan is already running", async () => {
    setUniverse("nifty500");
    setScanning(true);

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).not.toHaveBeenCalled();
  });

  /** Stub a combo that has hits and a completed scan at ``lastScanAt``. */
  function stubPopulatedResults(lastScanAt: string | null) {
    mocked.fetchResults.mockResolvedValue({
      items: [{ id: 1, symbol: "IRCON", pattern_id: "falling_wedge" } as never],
      total: 1,
      summary: SUMMARY,
      data_through: "2026-09-30",
    });
    mocked.fetchSummary.mockResolvedValue({ ...SUMMARY, last_scan_at: lastScanAt });
  }

  it("does not auto-scan when results exist and the last scan is fresh", async () => {
    setUniverse("nifty500");
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    stubPopulatedResults(recent);

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).not.toHaveBeenCalled();
  });

  it("auto-scans when results exist but the last scan is stale", async () => {
    setUniverse("nifty500");
    const stale = new Date(Date.now() - (STALE_SCAN_MINUTES + 5) * 60_000).toISOString();
    stubPopulatedResults(stale);

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(1);
  });

  it("auto-scans when results exist but last_scan_at is missing", async () => {
    setUniverse("nifty500");
    stubPopulatedResults(null);

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(1);
  });

  it("does not rescan a stale combo twice in one session", async () => {
    setUniverse("nifty500");
    const stale = new Date(Date.now() - (STALE_SCAN_MINUTES + 5) * 60_000).toISOString();
    stubPopulatedResults(stale);

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(1);

    // Finish the scan, then return to the same (still stale) combo: guard holds.
    setScanning(false);
    setJob(null);
    selectTimeframe("1D");
    await flush();
    setScanning(false);
    setJob(null);
    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(2);
  });

  it("does not auto-scan when only a filter changes", async () => {
    setUniverse("nifty500");

    setFilter("family", ["reversal"]);
    await flush();
    expect(mocked.startScan).not.toHaveBeenCalled();
  });
});

describe("filters", () => {
  it("setFilter persists the value and reloads", () => {
    setFilter("min_rr", 1.5);
    expect(getChartPatternsState().filters.min_rr).toBe(1.5);
    expect(mocked.fetchResults).toHaveBeenCalled();
    expect(mocked.fetchSummary).toHaveBeenCalled();
  });

  it("setFilter pattern_id persists it and includes it in the reload query", () => {
    setFilter("pattern_id", ["ascending_channel"]);
    expect(getChartPatternsState().filters.pattern_id).toEqual(["ascending_channel"]);
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ pattern_id: ["ascending_channel"] }),
    );
    expect(mocked.fetchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ pattern_id: ["ascending_channel"] }),
    );
  });

  it("setFilter sort persists it and forwards it to results + summary", () => {
    setFilter("sort", "newest");
    expect(getChartPatternsState().filters.sort).toBe("newest");
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "newest" }),
    );
    expect(mocked.fetchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ sort: "newest" }),
    );
  });

  it("setFilter symbols + q persist and forward to results + summary", () => {
    setFilter("symbols", ["SBIN", "TCS"]);
    setFilter("q", "bank");
    expect(getChartPatternsState().filters.symbols).toEqual(["SBIN", "TCS"]);
    expect(getChartPatternsState().filters.q).toBe("bank");
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ symbols: ["SBIN", "TCS"], q: "bank" }),
    );
    expect(mocked.fetchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ symbols: ["SBIN", "TCS"], q: "bank" }),
    );
  });

  it("resetFilters restores defaults and reloads", () => {
    setFilter("family", ["reversal"]);
    mocked.fetchResults.mockClear();
    resetFilters();
    expect(getChartPatternsState().filters).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(mocked.fetchResults).toHaveBeenCalled();
  });

  it("trendlines defaults to both and is client-only (never in query args)", () => {
    expect(DEFAULT_PATTERN_FILTERS.trendlines).toBe("both");
    setFilter("trendlines", "support");
    expect(getChartPatternsState().filters.trendlines).toBe("support");
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.not.objectContaining({ trendlines: expect.anything() }),
    );
    expect(mocked.fetchSummary).toHaveBeenCalledWith(
      expect.not.objectContaining({ trendlines: expect.anything() }),
    );
  });

  it("trendlines is not a restrictive filter", () => {
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, trendlines: "support" })).toBe(false);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, trendlines: "none" })).toBe(false);
  });

  it("applyFilters merges onto defaults, resets unspecified keys, and reloads", () => {
    setFilter("family", ["reversal"]);
    setFilter("direction", ["bullish"]);
    mocked.fetchResults.mockClear();
    mocked.fetchSummary.mockClear();

    applyFilters({ pattern_id: ["ascending_channel"], min_base_days: 90 });

    const filters = getChartPatternsState().filters;
    expect(filters.pattern_id).toEqual(["ascending_channel"]);
    expect(filters.min_base_days).toBe(90);
    // Unspecified keys reset to defaults.
    expect(filters.family).toEqual([]);
    expect(filters.direction).toEqual([]);
    expect(filters.sort).toBe("confidence");
    expect(mocked.fetchResults).toHaveBeenCalled();
    expect(mocked.fetchSummary).toHaveBeenCalled();
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
      { id: "1D", label: "1D", minutes: 1440, native: true, source_tf: null, max_lookback_days: 730, min_bars: 60 },
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

describe("stale async responses", () => {
  it("ignores a loadResults response that resolves after a newer one", async () => {
    let resolveSlow!: (value: { items: never[]; total: number; summary: PatternSummary; data_through: string }) => void;
    mocked.fetchResults
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSlow = resolve; }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ items: [], total: 7, summary: SUMMARY, data_through: "2026-10-01" }),
      );

    const slow = loadResults();
    const fast = loadResults();
    await fast;
    await flush();
    expect(getChartPatternsState().total).toBe(7);

    resolveSlow({ items: [], total: 1, summary: SUMMARY, data_through: "2020-01-01" });
    await slow;
    await flush();
    expect(getChartPatternsState().total).toBe(7);
    expect(getChartPatternsState().dataThrough).toBe("2026-10-01");
  });

  it("ignores a stale loadResults failure after a newer success", async () => {
    let rejectSlow!: (reason: unknown) => void;
    mocked.fetchResults
      .mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectSlow = reject; }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ items: [], total: 3, summary: SUMMARY, data_through: "2026-10-01" }),
      );

    const slow = loadResults();
    const fast = loadResults();
    await fast;
    await flush();
    expect(getChartPatternsState().error).toBeNull();

    rejectSlow(new Error("slow boom"));
    await slow;
    await flush();
    expect(getChartPatternsState().error).toBeNull();
    expect(getChartPatternsState().total).toBe(3);
  });

  it("ignores a stale loadSummary response that resolves after a newer one", async () => {
    let resolveSlow!: (value: PatternSummary) => void;
    mocked.fetchSummary
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
      .mockImplementationOnce(() => Promise.resolve({ ...SUMMARY, scanned: 999 }));

    const slow = loadSummary();
    const fast = loadSummary();
    await fast;
    await flush();
    expect(getChartPatternsState().summary?.scanned).toBe(999);

    resolveSlow({ ...SUMMARY, scanned: 1 });
    await slow;
    await flush();
    expect(getChartPatternsState().summary?.scanned).toBe(999);
  });
});

describe("concurrent error handling", () => {
  it("a background reload does not erase a recorded failure", async () => {
    mocked.fetchResults.mockRejectedValueOnce(new Error("results down"));
    await loadResults();
    expect(getChartPatternsState().error).toBe("results down");

    // A subsequent background loader succeeds: the earlier failure must stand
    // (previously `startLoading` wiped it unconditionally on every loader).
    await loadSummary();
    expect(getChartPatternsState().summary).toEqual(SUMMARY);
    expect(getChartPatternsState().error).toBe("results down");
  });

  it("an explicit action clears a previous error at its start", async () => {
    mocked.fetchResults.mockRejectedValueOnce(new Error("results down"));
    await loadResults();
    expect(getChartPatternsState().error).toBe("results down");

    mocked.fetchResults.mockResolvedValueOnce({ items: [], total: 0, summary: SUMMARY, data_through: null });
    mocked.fetchSummary.mockResolvedValueOnce(SUMMARY);
    resetFilters();
    await flush();
    expect(getChartPatternsState().error).toBeNull();
  });
});

describe("loadActiveJobs", () => {
  it("prefers the active job matching the current combo", async () => {
    setUniverse("nifty500");
    mocked.fetchActiveJobs.mockResolvedValue([
      makeJob({ job_id: "cpj_other", universe: "nifty50", timeframe: "1h" }),
      makeJob({ job_id: "cpj_mine", universe: "nifty500", timeframe: "1D" }),
    ]);

    await loadActiveJobs();
    expect(getChartPatternsState().job?.job_id).toBe("cpj_mine");
    expect(getChartPatternsState().scanning).toBe(true);
  });

  it("adopts a cross-combo job only as a fallback without flipping scanning", async () => {
    setUniverse("nifty500");
    mocked.fetchActiveJobs.mockResolvedValue([
      makeJob({ job_id: "cpj_other", universe: "nifty50", timeframe: "1h" }),
    ]);

    await loadActiveJobs();
    expect(getChartPatternsState().job?.job_id).toBe("cpj_other");
    expect(getChartPatternsState().scanning).toBe(false);
    expect(mocked.fetchJob).not.toHaveBeenCalled();
  });
});

describe("auto-scan bookkeeping", () => {
  it("retries a combo whose enqueue failed (key added only on success)", async () => {
    setUniverse("nifty500");
    mocked.startScan.mockRejectedValueOnce(new Error("boom"));

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).toHaveBeenCalledTimes(1);
    expect(getChartPatternsState().scanning).toBe(false);
    expect(getChartPatternsState().error).toBe("boom");

    setScanning(false);
    setJob(null);
    selectTimeframe("1D");
    await flush();
    setScanning(false);
    setJob(null);
    selectTimeframe("15m");
    await flush();
    // The failed 15m combo is retried instead of being marked done.
    expect(mocked.startScan).toHaveBeenCalledTimes(3);
  });

  it("does not auto-scan when a restrictive filter is active and results are empty", async () => {
    expect(hasRestrictiveFilter(DEFAULT_PATTERN_FILTERS)).toBe(false);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, q: "bank" })).toBe(true);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, symbol: "IRCON" })).toBe(true);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, symbols: ["IRCON"] })).toBe(true);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, volume_confirmed: true })).toBe(true);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, min_rr: 1.5 })).toBe(true);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, pattern_id: ["falling_wedge"] })).toBe(true);
    // Ordering-only `sort` is not restrictive.
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, sort: "newest" })).toBe(false);

    setUniverse("nifty500");
    setFilter("q", "bank");
    await flush();
    mocked.startScan.mockClear();

    selectTimeframe("15m");
    await flush();
    expect(mocked.startScan).not.toHaveBeenCalled();
  });
});

describe("selectTimeframe / selectUniverse detail preservation", () => {
  it("re-selecting the active timeframe keeps the open symbol detail", async () => {
    mocked.fetchSymbolDetail.mockResolvedValue({ symbol: "IRCON" } as never);
    mocked.fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });

    await loadSymbolDetail("IRCON");
    expect(getChartPatternsState().detail).toEqual({ symbol: "IRCON" });

    mocked.fetchResults.mockClear();
    selectTimeframe("1D");
    expect(getChartPatternsState().detail).toEqual({ symbol: "IRCON" });
    expect(mocked.fetchResults).not.toHaveBeenCalled();
  });
});

describe("pollJob", () => {
  it("transitions through running → completed and stops, then refreshes results", async () => {
    mocked.fetchJob.mockResolvedValueOnce(makeJob({ status: "running", queue_position: 1 })).mockResolvedValueOnce(makeJob({ status: "completed", queue_position: null }));
    setUniverse("nifty500");
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

  it("skips the reload when the combo changed while the job ran", async () => {
    mocked.fetchJob.mockResolvedValue(makeJob({ status: "completed", universe: "nifty500", timeframe: "1D" }));
    setUniverse("nifty500");
    setScanning(true);
    // The user switched combos mid-scan: the payload belongs to the old view.
    setUniverse("nifty50");

    await pollJob("cpj_1");
    expect(getChartPatternsState().job?.status).toBe("completed");
    expect(getChartPatternsState().scanning).toBe(false);
    expect(mocked.fetchResults).not.toHaveBeenCalled();
    expect(mocked.fetchSummary).not.toHaveBeenCalled();
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

  it("scans the explicitly requested combo, not current state", async () => {
    setUniverse("nifty500");
    mocked.startScan.mockResolvedValue({ job_id: "cpj_x", status: "queued", queue_position: 0, queue_size: 1 });
    mocked.fetchJob.mockImplementation(() => new Promise(() => {}));

    await triggerScan(false, { universe: "nifty50", timeframe: "15m" });
    expect(mocked.startScan).toHaveBeenCalledWith({
      universe: "nifty50",
      timeframe: "15m",
      force: false,
    });
    const state = getChartPatternsState();
    expect(state.job?.universe).toBe("nifty50");
    expect(state.job?.timeframe).toBe("15m");
    // Current selection is untouched by the pinned request.
    expect(state.universe).toBe("nifty500");
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

  it("passes the store lookbackBars through to fetchSymbolChart", async () => {
    mocked.fetchSymbolDetail.mockResolvedValue({ symbol: "IRCON" } as never);
    mocked.fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });

    setLookbackBars(250);
    await flush();
    mocked.fetchSymbolChart.mockClear();
    await loadSymbolDetail("IRCON");
    expect(mocked.fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      { lookbackBars: 250 },
    );
  });

  it("omits lookbackBars when the store is Auto (null)", async () => {
    mocked.fetchSymbolDetail.mockResolvedValue({ symbol: "IRCON" } as never);
    mocked.fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });

    expect(getChartPatternsState().lookbackBars).toBeNull();
    await loadSymbolDetail("IRCON");
    expect(mocked.fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", undefined);
  });
});

describe("lookbackBars", () => {
  it("defaults to null (Auto) and sends no lookback_bars", async () => {
    expect(getChartPatternsState().lookbackBars).toBeNull();
    setUniverse("nifty500");
    mocked.startScan.mockClear();
    await triggerScan(true);
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.not.objectContaining({ lookback_bars: expect.anything() }),
    );
  });

  it("setLookbackBars(250) sets state and startScan receives lookback_bars: 250", async () => {
    setUniverse("nifty500");
    mocked.startScan.mockClear();
    setLookbackBars(250);
    expect(getChartPatternsState().lookbackBars).toBe(250);
    await flush();
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ lookback_bars: 250, force: true }),
    );
  });
});
