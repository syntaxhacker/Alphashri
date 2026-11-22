import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatternSummary } from "../types/chartPatterns";

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
    streamResults: vi.fn(async (_query: unknown, handlers: { onError?: (e: Error) => void }) => {
      handlers.onError?.(new Error("stream unavailable"));
    }),
  };
});

import {
  fetchTimeframes,
  fetchUniverses,
  fetchPatternCatalog,
  fetchActiveJobs,
  fetchResults,
  fetchSummary,
  fetchJob,
  startScan,
} from "../api/chartPatterns";
import {
  ensureCatalogLoaded,
  getChartPatternsState,
  resetChartPatternsState,
} from "./chartPatterns";

const mocked = {
  fetchTimeframes: vi.mocked(fetchTimeframes),
  fetchUniverses: vi.mocked(fetchUniverses),
  fetchPatternCatalog: vi.mocked(fetchPatternCatalog),
  fetchActiveJobs: vi.mocked(fetchActiveJobs),
  fetchResults: vi.mocked(fetchResults),
  fetchSummary: vi.mocked(fetchSummary),
  fetchJob: vi.mocked(fetchJob),
  startScan: vi.mocked(startScan),
};

const SUMMARY: PatternSummary = {
  scanned: 10,
  patterns: 1,
  in_view: 1,
  confirmed: 0,
  bullish: 1,
  bearish: 0,
  data_through: "2026-11-19",
};

function mockCatalog() {
  mocked.fetchTimeframes.mockResolvedValue([
    {
      id: "1D",
      label: "1 day",
      minutes: 1440,
      native: true,
      source_tf: null,
      max_lookback_days: 400,
      min_bars: 20,
    },
  ]);
  mocked.fetchUniverses.mockResolvedValue({
    universes: [{ id: "nifty50", label: "Nifty 50", count: 50 }],
    default: "nifty50",
  });
  mocked.fetchPatternCatalog.mockResolvedValue({
    families: [{ id: "reversal", label: "Reversal" }],
    patterns: [
      {
        pattern_id: "falling_wedge",
        name: "Falling Wedge",
        family: "reversal",
        direction: "bullish",
        description: "",
      },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  resetChartPatternsState();
  mocked.fetchActiveJobs.mockResolvedValue([]);
  mocked.fetchResults.mockResolvedValue({
    items: [],
    total: 0,
    summary: SUMMARY,
    data_through: "2026-11-19",
  });
  mocked.fetchSummary.mockResolvedValue(SUMMARY);
  mocked.startScan.mockResolvedValue({
    job_id: "cpj_auto",
    status: "queued",
    queue_position: null,
    queue_size: 8,
  });
  mocked.fetchJob.mockImplementation(() => new Promise(() => {}));
  mockCatalog();
});

afterEach(() => {
  resetChartPatternsState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("chartPatterns catalog bootstrap", () => {
  it("loads the registries on first call", async () => {
    await ensureCatalogLoaded();

    const state = getChartPatternsState();
    expect(state.timeframes.map((tf) => tf.id)).toEqual(["1D"]);
    expect(state.universes.map((universe) => universe.id)).toEqual(["nifty50"]);
    expect(state.patterns.map((pattern) => pattern.pattern_id)).toEqual(["falling_wedge"]);
    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(1);
    expect(mocked.fetchUniverses).toHaveBeenCalledTimes(1);
    expect(mocked.fetchPatternCatalog).toHaveBeenCalledTimes(1);
  });

  it("two concurrent consumers share one bootstrap fetch", async () => {
    await Promise.all([ensureCatalogLoaded(), ensureCatalogLoaded()]);

    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(1);
    expect(mocked.fetchUniverses).toHaveBeenCalledTimes(1);
    expect(mocked.fetchPatternCatalog).toHaveBeenCalledTimes(1);
  });

  it("a later consumer does not re-fetch an already loaded registry", async () => {
    await ensureCatalogLoaded();
    await ensureCatalogLoaded();

    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(1);
  });

  it("a forced retry re-fetches the registry", async () => {
    await ensureCatalogLoaded();
    await ensureCatalogLoaded(true);

    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(2);
  });

  it("a forced retry bypasses the API registry cache", async () => {
    await ensureCatalogLoaded();
    await ensureCatalogLoaded(true);

    expect(mocked.fetchTimeframes).toHaveBeenCalledWith(true);
    expect(mocked.fetchUniverses).toHaveBeenCalledWith(true);
    expect(mocked.fetchPatternCatalog).toHaveBeenCalledWith(true);
  });
});
