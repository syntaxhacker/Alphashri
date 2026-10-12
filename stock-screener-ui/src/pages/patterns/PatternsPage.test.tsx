// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const fetchSymbolChart = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

// Rendered-prop spies for the trendlines-view wiring tests.
const gridTrendlinesViews = vi.hoisted(() => [] as unknown[]);
const fullscreenTrendlinesViews = vi.hoisted(() => [] as unknown[]);
// Records the `overlays` prop per fullscreen render (single-pattern contract:
// the page always passes an empty list so only the active hit is drawn).
const fullscreenOverlays = vi.hoisted(() => [] as unknown[]);

// Faithful stubs: preserve the contract testids the page relies on
// (card buttons incl. expand affordance, fullscreen modal + chart +
// "No chart data") while recording the `trendlinesView` prop.
vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: ({ hits, onSelect, onExpand, trendlinesView = "both" }: any) => {
    gridTrendlinesViews.push(trendlinesView);
    return (
      <div data-testid="patterns-grid" data-trendlines-view={trendlinesView}>
        {(hits as any[]).map((hit: any) => (
          <div key={hit.id ?? `${hit.symbol}-${hit.pattern_id}-${hit.start_date}`}>
            <button
              type="button"
              data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
              onClick={() => onSelect?.(hit)}
            >
              {hit.symbol} {hit.pattern_name}
            </button>
            <button
              type="button"
              data-testid={`patterns-card-expand-${hit.symbol}-${hit.pattern_id}`}
              aria-label={`Open fullscreen chart for ${hit.symbol} ${hit.pattern_name}`}
              onClick={(e) => {
                e.stopPropagation();
                onExpand?.(hit);
              }}
            >
              expand
            </button>
          </div>
        ))}
      </div>
    );
  },
}));

// Dense list stub: mirrors the grid contract (row buttons + onSelect) so the
// page tests stay deterministic without mounting the real TanStackTable.
vi.mock("@/components/patterns/PatternListView", () => ({
  PatternListView: ({ hits, onSelect }: any) => (
    <div data-testid="patterns-list">
      {(hits as any[]).map((hit: any) => (
        <button
          key={hit.id ?? `${hit.symbol}-${hit.pattern_id}-${hit.start_date}`}
          type="button"
          data-testid={`patterns-list-row-${hit.symbol}-${hit.pattern_id}`}
          onClick={() => onSelect?.(hit)}
        >
          {hit.symbol} {hit.pattern_name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({  PatternFullscreenView: ({ opened, onClose, hit, hits = [], onSelectHit, candles, overlays, trendlinesView = "both", timeframe, timeframes = [], onTimeframeChange, loading = false }: any) => {
    fullscreenTrendlinesViews.push(trendlinesView);
    fullscreenOverlays.push(overlays);
    if (!opened) return null;
    const options = (timeframes as any[]).length > 0 ? (timeframes as any[]) : [{ id: timeframe, label: timeframe }];
    return (
      <div data-testid="patterns-fullscreen-modal" data-trendlines-view={trendlinesView}>
        <div data-testid="patterns-fullscreen-active-hit">{hit?.pattern_name}</div>
        {(hits as any[]).map((h: any, i: number) => (
          <button
            key={h.id ?? `${h.symbol}-${h.pattern_id}-${h.start_date}`}
            type="button"
            data-testid={`patterns-fullscreen-list-item-${i}`}
            onClick={() => onSelectHit?.(h)}
          >
            {h.pattern_name}
          </button>
        ))}
        {onTimeframeChange && timeframe != null ? (
          <select
            data-testid="patterns-fullscreen-timeframe"
            aria-label="Fullscreen timeframe"
            value={timeframe}
            onChange={(e) => onTimeframeChange(e.target.value)}
          >
            {options.map((tf: any) => (
              <option key={tf.id} value={tf.id}>
                {tf.label || tf.id}
              </option>
            ))}
          </select>
        ) : null}
        {loading ? <div data-testid="patterns-fullscreen-loading" /> : null}
        <button type="button" onClick={onClose}>
          Close
        </button>
        <div data-testid="patterns-fullscreen-chart" />
        {(candles?.length ?? 0) === 0 ? <div>No chart data</div> : null}
      </div>
    );
  },
}));

// Native-select stubs so toolbar wiring is deterministic (the real MUI
// Select needs popup interaction). Testids + onChange contracts preserved.
vi.mock("@/components/patterns/TimeframeSelect", () => ({
  TimeframeSelect: ({ timeframes, value, onChange }: any) => {
    const source =
      (timeframes as any[]).length > 0 ? (timeframes as any[]) : [{ id: value, label: value }];
    return (
      <select
        data-testid="patterns-timeframe-select"
        aria-label="Timeframe"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {source.map((tf: any) => (
          <option key={tf.id} value={tf.id}>
            {tf.label || tf.id}
          </option>
        ))}
      </select>
    );
  },
}));

vi.mock("@/components/patterns/LookbackSelect", () => ({
  LookbackSelect: ({ value, onChange }: any) => (
    <select
      data-testid="patterns-lookback-select"
      aria-label="Lookback"
      value={value == null ? "auto" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "auto" ? null : Number(v));
      }}
    >
      <option value="auto">Auto</option>
      <option value="250">250</option>
      <option value="500">500</option>
    </select>
  ),
}));

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: "IRCON International Ltd.",
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 78.4,
    start_date: "2026-04-26",
    end_date: "2026-09-26",
    start_price: 129.8,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-26", price: 129.8 },
        { t: "2026-09-26", price: 112.6 },
      ],
    ],
    notes: "Higher lows into a falling wedge.",
    ...overrides,
  };
}

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function makeProps(overrides: Partial<PatternsPageProps> = {}): PatternsPageProps {
  return {
    timeframes: [],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "…" },
    ],
    timeframe: "1D",
    setTimeframe: vi.fn(),
    lookbackBars: null,
    setLookbackBars: vi.fn(),
    universe: "nifty500",
    setUniverse: vi.fn(),
    filters: {
      family: [],
      pattern_id: [],
      direction: [],
      status: [],
      quality: null,
      formed_within_bars: null,
      volume_confirmed: null,
      min_rr: null,
      symbol: null,
      symbols: [],
      q: "",
      min_base_days: null,
      max_range_pct: null,
      sort: "confidence",
      trendlines: "both",
    },    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    computeTrendlines: true,
    setComputeTrendlines: vi.fn(),
    customUniverse: "custom",
    selectSymbols: vi.fn(),
    job: null,
    scanning: false,
    queuePosition: null,
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    loading: false,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    forceRefresh: vi.fn(),
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridTrendlinesViews.length = 0;
    fullscreenTrendlinesViews.length = 0;
    fullscreenOverlays.length = 0;
    fetchPatternImages.mockResolvedValue({
      falling_wedge: "/api/chart-patterns/image/falling_wedge",
    });
    fetchSymbolChart.mockResolvedValue({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          trendlines: [[{ t: "2026-06-10", price: 235 }, { t: "2026-09-15", price: 311 }]],
        },
      ],
    });
  });
  afterEach(() => cleanup());

  test("renders all contract regions and testids", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-view-toggle")).toBeInTheDocument();
    // List is the default dense view; the grid mounts only after toggling.
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-list-row-IRCON-falling_wedge")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("view toggle switches between the dense list and the card grid", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(await screen.findByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("clicking a list row opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("Filters button opens the modal with the full rail", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-rail")).toBeInTheDocument();
    // Pattern tiles show the reference image + label.
    const img = await screen.findByTestId("pattern-image-falling_wedge");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.getByTestId("patterns-filter-pattern-falling_wedge")).toHaveTextContent(
      "Falling Wedge",
    );
    await userEvent.click(screen.getByTestId("patterns-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument());
  });

  test("renders symbol filter and results search controls", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
  });

  test("renders every required stat key", () => {
    r(<PatternsPage {...makeProps()} />);
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(screen.getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("7");
  });

  test("shows loading state", () => {
    r(<PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
  });

  test("shows scan progress in the grid while a scan is running", () => {
    r(
      <PatternsPage
        {...makeProps({
          results: [],
          total: 0,
          scanning: true,
          timeframe: "1h",
          job: {
            job_id: "cpj_x",
            universe: "nifty50",
            timeframe: "1h",
            status: "running",
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12 / 50 stocks");
  });

  test("shows empty state with refresh action", async () => {
    const props = makeProps({ results: [], total: 0 });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.refresh).toHaveBeenCalledTimes(1);
  });

  test("empty state offers a scan CTA for the current universe/timeframe", async () => {
    const props = makeProps({ results: [], total: 0, timeframe: "15m", universe: "nifty500" });
    r(<PatternsPage {...props} />);
    const cta = screen.getByTestId("patterns-empty-scan");
    expect(cta).toHaveTextContent("Scan 15m now");
    expect(screen.getByTestId("patterns-empty")).toHaveTextContent("nifty500 · 15m");
    await userEvent.click(cta);
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("clicking a card opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("scan again triggers scan", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-scan-again"));
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("filter edits are staged and applied only when Filter is clicked", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-open-filters"));
    await userEvent.click(await screen.findByTestId("patterns-family-reversal"));
    // Staged locally — no instant store update / reload.
    expect(props.setFilter).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("patterns-filters-done"));
    expect(props.applyFilters).toHaveBeenCalledWith(
      expect.objectContaining({ family: ["reversal"] }),
    );
  });

  test("shows the error alert instead of the generic empty copy when error is set", () => {
    r(<PatternsPage {...makeProps({ results: [], total: 0, error: "Scan failed: boom" })} />);
    expect(screen.getByTestId("patterns-error")).toHaveTextContent("Scan failed: boom");
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
  });

  test("keeps the list mounted with a refresh overlay while reloading", () => {
    r(<PatternsPage {...makeProps({ loading: true })} />);
    // Existing results stay visible (no remount churn)…
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    // …with an overlay spinner instead of the full-page loader.
    expect(screen.getByTestId("patterns-refreshing")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
  });

  test("TLS/TLR toggle reflects state and calls setComputeTrendlines", async () => {
    const props = makeProps({ computeTrendlines: true });
    r(<PatternsPage {...props} />);
    expect(screen.getByText("TLS/TLR")).toBeInTheDocument();
    const toggle = screen.getByTestId("patterns-compute-trendlines");
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(props.setComputeTrendlines).toHaveBeenCalledWith(false);
  });

  test("TLS/TLR toggle renders unchecked when computation is off", () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    expect(screen.getByTestId("patterns-compute-trendlines")).not.toBeChecked();
  });

  test("stale same-symbol fetches never overwrite the newer selection", async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    fetchSymbolChart
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    const first = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", start_date: "2026-04-26" });
    const second = makeHit({ id: 22, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", start_date: "2026-07-01" });
    r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));

    // Click two cards of the same symbol in quick succession.
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-rising_wedge"));
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    // Current request resolves with no candles; the stale one resolves last
    // carrying candles. Without the guard the stale fetch would paint the
    // first hit's candles into the second hit's fullscreen view.
    resolveSecond({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge"),
    );
    resolveFirst({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-05-04T18:30:00+00:00", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
    });
    // Flush the stale promise chain: without the guard it would paint the
    // first hit's candles here and remove "No chart data".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The newer selection stands: still the second hit, still no chart data.
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });
});

describe("PatternsPage toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridTrendlinesViews.length = 0;
    fullscreenTrendlinesViews.length = 0;
    fullscreenOverlays.length = 0;
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
  });
  afterEach(() => cleanup());

  test("renders the scan-scope and results-toolbar contract regions", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-scan-scope")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
  });

  test("toolbar shows timeframe, lookback, filter-results and TLS/TLR controls", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-lookback-select")).toBeInTheDocument();
    // Native input carries the testid (see TextInput htmlInput slot).
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Symbol or company")).toBeInTheDocument();
    expect(screen.getByText("TLS/TLR")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-compute-trendlines")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
  });

  test("changing the timeframe select calls setTimeframe", async () => {
    const props = makeProps({
      timeframes: [
        { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
        { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
      ],
    });
    r(<PatternsPage {...props} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-timeframe-select"), "1h");
    expect(props.setTimeframe).toHaveBeenCalledWith("1h");
  });

  test("changing the lookback select calls setLookbackBars", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.selectOptions(screen.getByTestId("patterns-lookback-select"), "250");
    expect(props.setLookbackBars).toHaveBeenCalledWith(250);
  });

  test("typing in Filter results commits the debounced q filter", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.type(screen.getByTestId("patterns-results-search"), "TCS");
    await waitFor(
      () => expect(props.setFilter).toHaveBeenCalledWith("q", "TCS"),
      { timeout: 3000 },
    );
  });

  test("Filters button shows the active-filter count", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"] },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("Filters button counts the score and breakout floors", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_confidence: 70, min_breakout_score: 60 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (2)");
  });

  test("results toolbar drops the redundant count label (stats strip owns the count)", () => {
    r(<PatternsPage {...makeProps({ results: [makeHit()], total: 1 })} />);
    const toolbar = screen.getByTestId("patterns-results-toolbar");
    expect(within(toolbar).queryByText("1 patterns")).not.toBeInTheDocument();
    expect(within(toolbar).queryByText("Patterns")).not.toBeInTheDocument();
    // The stats strip still reports the pattern count.
    expect(screen.getByTestId("patterns-stat-patterns")).toHaveTextContent("12");
  });

  test("Filters button counts a non-default 10d avg volume filter", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 200 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters (1)");
  });

  test("Filters button ignores the default 10d avg volume floor", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, min_avg_volume_10d: 150 },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });

  test("Filters button shows no count when filters are pristine", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-open-filters")).toHaveTextContent("Filters");
    expect(screen.getByTestId("patterns-open-filters")).not.toHaveTextContent("(");
  });

  test("Force refresh button calls forceRefresh", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-overflow"));
    await userEvent.click(await screen.findByTestId("patterns-force-refresh"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
  });

  test("Force refresh button is disabled while scanning", async () => {
    r(<PatternsPage {...makeProps({ scanning: true })} />);
    await userEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: MUI signals disabled via aria-disabled
    // (pointer-events:none blocks real clicks, same as the old button).
    expect(await screen.findByTestId("patterns-force-refresh")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test("shows the cached chip with age + force re-run when the job was reused", async () => {
    const props = makeProps({
      job: {
        job_id: "cpj_reused",
        universe: "nifty500",
        timeframe: "1D",
        status: "completed" as const,
        total: 500,
        done: 500,
        failed: 0,
        skipped: 0,
        queue_position: null,
        started_at: null,
        finished_at: null,
        data_through: "2026-09-30",
        error: null,
        reused: true,
        reused_from: "cpj_prev",
        reused_age_sec: 720,
        reused_finished_at: null,
      },
      scanning: false,
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-reused")).toHaveTextContent("Cached · 12 min ago");
    expect(screen.getByTestId("patterns-scan-data-through")).toHaveTextContent("as of 2026-09-30");
    // The chip's own Force re-run action re-runs fresh.
    await userEvent.click(screen.getByTestId("patterns-scan-reused-force"));
    expect(props.forceRefresh).toHaveBeenCalledTimes(1);
    // The existing Force refresh action stays available in the overflow menu.
    await userEvent.click(screen.getByTestId("patterns-overflow"));
    expect(await screen.findByTestId("patterns-force-refresh")).toBeInTheDocument();
  });

  test("reused chip tooltip lists the cache layers", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_reused",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            reused: true,
            reused_from: "cpj_prev",
            reused_age_sec: 720,
            reused_finished_at: null,
            provenance: {
              scan_reused: true,
              candles_cached: 480,
              candles_fetched: 20,
              prefilter_dropped: 12,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    // MUI surfaces a string tooltip title as the wrapper's aria-label.
    expect(screen.getByLabelText(/Scan reused: yes \(12 min ago\)/)).toHaveAttribute(
      "aria-label",
      "Scan reused: yes (12 min ago) — data unchanged · Candle cache: 480 cached / 20 fetched · Prefilter dropped: 12 · Detector v3 · Data as of 2026-09-30",
    );
  });

  test("shows the fresh chip for a freshly computed completed scan", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_fresh",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 0,
              candles_fetched: 500,
              prefilter_dropped: 0,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Fresh");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-data-through")).toHaveTextContent("as of 2026-09-30");
    expect(
      screen.getByLabelText("Scan reused: no — freshly computed · Candle cache: 0 cached / 500 fetched · Prefilter dropped: 0 · Detector v3 · Data as of 2026-09-30"),
    ).toBeInTheDocument();
  });

  test("shows the mixed cache share when candles were partly cached", () => {
    r(
      <PatternsPage
        {...makeProps({
          job: {
            job_id: "cpj_mixed",
            universe: "nifty500",
            timeframe: "1D",
            status: "completed" as const,
            total: 500,
            done: 500,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: "2026-09-30",
            error: null,
            provenance: {
              scan_reused: false,
              candles_cached: 335,
              candles_fetched: 165,
              prefilter_dropped: null,
              detector_version: 3,
              data_through: "2026-09-30",
            },
          },
          scanning: false,
        })}
      />,
    );
    // 335/500 → 67%.
    expect(screen.getByTestId("patterns-scan-fresh")).toHaveTextContent("Cache 67%");
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });

  test("no cache chip while a scan is active", () => {
    r(
      <PatternsPage
        {...makeProps({
          scanning: true,
          job: {
            job_id: "cpj_run",
            universe: "nifty500",
            timeframe: "1D",
            status: "running" as const,
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    expect(screen.queryByTestId("patterns-scan-status")).not.toBeInTheDocument();
  });

  test("no reused notice for a freshly computed scan", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-scan-reused")).not.toBeInTheDocument();
  });
});

describe("PatternsPage applied filters + modal + fullscreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    gridTrendlinesViews.length = 0;
    fullscreenTrendlinesViews.length = 0;
    fullscreenOverlays.length = 0;
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
  });
  afterEach(() => cleanup());

  test("applied-filters row renders one chip per active value", () => {
    const props = makeProps({
      filters: { ...makeProps().filters, family: ["reversal"], direction: ["bullish"], quality: "strong" },
    });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-applied-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-applied-filter-family:reversal")).toHaveTextContent("Family: Reversal");
    expect(screen.getByTestId("patterns-applied-filter-direction:bullish")).toHaveTextContent("Direction: Bullish");
    expect(screen.getByTestId("patterns-applied-filter-quality:strong")).toBeInTheDocument();
  });

  test("applied-filters row is absent when no filters are active", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-applied-filters")).not.toBeInTheDocument();
  });

  test("removing an applied chip calls setFilter with the value dropped", async () => {
    const props = makeProps({ filters: { ...makeProps().filters, family: ["reversal"] } });
    r(<PatternsPage {...props} />);
    const chip = screen.getByTestId("patterns-applied-filter-family:reversal");
    await userEvent.click(within(chip).getByTestId("CancelIcon"));
    expect(props.setFilter).toHaveBeenCalledWith("family", []);
  });

  test("Clear all in the applied row calls resetFilters", async () => {
    const props = makeProps({ filters: { ...makeProps().filters, family: ["reversal"] } });
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-applied-clear-all"));
    expect(props.resetFilters).toHaveBeenCalledTimes(1);
  });

  test("filters modal exposes the modal region; Reset all stages a reset", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-modal")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-reset"));
    // Reset is staged locally; nothing hits the store until Filter.
    expect(props.resetFilters).not.toHaveBeenCalled();
  });

  test("expand button on a card opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-card-expand-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", { detectPatterns: true, computeTrendlines: true });
  });

  test("grid + fullscreen default to the both trendlines view when computing", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: true })} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(gridTrendlinesViews.at(-1)).toBe("both");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "both");
  });

  test("TLS/TLR toggle off passes trendlinesView=none to grid and fullscreen", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(gridTrendlinesViews.at(-1)).toBe("none");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "none");
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toHaveAttribute(
      "data-trendlines-view",
      "none",
    );
    expect(fullscreenTrendlinesViews.at(-1)).toBe("none");
  });

  test("opening a card opts the chart fetch out of trendline computation when TLS/TLR is off", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ computeTrendlines: false }),
    );
  });

  test("opening a card forwards computeTrendlines when TLS/TLR is on", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: true, lookbackBars: 250 })} />);
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      { detectPatterns: true, lookbackBars: 250, computeTrendlines: true },
    );
  });

  test("view-only trendlines filter flows through when computation stays on", async () => {
    r(
      <PatternsPage
        {...makeProps({
          computeTrendlines: true,
          filters: { ...makeProps().filters, trendlines: "support" },
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(gridTrendlinesViews.at(-1)).toBe("support");
  });

  test("scan banner stays above the results while a scan runs with results", async () => {
    r(
      <PatternsPage
        {...makeProps({
          scanning: true,
          job: {
            job_id: "cpj_banner",
            universe: "nifty500",
            timeframe: "1D",
            status: "running",
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    // Banner variant (compact count, no spaces around the slash) + grid kept.
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12/50 stocks");
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
  });

  test("loading with no results and no active scan shows the generic loader", () => {
    r(<PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.getByText("Loading results…")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("opening a card loads the hit's timeframe into the fullscreen selector", async () => {
    const hit = makeHit({ timeframe: "1h" });
    r(
      <PatternsPage
        {...makeProps({
          timeframe: "1D",
          results: [hit],
          total: 1,
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    const select = await screen.findByTestId("patterns-fullscreen-timeframe");
    expect(select).toHaveValue("1h");
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1h",
      expect.objectContaining({ computeTrendlines: true }),
    );
  });

  test("selecting a new fullscreen timeframe re-runs detection and promotes the newest hit", async () => {
    // Newest wins over confidence: the older hit is far more confident but
    // the fullscreen must default to the newest formation.
    const oldConfident = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    const newWeak = makeHit({ id: 22, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", confidence: 60, end_date: "2026-09-28", bars_ago: 1, start_date: "2026-07-01" });
    r(
      <PatternsPage
        {...makeProps({
          results: [oldConfident],
          total: 1,
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [{ pattern_id: "rising_wedge", pattern_name: "Rising Wedge", trendlines: [] }],
      trend_lines: [],
      hits: [oldConfident, newWeak],
    });

    await userEvent.selectOptions(screen.getByTestId("patterns-fullscreen-timeframe"), "1h");

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1h", { detectPatterns: true }),
    );
    // Newest hit is promoted (not highest confidence); the new candles clear the empty state.
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Rising Wedge"),
    );
    expect(screen.queryByText("No chart data")).not.toBeInTheDocument();
    // Single-pattern contract: no dashed sibling overlays reach the chart.
    expect(fullscreenOverlays.at(-1)).toEqual([]);
  });

  test("a fullscreen timeframe switch with no hits clears the displayed hit", async () => {
    r(
      <PatternsPage
        {...makeProps({
          timeframes: [
            { id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 },
            { id: "1h", label: "1h", minutes: 60, native: "hours/1", source_tf: null, max_lookback_days: 365, min_bars: 60 },
          ],
        })}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Falling Wedge");
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      trend_lines: [],
      hits: [],
    });

    await userEvent.selectOptions(screen.getByTestId("patterns-fullscreen-timeframe"), "1h");

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1h", { detectPatterns: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).not.toHaveTextContent("Falling Wedge"),
    );
  });

  test("opening a card defaults to the newest hit and list selection switches it", async () => {
    const cardHit = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    const newerHit = makeHit({ id: 22, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", confidence: 60, end_date: "2026-09-28", bars_ago: 1, start_date: "2026-07-01" });
    r(<PatternsPage {...makeProps({ results: [cardHit], total: 1 })} />);
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      trend_lines: [],
      hits: [newerHit],
    });

    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    // The open fetch runs detection so the panel can list every pattern.
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      ),
    );
    // Default shown pattern is the newest — not the clicked card.
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Rising Wedge"),
    );
    // Both hits are listed, newest first.
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Rising Wedge");    expect(screen.getByTestId("patterns-fullscreen-list-item-1")).toHaveTextContent("Falling Wedge");

    // Selecting the older row replaces the shown pattern (single active).
    await userEvent.click(screen.getByTestId("patterns-fullscreen-list-item-1"));
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Falling Wedge"),
    );
  });

  test("de-duplicates a stored card hit against the same live hit returned with id:null", async () => {
    const cardHit = makeHit({
      id: 34562,
      pattern_id: "ascending_channel",
      pattern_name: "Ascending Channel",
      start_date: "2026-05-21",
      end_date: "2026-09-08",
      bars_ago: 17,
    });
    r(<PatternsPage {...makeProps({ results: [cardHit], total: 1 })} />);
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [],
      trend_lines: [],
      // Live detection returns the SAME pattern with no DB id.
      hits: [{ ...cardHit, id: null }],
    });

    await userEvent.click(screen.getByRole("button", { name: "Grid" }));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-ascending_channel"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Ascending Channel"),
    );
    // One row, not two: the id-carrying card hit and the id-less live hit are the same.
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Ascending Channel");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
  });
});

describe("PatternsPage copy CSV", () => {
  const writeText = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("Copy CSV copies the result rows and shows a confirmation", async () => {
    const second = makeHit({
      id: 2,
      symbol: "TCS",
      name: "Tata Consultancy Services Ltd.",
      pattern_id: "rising_wedge",
      pattern_name: "Rising Wedge",
    });
    r(<PatternsPage {...makeProps({ results: [makeHit(), second], total: 2 })} />);

    await userEvent.click(screen.getByTestId("patterns-overflow"));
    await userEvent.click(await screen.findByTestId("patterns-copy-csv"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = String(writeText.mock.calls[0][0]);
    const [header, ...lines] = text.split("\n");
    expect(header).toContain("Symbol");
    expect(header).toContain("Pattern");
    expect(text).toContain("IRCON");
    expect(text).toContain("TCS");
    expect(lines).toHaveLength(2);

    const toast = await screen.findByTestId("patterns-copy-toast");
    expect(toast).toHaveTextContent("Copied 2 rows");
  });

  test("Copy symbols copies the result symbols as a comma list", async () => {
    r(<PatternsPage {...makeProps()} />);

    await userEvent.click(screen.getByTestId("patterns-overflow"));
    await userEvent.click(await screen.findByTestId("patterns-copy-symbols"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toBe("NSE:IRCON");

    const toast = await screen.findByTestId("patterns-copy-toast");
    expect(toast).toHaveTextContent("Copied 1 symbol");
  });

  test("copy buttons are disabled when there are no results", async () => {
    r(<PatternsPage {...makeProps({ results: [], total: 0 })} />);
    await userEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: MUI signals disabled via aria-disabled
    // (pointer-events:none blocks real clicks, same as the old buttons).
    expect(await screen.findByTestId("patterns-copy-csv")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(await screen.findByTestId("patterns-copy-symbols")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});
