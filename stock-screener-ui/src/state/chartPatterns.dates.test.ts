import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { startScan, fetchResults, fetchSummary } from "../api/chartPatterns";
import {
  DEFAULT_PATTERN_FILTERS,
  getChartPatternsState,
  resetChartPatternsState,
  setFilter,
  triggerScan,
  triggerReplayScan,
  hasRestrictiveFilter,
} from "./chartPatterns";

const mocked = {
  startScan: vi.mocked(startScan),
  fetchResults: vi.mocked(fetchResults),
  fetchSummary: vi.mocked(fetchSummary),
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChartPatternsState();
  mocked.fetchResults.mockResolvedValue({ items: [], total: 0, summary: undefined as never, data_through: null });
  mocked.fetchSummary.mockResolvedValue({ scanned: 0, patterns: 0, in_view: 0, confirmed: 0, bullish: 0, bearish: 0, data_through: null });
  mocked.startScan.mockResolvedValue({ job_id: "cpj_1", status: "queued", queue_position: null, queue_size: 1 });
});

describe("chartPatterns from/to date filters", () => {
  it("defaults from_date/to_date to null", () => {
    expect(DEFAULT_PATTERN_FILTERS.from_date).toBeNull();
    expect(DEFAULT_PATTERN_FILTERS.to_date).toBeNull();
    expect(getChartPatternsState().filters.from_date).toBeNull();
    expect(getChartPatternsState().filters.to_date).toBeNull();
  });

  it("treats from_date/to_date as restrictive filters", () => {
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS })).toBe(false);
    expect(
      hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, from_date: "2026-06-01" }),
    ).toBe(true);
    expect(
      hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, to_date: "2026-09-30T14:30" }),
    ).toBe(true);
  });

  it("baseQuery forwards from_date/to_date to fetchResults and fetchSummary", async () => {
    setFilter("from_date", "2026-06-01");
    setFilter("to_date", "2026-09-30T14:30");
    await flush();
    expect(mocked.fetchResults).toHaveBeenCalledWith(
      expect.objectContaining({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" }),
    );
    expect(mocked.fetchSummary).toHaveBeenCalledWith(
      expect.objectContaining({ from_date: "2026-06-01", to_date: "2026-09-30T14:30" }),
    );
  });

  it("triggerScan forwards filter dates to startScan as from_date/as_of_date", async () => {
    setFilter("from_date", "2026-06-01");
    setFilter("to_date", "2026-09-30T14:30");
    await flush();
    mocked.startScan.mockClear();
    await triggerScan(true);
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ from_date: "2026-06-01", as_of_date: "2026-09-30T14:30" }),
    );
    expect(getChartPatternsState().lastScanAsOf).toBe("2026-09-30T14:30");
    expect(getChartPatternsState().lastScanFrom).toBe("2026-06-01");
  });

  it("triggerScan omits replay keys when no dates are set", async () => {
    await triggerScan(true);
    const payload = mocked.startScan.mock.calls[0][0] as Record<string, unknown>;
    expect("as_of_date" in payload).toBe(false);
    expect("from_date" in payload).toBe(false);
    expect(getChartPatternsState().lastScanAsOf).toBeNull();
  });

  it("explicit replay overrides win over filter dates", async () => {
    setFilter("from_date", "2026-06-01");
    setFilter("to_date", "2026-09-30T14:30");
    await flush();
    mocked.startScan.mockClear();
    await triggerScan(true, { asOfDate: "2026-08-01T10:00", fromDate: "2026-07-01" });
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ from_date: "2026-07-01", as_of_date: "2026-08-01T10:00" }),
    );
  });

  it("triggerReplayScan runs a forced scan with the replay window", async () => {
    await triggerReplayScan("2026-09-30T14:30", "2026-06-01");
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({
        force: true,
        from_date: "2026-06-01",
        as_of_date: "2026-09-30T14:30",
      }),
    );
  });
});
