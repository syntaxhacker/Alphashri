// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { resetChartPatternsState } from "../../../state/chartPatterns";

vi.mock("../../../api/chartPatterns", async () => {
  const actual = await vi.importActual<typeof import("../../../api/chartPatterns")>(
    "../../../api/chartPatterns",
  );
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

const ctl = vi.hoisted(() => ({ dockOpen: vi.fn() }));

vi.mock("../../common/symbolDockContext", () => ({
  useSymbolDock: () => ({
    open: ctl.dockOpen,
    preview: vi.fn(),
    endPreview: vi.fn(),
    close: vi.fn(),
    pinned: false,
    setOutlet: vi.fn(),
  }),
}));

vi.mock("../../patterns/PatternListView", () => ({
  PatternListView: (props: { hits: PatternHitDTO[] }) => (
    <div data-testid="patterns-list">
      {props.hits.map((hit) => <div data-testid={`patterns-row-${hit.symbol}`}>{hit.symbol}</div>)}
    </div>
  ),
}));

import {
  fetchTimeframes,
  fetchUniverses,
  fetchPatternCatalog,
  fetchActiveJobs,
  fetchResults,
  fetchSummary,
  fetchJob,
  startScan,
} from "../../../api/chartPatterns";
import { PATTERN_RESULTS_PANEL } from "./patternResults";

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

const SUMMARY = {
  scanned: 10,
  patterns: 1,
  in_view: 1,
  confirmed: 0,
  bullish: 1,
  bearish: 0,
  data_through: "2026-11-19",
};

function PatternWindow() {
  return <>{PATTERN_RESULTS_PANEL.mount(() => ({}), { data: () => undefined, commands: {} })}</>;
}

function renderWindows(count: number) {
  return renderWithProviders(() => (
    <>{Array.from({ length: count }, () => <PatternWindow />)}</>
  ));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChartPatternsState();
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
    {
      id: "1h",
      label: "1 hour",
      minutes: 60,
      native: true,
      source_tf: null,
      max_lookback_days: 80,
      min_bars: 30,
    },
  ]);
  mocked.fetchUniverses.mockResolvedValue({
    universes: [
      { id: "nifty50", label: "Nifty 50", count: 50 },
      { id: "nifty500", label: "Nifty 500", count: 500 },
    ],
    default: "nifty50",
  });
  mocked.fetchPatternCatalog.mockResolvedValue({ families: [], patterns: [] });
  mocked.fetchActiveJobs.mockResolvedValue([]);
  mocked.fetchResults.mockResolvedValue({
    items: [],
    total: 0,
    summary: SUMMARY,
    data_through: "2026-11-19",
  });
  mocked.fetchSummary.mockResolvedValue(SUMMARY);
  mocked.startScan.mockResolvedValue({
    job_id: "cpj_scan",
    status: "queued",
    queue_position: null,
    queue_size: 8,
  });
  mocked.fetchJob.mockImplementation(() => new Promise(() => {}));
});

afterEach(() => {
  cleanup();
  resetChartPatternsState();
});

describe("patterns.results window panel — catalog bootstrap", () => {
  it("(a) first mount bootstraps the registry and populates both selects", async () => {
    renderWindows(1);

    await waitFor(() => expect(screen.getByTestId("patterns-results-timeframe")).toBeInTheDocument());
    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(1);

    const labels = (testId: string) => {
      const select = screen.getByTestId(testId).querySelector("select")!;
      return Array.from(select.options).map((option) => option.textContent);
    };
    expect(labels("patterns-results-timeframe")).toContain("1 day");
    expect(labels("patterns-results-universe")).toContain("Nifty 50");
  });

  it("(b) two pattern windows produce one bootstrap fetch", async () => {
    renderWindows(2);

    await waitFor(() =>
      expect(screen.getAllByTestId("patterns-results-timeframe")).toHaveLength(2),
    );
    expect(mocked.fetchTimeframes).toHaveBeenCalledTimes(1);
    expect(mocked.fetchUniverses).toHaveBeenCalledTimes(1);
    expect(mocked.fetchPatternCatalog).toHaveBeenCalledTimes(1);
  });

  it("(d) Scan works after bootstrap", async () => {
    renderWindows(1);
    await waitFor(() => expect(screen.getByTestId("patterns-results-timeframe")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("patterns-results-scan"));

    await waitFor(() => expect(mocked.startScan).toHaveBeenCalledTimes(1));
    expect(mocked.startScan).toHaveBeenCalledWith(
      expect.objectContaining({ universe: "nifty50", timeframe: "1D" }),
    );
  });

  it("(empty-action) the empty state offers an enabled Scan button", async () => {
    renderWindows(1);
    await waitFor(() =>
      expect(screen.getByTestId("patterns-results-timeframe")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("patterns-results-empty")).toBeInTheDocument();

    const action = screen.getByTestId("patterns-results-empty-action");
    expect(action).toBeEnabled();
    fireEvent.click(action);
    await waitFor(() => expect(mocked.startScan).toHaveBeenCalledTimes(1));
  });
});
