import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/chartPatterns", async () => (await import("./chartPatternsTestFixtures")).chartPatternsApiMock());

import { startScan, fetchResults, fetchSummary, streamResults } from "../api/chartPatterns";
import {
  CUSTOM_UNIVERSE,
  DEFAULT_PATTERN_FILTERS,
  getChartPatternsState,
  resetChartPatternsState,
  setFilter,
  setUniverse,
  triggerScan,
  triggerReplayScan,
  hasRestrictiveFilter,
} from "./chartPatterns";

const mocked = {
  startScan: vi.mocked(startScan),
  fetchResults: vi.mocked(fetchResults),
  fetchSummary: vi.mocked(fetchSummary),
  streamResults: vi.mocked(streamResults),
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChartPatternsState();
  // Pin the stream to "unavailable" so tests deterministically exercise the
  // non-streaming `fetchResults` fallback (real SSE would hit the network).
  mocked.streamResults.mockImplementation(
    async (_query: unknown, handlers: { onError?: (e: Error) => void }) => {
      handlers.onError?.(new Error("stream unavailable"));
    },
  );
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
    // The default-on 10d avg volume pre-filter is baseline, not user narrowing.
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS })).toBe(false);
    expect(hasRestrictiveFilter({ ...DEFAULT_PATTERN_FILTERS, min_avg_volume_10d: null })).toBe(false);
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

  it("refuses an empty custom scope without hitting the API", async () => {
    setUniverse(CUSTOM_UNIVERSE);
    mocked.startScan.mockClear();
    await triggerScan(true);
    expect(mocked.startScan).not.toHaveBeenCalled();
    expect(getChartPatternsState().error).toMatch(/Custom scope is empty/i);
  });

  it("scans a custom scope once it has symbols", async () => {
    setUniverse(CUSTOM_UNIVERSE);
    setFilter("symbols", ["INFY"]);
    await flush();
    mocked.startScan.mockClear();
    await triggerScan(true);
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ universe: CUSTOM_UNIVERSE, symbols: ["INFY"] }),
    );
  });
});
