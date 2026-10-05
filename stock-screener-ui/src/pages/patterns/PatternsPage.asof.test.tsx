// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
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

vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: ({ hits, onSelect }: any) => (
    <div data-testid="patterns-grid">
      {(hits as any[]).map((hit: any) => (
        <button
          key={hit.id ?? `${hit.symbol}-${hit.pattern_id}-${hit.start_date}`}
          type="button"
          data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
          onClick={() => onSelect?.(hit)}
        >
          {hit.symbol} {hit.pattern_name}
        </button>
      ))}
    </div>
  ),
}));

// Passthrough stub for the fullscreen view: renders the real contract testids
// for the as-of replay controls so page wiring is observable.
vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: ({ opened, hit, candles, asOf, fromDate, onAsOfChange, loading }: any) => {
    if (!opened) return null;
    return (
      <div data-testid="patterns-fullscreen-modal">
        <div>{hit?.pattern_name}</div>
        {onAsOfChange ? (
          <>
            <input
              data-testid="patterns-fullscreen-asof-from"
              type="datetime-local"
              value={fromDate ?? ""}
              onChange={(e) => onAsOfChange(asOf ?? null, e.target.value || null)}
            />
            <input
              data-testid="patterns-fullscreen-asof-to"
              type="datetime-local"
              value={asOf ?? ""}
              onChange={(e) => onAsOfChange(e.target.value || null, fromDate ?? null)}
            />
          </>
        ) : null}
        {asOf ? (
          <div data-testid="patterns-fullscreen-asof-banner">
            {`Viewing as of ${String(asOf).replace("T", " ")}`}
          </div>
        ) : null}
        {loading ? <div data-testid="patterns-fullscreen-loading" /> : null}
        <div data-testid="patterns-fullscreen-candle-count">{candles?.length ?? 0}</div>
      </div>
    );
  },
}));

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
    symbol: "IRCON",
    name: null,
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
    trendlines: [],
    notes: "",
    ...overrides,
  };
}

function makeProps(overrides: Partial<PatternsPageProps> = {}): PatternsPageProps {
  return {
    timeframes: [],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [],
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
      max_52w_gap: null,
      min_range_pos: null,
      min_rel_volume: null,
      min_volume_m: null,
      from_date: null,
      to_date: null,
      sort: "confidence",
      trendlines: "both",
    },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    computeTrendlines: true,
    setComputeTrendlines: vi.fn(),
    customUniverse: "custom",
    selectSymbols: vi.fn(),
    job: null,
    scanning: false,
    queuePosition: null,
    summary: null,
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

describe("PatternsPage fullscreen as-of replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPatternImages.mockResolvedValue({});
    fetchSymbolChart.mockResolvedValue({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [],
    });
  });
  afterEach(() => cleanup());

  test("opening a card starts live (no as-of banner, no asOf in the fetch)", async () => {
    r(<PatternsPage {...makeProps()} />);
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-from")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-asof-to")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).not.toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.not.objectContaining({ asOf: expect.anything(), fromDate: expect.anything() }),
    );
  });

  test("changing as-of re-fetches with detectPatterns + asOf/fromDate and promotes the best hit", async () => {
    const low = makeHit({ id: 11, pattern_name: "Falling Wedge", confidence: 60 });
    const high = makeHit({
      id: 22,
      pattern_id: "rising_wedge",
      pattern_name: "Rising Wedge",
      confidence: 90,
      start_date: "2026-07-01",
    });
    r(<PatternsPage {...makeProps({ results: [low], total: 1 })} />);
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");

    fetchSymbolChart.mockClear();
    let resolveReplay!: (v: unknown) => void;
    fetchSymbolChart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplay = resolve;
        }),
    );
    fireEvent.change(screen.getByTestId("patterns-fullscreen-asof-to"), {
      target: { value: "2026-09-30T14:30" },
    });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", {
        detectPatterns: true,
        asOf: "2026-09-30T14:30",
        fromDate: undefined,
      }),
    );
    // Loading state is kept while the replay fetch is in flight.
    expect(screen.getByTestId("patterns-fullscreen-loading")).toBeInTheDocument();

    await act(async () => {
      resolveReplay({
        symbol: "IRCON",
        timeframe: "1D",
        candles: [{ t: "2026-09-30T09:15:00+05:30", o: 1, h: 1, l: 1, c: 1, v: 1 }],
        overlays: [],
        trend_lines: [],
        hits: [low, high],
      });
    });

    // Highest-confidence hit promoted; replay candles swapped in; banner shown.
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge"),
    );
    expect(screen.getByTestId("patterns-fullscreen-candle-count")).toHaveTextContent("1");
    expect(screen.getByTestId("patterns-fullscreen-asof-banner")).toHaveTextContent(
      "Viewing as of 2026-09-30 14:30",
    );
    await waitFor(() =>
      expect(screen.queryByTestId("patterns-fullscreen-loading")).not.toBeInTheDocument(),
    );
  });

  test("a replay window with no hits clears the displayed hit", async () => {
    r(<PatternsPage {...makeProps()} />);
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Falling Wedge");

    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-06-01T09:15:00+05:30", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
      trend_lines: [],
      hits: [],
    });
    fireEvent.change(screen.getByTestId("patterns-fullscreen-asof-to"), {
      target: { value: "2026-06-30T14:30" },
    });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", {
        detectPatterns: true,
        asOf: "2026-06-30T14:30",
        fromDate: undefined,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).not.toHaveTextContent(
        "Falling Wedge",
      ),
    );
  });

  test("scan replay control runs the scanReplay callback with the replay window", async () => {
    const scanReplay = vi.fn();
    r(<PatternsPage {...makeProps({ scanReplay })} />);
    await userEvent.click(screen.getByTestId("patterns-replay-toggle"));
    fireEvent.change(screen.getByTestId("patterns-replay-asof"), {
      target: { value: "2026-09-30T14:30" },
    });
    await userEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(scanReplay).toHaveBeenCalledWith({ asOf: "2026-09-30T14:30", from: null });
  });

  test("replay as-of label is surfaced when set", () => {
    r(<PatternsPage {...makeProps({ replayAsOf: "2026-09-30T14:30" })} />);
    expect(screen.getByTestId("patterns-scan-asof")).toHaveTextContent(
      "as of 2026-09-30 14:30",
    );
  });
});
