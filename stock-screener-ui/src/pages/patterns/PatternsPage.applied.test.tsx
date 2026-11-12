// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import type { JSX } from "solid-js";
import { createSignal, For, Show } from "solid-js";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

// These page tests mount the real filter modal (@/ui Autocomplete + Select).
// Under a full-suite run with 8 workers the multi-select interaction can exceed
// the 5s default; the assertions are deterministic, so allow a slower machine.
vi.setConfig({ testTimeout: 20_000 });

// @/ui's dynamic-tag layout primitives crash at runtime on this branch;
// stub them with intrinsic elements (see src/pages/solidTestStubs.tsx).
vi.mock("@/ui", async (importOriginal) => {
  const { uiLayoutStub } = await import("@/pages/solidTestStubs");
  const stubbed = await uiLayoutStub(await importOriginal<Record<string, unknown>>());
  // @/ui's Menu is broken on this branch (calls createSignal without
  // importing it), so stub the compound with bare pass-throughs.
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

// src/components/common/MembersDrawer.tsx is mid-edit (syntax-broken object
// spread in the other agent's in-flight conversion); IndexMembersDrawer wraps
// it. Mocking it here keeps this suite green until that file compiles again.
vi.mock("@/components/patterns/IndexMembersDrawer", () => ({
  IndexMembersDrawer: () => null,
}));

// @tabler/icons-react ships React memo() components — objects, not functions —
// so Solid's createComponent throws on them. Stub with inline SVGs.
vi.mock("@tabler/icons-react", () => ({
  IconAdjustmentsHorizontal: (props: Record<string, unknown>) => <svg data-testid="icon-adjustments" aria-hidden {...props} />,
  IconDotsVertical: (props: Record<string, unknown>) => <svg data-testid="icon-dots" aria-hidden {...props} />,
}));

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
  PatternGrid: (props: any) => {
    gridTrendlinesViews.push(props.trendlinesView ?? "both");
    return (
      <div data-testid="patterns-grid" data-trendlines-view={props.trendlinesView ?? "both"}>
        <For each={props.hits as any[]}>
          {(hit: any) => (
            <div>
              <button
                type="button"
                data-testid={`patterns-card-${hit.symbol}-${hit.pattern_id}`}
                onClick={() => props.onSelect?.(hit)}
              >
                {hit.symbol} {hit.pattern_name}
              </button>
              <button
                type="button"
                data-testid={`patterns-card-expand-${hit.symbol}-${hit.pattern_id}`}
                aria-label={`Open fullscreen chart for ${hit.symbol} ${hit.pattern_name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onExpand?.(hit);
                }}
              >
                expand
              </button>
            </div>
          )}
        </For>
      </div>
    );
  },
}));

// Dense list stub: mirrors the grid contract (row buttons + onSelect) so the
// page tests stay deterministic without mounting the real TanStackTable.
vi.mock("@/components/patterns/PatternListView", () => ({
  PatternListView: (props: any) => (
    <div data-testid="patterns-list">
      <For each={props.hits as any[]}>
        {(hit: any) => (
          <div>
            <button
              type="button"
              data-testid={`patterns-list-row-${hit.symbol}-${hit.pattern_id}`}
              onClick={() => props.onSelect?.(hit)}
            >
              {hit.symbol} {hit.pattern_name}
            </button>
            <span
              data-testid={`patterns-list-tv-${hit.symbol}-wrap`}
              onMouseEnter={() => props.onSymbolPreview?.(hit.symbol)}
              onMouseLeave={() => props.onSymbolPreviewEnd?.(hit.symbol)}
            >
              {hit.symbol}
            </span>
            <button
              type="button"
              data-testid={`patterns-list-chart-${hit.symbol}`}
              onClick={() => props.onSymbolOpen?.(hit.symbol)}
            >
              chart
            </button>
          </div>
        )}
      </For>
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternSymbolMatrix", () => ({
  PatternSymbolMatrix: (props: any) => (
    <div data-testid="patterns-symbol-matrix">
      <span data-testid="matrix-timeframes">{(props.timeframes as string[]).join(",")}</span>
      <For each={props.rows as any[]}>
        {(row: any) => (
          <button
            type="button"
            data-testid={`matrix-row-${row.symbol}`}
            onClick={() => row.best && props.onSelect?.(row.best)}
          >
            {row.symbol}
          </button>
        )}
      </For>
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: any) => {
    fullscreenTrendlinesViews.push(props.trendlinesView ?? "both");
    fullscreenOverlays.push(props.overlays);
    const docked = () => props.docked ?? false;
    const tfs = () => ((props.timeframes as any[]) ?? []).length > 0 ? (props.timeframes as any[]) : [{ id: props.timeframe, label: props.timeframe }];
    return (
      <Show when={props.opened}>
        <div data-testid={docked() ? "patterns-chart-dock" : "patterns-fullscreen-modal"} data-trendlines-view={props.trendlinesView ?? "both"}>
          <div data-testid="patterns-fullscreen-active-hit">{props.hit?.pattern_name}</div>
          <For each={(props.hits ?? []) as any[]}>
            {(h: any, i: number) => (
              <button
                type="button"
                data-testid={`patterns-fullscreen-list-item-${i()}`}
                onClick={() => props.onSelectHit?.(h)}
              >
                {h.pattern_name}
              </button>
            )}
          </For>
          <Show when={props.onTimeframeChange && props.timeframe != null}>
            <select
              data-testid="patterns-fullscreen-timeframe"
              aria-label="Fullscreen timeframe"
              value={props.timeframe}
              onChange={(e) => props.onTimeframeChange((e.currentTarget as HTMLSelectElement).value)}
            >
              <For each={tfs()}>
                {(tf: any) => (
                  <option value={tf.id}>
                    {tf.label || tf.id}
                  </option>
                )}
              </For>
            </select>
          </Show>
          <Show when={props.loading}>
            <div data-testid="patterns-fullscreen-loading" />
          </Show>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
          <Show when={props.onMaximize}>
            <button type="button" data-testid="patterns-chart-expand" onClick={props.onMaximize}>
              Expand
            </button>
          </Show>
          <Show when={props.onPrev}>
            <button type="button" data-testid="patterns-chart-prev" onClick={props.onPrev}>
              Prev
            </button>
          </Show>
          <Show when={props.onNext}>
            <button type="button" data-testid="patterns-chart-next" onClick={props.onNext}>
              Next
            </button>
          </Show>
          <Show when={props.positionLabel}>
            <div data-testid="patterns-chart-position">{props.positionLabel}</div>
          </Show>
          <div data-testid="patterns-fullscreen-chart" />
          <Show when={((props.candles?.length ?? 0) === 0)}>
            <div>No chart data</div>
          </Show>
        </div>
      </Show>
    );
  },
}));

// Native-select stubs so toolbar wiring is deterministic (the real Select needs popup interaction). Testids + onChange contracts preserved.
vi.mock("@/components/patterns/TimeframeSelect", () => ({
  TimeframeSelect: (props: any) => {
    const selected = () => (Array.isArray(props.value) ? props.value : props.value ? [props.value] : []);
    const source = () =>
      (props.timeframes as any[]).length > 0
        ? (props.timeframes as any[])
        : [{ id: selected()[0] ?? "1D", label: selected()[0] ?? "1D" }];
    return (
      <div data-testid="patterns-timeframe-select">
        <For each={source()}>
          {(tf: any) => (
            <button
              type="button"
              data-testid={`tf-option-${tf.id}`}
              onClick={() => {
                const next = selected().includes(tf.id)
                  ? selected().filter((item: string) => item !== tf.id)
                  : [...selected(), tf.id];
                if (next.length > 0) props.onChange?.(next);
              }}
            >
              {tf.label || tf.id}
            </button>
          )}
        </For>
      </div>
    );
  },
}));

vi.mock("@/components/patterns/LookbackSelect", () => ({
  LookbackSelect: (props: any) => (
    <select
      data-testid="patterns-lookback-select"
      aria-label="Lookback"
      value={props.value == null ? "auto" : String(props.value)}
      onInput={(e) => {
        const v = (e.currentTarget as HTMLSelectElement).value;
        props.onChange?.(v === "auto" ? null : Number(v));
      }}
    >
      <option value="auto">Auto</option>
      <option value="250">250</option>
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
    selectedTimeframes: ["1D"],
    setSelectedTimeframes: vi.fn(),
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
    defaultView: "list",
    ...overrides,
  };
}

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}


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
    fireEvent.click(
      within(chip).getByTestId("patterns-applied-filter-family:reversal-remove"),
    );
    expect(props.setFilter).toHaveBeenCalledWith("family", []);
  });

  test("Clear all in the applied row calls resetFilters", async () => {
    const props = makeProps({ filters: { ...makeProps().filters, family: ["reversal"] } });
    r(<PatternsPage {...props} />);
    fireEvent.click(screen.getByTestId("patterns-applied-clear-all"));
    expect(props.resetFilters).toHaveBeenCalledTimes(1);
  });

  test("expand button on a card opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("patterns-card-expand-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1D", { detectPatterns: false, computeTrendlines: true });
  });

  test("grid + fullscreen default to the both trendlines view when computing", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(gridTrendlinesViews.at(-1)).toBe("both");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "both");
  });

  test("TLS/TLR toggle off passes trendlinesView=none to grid and fullscreen", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    expect(gridTrendlinesViews.at(-1)).toBe("none");
    expect(screen.getByTestId("patterns-grid")).toHaveAttribute("data-trendlines-view", "none");
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toHaveAttribute(
      "data-trendlines-view",
      "none",
    );
    expect(fullscreenTrendlinesViews.at(-1)).toBe("none");
  });

  test("opening a card opts the chart fetch out of trendline computation when TLS/TLR is off", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: false })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      expect.objectContaining({ computeTrendlines: false }),
    );
  });

  test("opening a card forwards computeTrendlines when TLS/TLR is on", async () => {
    r(<PatternsPage {...makeProps({ computeTrendlines: true, lookbackBars: 250 })} />);
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(fetchSymbolChart).toHaveBeenCalledWith(
      "IRCON",
      "1D",
      { detectPatterns: false, lookbackBars: 250, computeTrendlines: true },
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    fetchSymbolChart.mockClear();
    // Phase 1 (candles only) then phase 2 (detection) — two-phase timeframe switch.
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      hits: [],
      trend_lines: [],
    });
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [{ pattern_id: "rising_wedge", pattern_name: "Rising Wedge", trendlines: [] }],
      trend_lines: [],
      hits: [oldConfident, newWeak],
    });

    await fireEvent.change(screen.getByTestId("patterns-fullscreen-timeframe"), { target: { value: "1h" } });

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
    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Falling Wedge");
    fetchSymbolChart.mockClear();
    // Phase 1 (candles only) then phase 2 (detection, no hits) — two-phase timeframe switch.
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      hits: [],
      trend_lines: [],
    });
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1h",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      trend_lines: [],
      hits: [],
    });

    await fireEvent.change(screen.getByTestId("patterns-fullscreen-timeframe"), { target: { value: "1h" } });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("IRCON", "1h", { detectPatterns: true }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).not.toHaveTextContent("Falling Wedge"),
    );
  });

  test("opening a card shows that hit and keeps a single-item pattern list", async () => {
    const cardHit = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", confidence: 95, end_date: "2026-08-01", bars_ago: 40 });
    r(<PatternsPage {...makeProps({ results: [cardHit], total: 1 })} />);
    fetchSymbolChart.mockClear();
    fetchSymbolChart.mockResolvedValueOnce({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-09-26T09:15:00+05:30", o: 100, h: 115, l: 98, c: 112, v: 1000 }],
      overlays: [],
      trend_lines: [],
      hits: [],
    });

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "IRCON",
        "1D",
        expect.objectContaining({ detectPatterns: false }),
      ),
    );
    expect(fetchPatternHit).toHaveBeenCalledWith(11);
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Falling Wedge"),
    );
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Falling Wedge");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Grid" }));
    fireEvent.click(screen.getByTestId("patterns-card-IRCON-ascending_channel"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-active-hit")).toHaveTextContent("Ascending Channel"),
    );
    // One row, not two: the id-carrying card hit and the id-less live hit are the same.
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent("Ascending Channel");
    expect(screen.queryByTestId("patterns-fullscreen-list-item-1")).not.toBeInTheDocument();
  });

  test("switching universe closes the docked chart", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const props = makeProps({ results: [makeHit()], total: 1 });
      const [universe, setUniverse] = createSignal("nifty500");
      r(<PatternsPage {...props} universe={universe()} />);
      fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
      expect(await screen.findByTestId("patterns-chart-dock")).toBeInTheDocument();

      // Scope changed: the open hit belongs to the previous universe.
      setUniverse("nifty50");
      await waitFor(() =>
        expect(screen.queryByTestId("patterns-chart-dock")).not.toBeInTheDocument(),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test("a completed scan re-resolves the open stored hit", async () => {
    const [lastScanAt, setLastScanAt] = createSignal("2026-10-01T00:00:00Z");
    const props = makeProps({
      results: [makeHit({ id: 11 })],
      total: 1,
    });
    r(<PatternsPage {...props} summary={{ ...SUMMARY, last_scan_at: lastScanAt() }} />);
    fireEvent.click(screen.getByTestId("patterns-list-row-IRCON-falling_wedge"));
    await screen.findByTestId("patterns-fullscreen-modal");
    await waitFor(() => expect(fetchPatternHit).toHaveBeenCalledWith(11));
    const callsAfterOpen = fetchPatternHit.mock.calls.length;

    // A scan completed: `last_scan_at` moves, so the stored hit is re-fetched.
    fetchPatternHit.mockResolvedValueOnce(makeHit({ id: 11, status: "failed" }));
    setLastScanAt("2026-10-02T00:00:00Z");
    await waitFor(() =>
      expect(fetchPatternHit.mock.calls.length).toBe(callsAfterOpen + 1),
    );
    expect(fetchPatternHit).toHaveBeenLastCalledWith(11);
    // The chart stays open with the re-resolved hit.
    expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
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

    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-copy-csv"));

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

    fireEvent.click(screen.getByTestId("patterns-overflow"));
    fireEvent.click(await screen.findByTestId("patterns-copy-symbols"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(String(writeText.mock.calls[0][0])).toBe("NSE:IRCON");

    const toast = await screen.findByTestId("patterns-copy-toast");
    expect(toast).toHaveTextContent("Copied 1 symbol");
  });

  test("copy buttons are disabled when there are no results", async () => {
    r(<PatternsPage {...makeProps({ results: [], total: 0 })} />);
    fireEvent.click(screen.getByTestId("patterns-overflow"));
    // Overflow items are menu items: the menu signals disabled items via aria-disabled
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
