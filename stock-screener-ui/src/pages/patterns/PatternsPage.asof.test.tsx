// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { For, Show, type JSX } from "solid-js";
vi.mock("@tabler/icons-react", () => ({
  IconAdjustmentsHorizontal: (props: Record<string, unknown>) => <svg data-testid="icon-adjustments" aria-hidden {...props} />,
  IconDotsVertical: (props: Record<string, unknown>) => <svg data-testid="icon-dots" aria-hidden {...props} />,
}));
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

// Menu stub: bare pass-throughs with an onSelect-fired button; the suite
// asserts page wiring, not Menu internals.
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const stubbed = await uiLayoutStub(await importOriginal<Record<string, unknown>>());
  const passthrough = (props: any) => <div>{props.children}</div>;
  const Item = (props: any) => (
    <button
      type="button"
      disabled={props.disabled}
      aria-disabled={props.disabled ? "true" : undefined}
      onClick={() => (props.disabled ? undefined : props.onClick?.(props) ?? props.onSelect?.(props))}
      data-testid={props["data-testid"]}
    >
      {props.children}
    </button>
  );
  const Menu = Object.assign(
    (props: any) => <div data-testid="menu-root">{props.children}</div>,
    {
      Target: passthrough,
      Dropdown: passthrough,
      Item,
      Divider: () => <hr />,
      Label: (props: any) => <span>{props.children}</span>,
    },
  );
  return {
    ...stubbed,
    Menu,
    MenuTarget: passthrough,
    MenuDropdown: passthrough,
    MenuItem: Item,
  };
});

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const fetchSymbolChart = vi.fn();
const fetchPatternMatrix = vi.fn();
const fetchPatternHit = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
  fetchPatternMatrix: (...args: unknown[]) => fetchPatternMatrix(...args),
  fetchPatternHit: (...args: unknown[]) => fetchPatternHit(...args),
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: (props: any) => (
    <div data-testid="patterns-grid">
      <For each={props.hits as any[]}>
        {(hit: any) => (
          <button
            type="button"
            data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
            onClick={() => props.onSelect?.(hit)}
          >
            {hit.symbol} {hit.pattern_name}
          </button>
        )}
      </For>
    </div>
  ),
}));

// Dense list stub so the page default (list view) renders deterministically;
// tests that need cards switch to the grid view first.
vi.mock("@/components/patterns/PatternListView", () => ({
  PatternListView: (props: any) => (
    <div data-testid="patterns-list">
      <For each={props.hits as any[]}>
        {(hit: any) => (
          <button
            type="button"
            data-testid={`patterns-list-row-${hit.symbol}-${hit.pattern_id}`}
            onClick={() => props.onSelect?.(hit)}
          >
            {hit.symbol} {hit.pattern_name}
          </button>
        )}
      </For>
    </div>
  ),
}));

type FSVProps = {
  opened?: boolean;
  hit?: PatternHitDTO | null;
  candles?: unknown[];
  asOf?: string | null;
  fromDate?: string | null;
  onAsOfChange?: (asOf: string | null, fromDate: string | null) => void;
  loading?: boolean;
};

// Passthrough stub for the fullscreen view: renders the real contract testids
// for the as-of replay controls so page wiring is observable.
vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: FSVProps) => {
    const asOf = () => props.asOf;
    const fromDate = () => props.fromDate;
    const hit = () => props.hit;
    const candles = () => props.candles;
    const loading = () => props.loading;
    return (
      <Show when={props.opened}>
        <div data-testid="patterns-fullscreen-modal">
          <div>{hit()?.pattern_name}</div>
          <Show when={props.onAsOfChange}>
            <input
              data-testid="patterns-fullscreen-asof-from"
              type="datetime-local"
              value={fromDate() ?? ""}
              onInput={(e) => props.onAsOfChange?.(asOf() ?? null, (e.currentTarget as HTMLInputElement).value || null)}
            />
            <input
              data-testid="patterns-fullscreen-asof-to"
              type="datetime-local"
              value={asOf() ?? ""}
              onInput={(e) => props.onAsOfChange?.((e.currentTarget as HTMLInputElement).value || null, fromDate() ?? null)}
            />
          </Show>
          <Show when={asOf()}>
            <div data-testid="patterns-fullscreen-asof-banner">
              {`Viewing as of ${String(asOf()).replace("T", " ")}`}
            </div>
          </Show>
          <Show when={loading()}>
            <div data-testid="patterns-fullscreen-loading" />
          </Show>
          <div data-testid="patterns-fullscreen-candle-count">{candles()?.length ?? 0}</div>
        </div>
      </Show>
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
      min_avg_volume_10d: 150,
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
    defaultView: "list",
    ...overrides,
  };
}

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

describe("PatternsPage fullscreen as-of replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPatternImages.mockResolvedValue({});
    fetchPatternHit.mockResolvedValue(undefined as never);
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
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

  test("changing as-of re-fetches with detectPatterns + asOf/fromDate and promotes the newest hit", async () => {
    // Newest wins over confidence: the older hit is far more confident but
    // the fullscreen must default to the newest formation in the window.
    const oldConfident = makeHit({ id: 11, pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    const newWeak = makeHit({
      id: 22,
      pattern_id: "rising_wedge",
      pattern_name: "Rising Wedge",
      confidence: 60,
      end_date: "2026-09-28",
      bars_ago: 1,
      start_date: "2026-07-01",
    });
    r(<PatternsPage {...makeProps({ results: [oldConfident], total: 1 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");

    fetchSymbolChart.mockClear();
    let resolveReplay!: (v: unknown) => void;
    fetchSymbolChart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReplay = resolve;
        }),
    );
    fireEvent.input(screen.getByTestId("patterns-fullscreen-asof-to"), {
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

    resolveReplay({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-09-30T09:15:00+05:30", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
      trend_lines: [],
      hits: [oldConfident, newWeak],
    });

    // Newest hit promoted; replay candles swapped in; banner shown.
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
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
    fireEvent.input(screen.getByTestId("patterns-fullscreen-asof-to"), {
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
    fireEvent.click(screen.getByTestId("patterns-replay-toggle"));
    fireEvent.input(screen.getByTestId("patterns-replay-asof"), {
      target: { value: "2026-09-30T14:30" },
    });
    fireEvent.click(screen.getByTestId("patterns-replay-run"));
    expect(scanReplay).toHaveBeenCalledWith({ asOf: "2026-09-30T14:30", from: null });
  });

  test("replay as-of label is surfaced when set", () => {
    r(<PatternsPage {...makeProps({ replayAsOf: "2026-09-30T14:30" })} />);
    expect(screen.getByTestId("patterns-scan-asof")).toHaveTextContent("as of 2026-09-30 14:30");
  });
});
